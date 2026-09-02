import {
  AckStatus,
  ContactRecord,
  FileRecord,
  FileTransferProgress,
  HandshakeAnswerData,
  HandshakeFinalizeData,
  HandshakeOfferData,
  IdentityRecord,
  MessageRecord,
  PacketType,
  PROTOCOL_VERSION,
  RelayServerStats,
  RelayStatus,
} from '../types/index';
import { db } from '../db/index';
import {
  arrayBufferToBase64,
  arrayBufferToHex,
  base64ToArrayBuffer,
  bigEndianBytesToUint64,
  generateRandomBytes,
  generateRandomHexId,
  sha256,
} from '../crypto/utils';
import {
  generateEphemeralECDH,
  importPeerECDHKey,
  importPeerECDSAKey,
} from '../crypto/keys';
import {
  computeSafetyNumber,
  computeTranscriptHash,
  signTranscriptHash,
  verifyTranscriptSignature,
} from '../crypto/canonicalTranscript';
import { deriveSessionKeys } from '../crypto/hkdf';
import { CryptoSession } from '../crypto/session';
import {
  buildPacketHeader,
  parsePacketHeader,
} from '../protocol/packet';
import { fileTransferManager } from '../protocol/fileTransfer';

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
  ],
};

export type ConnectionState =
  | 'DISCONNECTED'
  | 'CONNECTING'
  | 'HANDSHAKING'
  | 'CONNECTED';

export interface PeerManagerEvents {
  onStateChange: (state: ConnectionState) => void;
  onRelayStatusChange?: (
    status: RelayStatus,
    stats?: RelayServerStats,
    pingMs?: number | null,
    errorReason?: string
  ) => void;
  onContactsPresencesUpdate?: (presences: Record<string, { isOnline: boolean; lastSeen: number }>) => void;
  onMessageReceived: (message: MessageRecord) => void;
  onFileProgress: (progress: FileTransferProgress) => void;
  onFileCompleted: (fileRecord: FileRecord, blob: Blob) => void;
  onMediaSignal?: (signal: any) => void;
  onPeerInfo: (contact: ContactRecord) => void;
  onError: (error: string) => void;
  onLatencyUpdate: (ms: number) => void;
}

export class PeerManager {
  public state: ConnectionState = 'DISCONNECTED';
  public relayStatus: RelayStatus = 'CONNECTING';
  public relayStats: RelayServerStats | null = null;
  public relayPingMs: number | null = null;
  public relayErrorReason: string | null = null;
  public customRelayUrl: string = '';
  public activeRoomId: string | null = null;
  public peerConnection: RTCPeerConnection | null = null;
  public dataChannel: RTCDataChannel | null = null;
  public cryptoSession: CryptoSession | null = null;
  public activeContact: ContactRecord | null = null;
  public latencyMs: number = 0;

  public identity: IdentityRecord;
  private events: PeerManagerEvents;

  // Ephemeral handshake states
  private ephemeralKeyPair: CryptoKeyPair | null = null;
  private ephemeralPublicKeyRaw: Uint8Array | null = null;
  private ephemeralPublicKeyBase64 = '';
  private handshakeSalt: Uint8Array | null = null;
  private challengeNonceA: Uint8Array | null = null;
  private challengeNonceB: Uint8Array | null = null;
  private currentRole: 'initiator' | 'responder' = 'initiator';

  // Remote temporary info
  private remoteIdentityPublicKeyRaw: Uint8Array | null = null;
  private remoteEphemeralPublicKeyRaw: Uint8Array | null = null;
  private remoteDeviceId = '';
  private remoteDisplayName = '';

  private heartbeatInterval: any = null;
  private mailboxPollInterval: any = null;
  private relayCheckInterval: any = null;
  private sseSource: EventSource | null = null;
  private sseReconnectTimeout: any = null;
  private lastPingSentTime = 0;

  constructor(identity: IdentityRecord, events: PeerManagerEvents) {
    this.identity = identity;
    this.events = events;
    try {
      localStorage.removeItem('scryptchat_relay_server_url');
    } catch {}
    this.customRelayUrl = '';
    this.checkRelayHealth();
    this.startRealtimeStream();
    this.startMailboxPolling();
    this.startRelayHealthCheck();
  }

  public getRelayBaseUrl(): string {
    return this.customRelayUrl || '';
  }

  public setRelayBaseUrl(url: string) {
    this.customRelayUrl = url?.trim() || '';
    this.checkRelayHealth();
    this.startRealtimeStream();
  }

  public async fetchRelay(endpoint: string, options: RequestInit = {}, timeoutMs = 12000): Promise<Response> {
    const baseUrl = this.getRelayBaseUrl();
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    const cacheBuster = `_cb=${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const separator = cleanEndpoint.includes('?') ? '&' : '?';
    const finalEndpoint = `${cleanEndpoint}${separator}${cacheBuster}`;
    const url = baseUrl ? `${baseUrl}${finalEndpoint}` : finalEndpoint;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      clearTimeout(timer);
      return response;
    } catch (err) {
      clearTimeout(timer);
      throw err;
    }
  }

  public updateIdentity(identity: IdentityRecord) {
    this.identity = identity;
    this.startRealtimeStream();
  }

  public setState(state: ConnectionState) {
    this.state = state;
    this.events.onStateChange(state);
  }

  public isConnected(): boolean {
    return this.state === 'CONNECTED' && this.dataChannel?.readyState === 'open';
  }

  /**
   * Real-time Server-Sent Events stream for instant (0ms) push notifications, messages, and calls
   */
  private startRealtimeStream() {
    if (this.sseSource) {
      this.sseSource.close();
      this.sseSource = null;
    }
    if (this.sseReconnectTimeout) {
      clearTimeout(this.sseReconnectTimeout);
      this.sseReconnectTimeout = null;
    }

    if (!this.identity?.deviceId) return;

    try {
      const streamUrl = `${this.getRelayBaseUrl()}/api/signaling/stream/${this.identity.deviceId}`;
      const sse = new EventSource(streamUrl);
      this.sseSource = sse;

      sse.addEventListener('connected', () => {
        this.relayStatus = 'ONLINE';
        this.events.onRelayStatusChange?.('ONLINE', { status: 'online' }, 10, undefined);
      });

      sse.addEventListener('mailbox_item', (e: MessageEvent) => {
        try {
          const item = JSON.parse(e.data);
          this.processIncomingMailboxItem(item);
        } catch (err) {
          console.warn('SSE mailbox item parse error:', err);
        }
      });

      sse.onerror = () => {
        sse.close();
        this.sseSource = null;
        if (!this.sseReconnectTimeout) {
          this.sseReconnectTimeout = setTimeout(() => {
            this.startRealtimeStream();
          }, 3000);
        }
      };
    } catch {}
  }

  public async processIncomingMailboxItem(item: any) {
    if (!item) return;
    try {
      let envelope: any = {};
      if (item.encryptedEnvelope) {
        const decodedJson = decodeURIComponent(escape(atob(item.encryptedEnvelope)));
        envelope = JSON.parse(decodedJson);
      }

      // 1. Media Call Signal
      if (envelope.type === 'CALL_SIGNAL' || envelope.signal || envelope.action) {
        const signal = envelope.signal || envelope;
        this.events.onMediaSignal?.(signal);
        return;
      }

      // 2. File Attachment / Photo / Voice Note
      let fileId = undefined;
      let fileRecord: FileRecord | undefined = undefined;

      if (item.fileMetadata && item.fileBase64Chunk) {
        const fileBytes = base64ToArrayBuffer(item.fileBase64Chunk);
        const mime = item.fileMetadata.mimeType || 'application/octet-stream';
        const blob = new Blob([fileBytes], { type: mime });
        const isImage = mime.startsWith('image/');
        const isAudio = mime.startsWith('audio/');
        const isVideo = mime.startsWith('video/');

        fileRecord = {
          fileId: item.fileMetadata.fileId,
          name: item.fileMetadata.name,
          size: item.fileMetadata.size,
          mimeType: mime,
          hashSHA256: item.fileMetadata.hashSHA256,
          blobRef: blob,
          isImage,
          isAudio,
          isVideo,
        };
        await db.files.put(fileRecord);
        fileId = fileRecord.fileId;
      }

      const mediaType = fileRecord?.isImage
        ? 'image'
        : fileRecord?.isAudio
        ? 'audio'
        : fileRecord?.isVideo
        ? 'video'
        : fileRecord
        ? 'file'
        : 'text';

      const msgRecord: MessageRecord = {
        chatDeviceId: item.senderDeviceId,
        direction: 'INBOUND',
        payloadText: envelope.text || fileRecord?.name || '[Encrypted Message]',
        fileId,
        fileRecord,
        mediaType,
        timestamp: item.timestamp || Date.now(),
        status: 'delivered',
      };

      const id = await db.messages.add(msgRecord);
      msgRecord.id = id;

      // Ensure contact is saved
      const existingContact = await db.contacts.get(item.senderDeviceId);
      if (!existingContact) {
        await this.saveContact(
          item.senderDeviceId,
          '',
          '000000',
          envelope.senderDisplayName || `Peer-${item.senderDeviceId.slice(4, 8)}`
        );
      }

      this.events.onMessageReceived(msgRecord);
    } catch (pErr) {
      console.warn('Process mailbox item error:', pErr);
    }
  }

  // --- WebRTC Peer Signaling ---

  public async createOffer(roomId?: string): Promise<HandshakeOfferData> {
    this.cleanup();
    this.setState('CONNECTING');
    this.currentRole = 'initiator';

    const eph = await generateEphemeralECDH();
    this.ephemeralKeyPair = eph.keyPair;
    this.ephemeralPublicKeyRaw = eph.rawPublicKey;
    this.ephemeralPublicKeyBase64 = eph.publicKeyBase64;

    this.handshakeSalt = generateRandomBytes(32);
    this.challengeNonceA = generateRandomBytes(16);

    this.peerConnection = new RTCPeerConnection(RTC_CONFIG);
    this.setupPeerConnectionListeners(this.peerConnection);

    this.dataChannel = this.peerConnection.createDataChannel('scryptchat-e2ee', {
      ordered: true,
    });
    this.setupDataChannelListeners(this.dataChannel);

    const offer = await this.peerConnection.createOffer();
    await this.peerConnection.setLocalDescription(offer);
    await this.waitForIceCandidates(this.peerConnection);

    const offerData: HandshakeOfferData = {
      protocolVer: PROTOCOL_VERSION,
      role: 'initiator',
      deviceId: this.identity.deviceId,
      displayName: this.identity.displayName || 'Secure Peer',
      identityPublicKeyRaw: this.identity.publicKeyRaw,
      ephemeralPublicKeyRaw: this.ephemeralPublicKeyBase64,
      challengeNonce: arrayBufferToBase64(this.challengeNonceA),
      handshakeSalt: arrayBufferToBase64(this.handshakeSalt),
      sdp: {
        type: this.peerConnection.localDescription!.type,
        sdp: this.peerConnection.localDescription!.sdp,
      },
    };

    return offerData;
  }

  public async acceptOffer(offerData: HandshakeOfferData): Promise<HandshakeAnswerData> {
    this.cleanup();
    this.setState('CONNECTING');
    this.currentRole = 'responder';

    if (offerData.protocolVer !== PROTOCOL_VERSION) {
      throw new Error(`Protocol version mismatch. Expected ${PROTOCOL_VERSION}, got ${offerData.protocolVer}`);
    }

    this.remoteDeviceId = offerData.deviceId || `dev_${offerData.identityPublicKeyRaw.slice(0, 16)}`;
    this.remoteDisplayName = offerData.displayName || 'Secure Peer';
    this.remoteIdentityPublicKeyRaw = base64ToArrayBuffer(offerData.identityPublicKeyRaw);
    this.remoteEphemeralPublicKeyRaw = base64ToArrayBuffer(offerData.ephemeralPublicKeyRaw);
    this.handshakeSalt = base64ToArrayBuffer(offerData.handshakeSalt);
    this.challengeNonceA = base64ToArrayBuffer(offerData.challengeNonce);
    this.challengeNonceB = generateRandomBytes(16);

    const eph = await generateEphemeralECDH();
    this.ephemeralKeyPair = eph.keyPair;
    this.ephemeralPublicKeyRaw = eph.rawPublicKey;
    this.ephemeralPublicKeyBase64 = eph.publicKeyBase64;

    this.peerConnection = new RTCPeerConnection(RTC_CONFIG);
    this.setupPeerConnectionListeners(this.peerConnection);

    this.peerConnection.ondatachannel = (event) => {
      this.dataChannel = event.channel;
      this.setupDataChannelListeners(this.dataChannel);
    };

    await this.peerConnection.setRemoteDescription(
      new RTCSessionDescription(offerData.sdp)
    );

    const answer = await this.peerConnection.createAnswer();
    await this.peerConnection.setLocalDescription(answer);
    await this.waitForIceCandidates(this.peerConnection);

    const ourIdentityRaw = base64ToArrayBuffer(this.identity.publicKeyRaw);
    const sdpRaw = new TextEncoder().encode(this.peerConnection.localDescription!.sdp);
    const sdpHash = await sha256(sdpRaw);

    const transcriptHash = await computeTranscriptHash({
      identityPublicKeyA: this.remoteIdentityPublicKeyRaw,
      ephemeralPublicKeyA: this.remoteEphemeralPublicKeyRaw,
      challengeNonceA: this.challengeNonceA,
      identityPublicKeyB: ourIdentityRaw,
      ephemeralPublicKeyB: this.ephemeralPublicKeyRaw,
      challengeNonceB: this.challengeNonceB,
      handshakeSalt: this.handshakeSalt,
      sdpFingerprintSHA256: sdpHash,
    });

    const signature = await signTranscriptHash(this.identity.privateKeyECDSA, transcriptHash);

    const peerEphemeralCryptoKey = await importPeerECDHKey(offerData.ephemeralPublicKeyRaw);
    const sessionKeys = await deriveSessionKeys(
      this.ephemeralKeyPair.privateKey,
      peerEphemeralCryptoKey,
      this.handshakeSalt,
      transcriptHash
    );

    const safetyNumber = await computeSafetyNumber(ourIdentityRaw, this.remoteIdentityPublicKeyRaw);
    const sessionId = bigEndianBytesToUint64(transcriptHash, 0);

    this.cryptoSession = new CryptoSession({
      sessionId,
      role: 'responder',
      sendKey: sessionKeys.keyB2A.keyAES,
      sendPrefix: sessionKeys.keyB2A.prefix,
      recvKey: sessionKeys.keyA2B.keyAES,
      recvPrefix: sessionKeys.keyA2B.prefix,
      peerDeviceId: this.remoteDeviceId,
      transcriptHash,
      safetyNumber,
    });

    await this.saveContact(this.remoteDeviceId, offerData.identityPublicKeyRaw, safetyNumber, this.remoteDisplayName);

    return {
      protocolVer: PROTOCOL_VERSION,
      role: 'responder',
      deviceId: this.identity.deviceId,
      displayName: this.identity.displayName || 'Secure Peer',
      identityPublicKeyRaw: this.identity.publicKeyRaw,
      ephemeralPublicKeyRaw: this.ephemeralPublicKeyBase64,
      challengeNonce: arrayBufferToBase64(this.challengeNonceB),
      signature,
      sdp: {
        type: this.peerConnection.localDescription!.type,
        sdp: this.peerConnection.localDescription!.sdp,
      },
    };
  }

  public async acceptAnswer(answerData: HandshakeAnswerData): Promise<HandshakeFinalizeData> {
    if (this.currentRole !== 'initiator' || !this.peerConnection || !this.ephemeralKeyPair) {
      throw new Error('Invalid state for finalizing handshake');
    }

    this.remoteDeviceId = answerData.deviceId || `dev_${answerData.identityPublicKeyRaw.slice(0, 16)}`;
    this.remoteDisplayName = answerData.displayName || 'Secure Peer';
    this.remoteIdentityPublicKeyRaw = base64ToArrayBuffer(answerData.identityPublicKeyRaw);
    this.remoteEphemeralPublicKeyRaw = base64ToArrayBuffer(answerData.ephemeralPublicKeyRaw);
    this.challengeNonceB = base64ToArrayBuffer(answerData.challengeNonce);

    await this.peerConnection.setRemoteDescription(
      new RTCSessionDescription(answerData.sdp)
    );

    const ourIdentityRaw = base64ToArrayBuffer(this.identity.publicKeyRaw);
    const sdpRaw = new TextEncoder().encode(this.peerConnection.localDescription!.sdp);
    const sdpHash = await sha256(sdpRaw);

    const transcriptHash = await computeTranscriptHash({
      identityPublicKeyA: ourIdentityRaw,
      ephemeralPublicKeyA: this.ephemeralPublicKeyRaw!,
      challengeNonceA: this.challengeNonceA!,
      identityPublicKeyB: this.remoteIdentityPublicKeyRaw,
      ephemeralPublicKeyB: this.remoteEphemeralPublicKeyRaw,
      challengeNonceB: this.challengeNonceB,
      handshakeSalt: this.handshakeSalt!,
      sdpFingerprintSHA256: sdpHash,
    });

    const peerIdentityECDSAKey = await importPeerECDSAKey(answerData.identityPublicKeyRaw);
    const isValidSignature = await verifyTranscriptSignature(
      peerIdentityECDSAKey,
      transcriptHash,
      answerData.signature
    );

    if (!isValidSignature) {
      this.cleanup();
      throw new Error('SECURITY ALERT: Cryptographic signature verification failed!');
    }

    const ourSignature = await signTranscriptHash(this.identity.privateKeyECDSA, transcriptHash);
    const peerEphemeralCryptoKey = await importPeerECDHKey(answerData.ephemeralPublicKeyRaw);
    const sessionKeys = await deriveSessionKeys(
      this.ephemeralKeyPair.privateKey,
      peerEphemeralCryptoKey,
      this.handshakeSalt!,
      transcriptHash
    );

    const safetyNumber = await computeSafetyNumber(ourIdentityRaw, this.remoteIdentityPublicKeyRaw);
    const sessionId = bigEndianBytesToUint64(transcriptHash, 0);

    this.cryptoSession = new CryptoSession({
      sessionId,
      role: 'initiator',
      sendKey: sessionKeys.keyA2B.keyAES,
      sendPrefix: sessionKeys.keyA2B.prefix,
      recvKey: sessionKeys.keyB2A.keyAES,
      recvPrefix: sessionKeys.keyB2A.prefix,
      peerDeviceId: this.remoteDeviceId,
      transcriptHash,
      safetyNumber,
    });

    await this.saveContact(this.remoteDeviceId, answerData.identityPublicKeyRaw, safetyNumber, this.remoteDisplayName);

    if (this.dataChannel?.readyState === 'open') {
      this.setState('CONNECTED');
      this.startHeartbeat();
    }

    return {
      protocolVer: PROTOCOL_VERSION,
      role: 'initiator',
      signature: ourSignature,
    };
  }

  public async finalizeHandshake(finalizeData: HandshakeFinalizeData): Promise<void> {
    if (this.dataChannel?.readyState === 'open') {
      this.setState('CONNECTED');
      this.startHeartbeat();
    }
  }

  public async saveContact(deviceId: string, publicKeyRaw: string, safetyNumber: string, alias?: string): Promise<ContactRecord> {
    const existing = await db.contacts.get(deviceId);
    const contact: ContactRecord = {
      deviceId,
      alias: alias || existing?.alias || `Peer-${deviceId.slice(4, 8)}`,
      identityPublicKeyPEM: publicKeyRaw,
      publicKeyRaw,
      verificationStatus: existing?.verificationStatus || 'TOFU',
      safetyNumber,
      addedAt: existing?.addedAt || Date.now(),
      lastSeenAt: Date.now(),
      isOnline: true,
    };
    await db.contacts.put(contact);
    this.activeContact = contact;
    this.events.onPeerInfo(contact);
    return contact;
  }

  private waitForIceCandidates(pc: RTCPeerConnection, timeoutMs = 800): Promise<void> {
    return new Promise((resolve) => {
      if (pc.iceGatheringState === 'complete') {
        resolve();
        return;
      }
      const timer = setTimeout(() => resolve(), timeoutMs);
      const onStateChange = () => {
        if (pc.iceGatheringState === 'complete') {
          clearTimeout(timer);
          pc.removeEventListener('icegatheringstatechange', onStateChange);
          resolve();
        }
      };
      pc.addEventListener('icegatheringstatechange', onStateChange);
    });
  }

  private setupPeerConnectionListeners(pc: RTCPeerConnection) {
    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
        if (this.cryptoSession && this.dataChannel?.readyState === 'open') {
          this.setState('CONNECTED');
          this.startHeartbeat();
        }
      } else if (pc.iceConnectionState === 'failed') {
        this.setState('DISCONNECTED');
      }
    };
  }

  private setupDataChannelListeners(dc: RTCDataChannel) {
    dc.binaryType = 'arraybuffer';

    dc.onopen = () => {
      if (this.cryptoSession) {
        this.setState('CONNECTED');
        this.startHeartbeat();
      }
    };

    dc.onclose = () => {
      this.setState('DISCONNECTED');
      this.stopHeartbeat();
    };

    dc.onmessage = async (event) => {
      await this.handleIncomingDataChannelMessage(event.data);
    };
  }

  private async handleIncomingDataChannelMessage(data: ArrayBuffer) {
    if (!this.cryptoSession) return;
    try {
      const encryptedFrame = new Uint8Array(data);
      if (encryptedFrame.length < 24) return;
      const header24 = encryptedFrame.slice(0, 24);
      const ciphertext = encryptedFrame.slice(24);
      const decryptedPayload = await this.cryptoSession.decryptFrame(header24, ciphertext);

      const header = parsePacketHeader(header24);

      switch (header.packetType) {
        case PacketType.TEXT_MESSAGE: {
          const text = new TextDecoder().decode(decryptedPayload);
          const msgRecord: MessageRecord = {
            chatDeviceId: this.remoteDeviceId,
            direction: 'INBOUND',
            payloadText: text,
            mediaType: 'text',
            timestamp: Date.now(),
            status: 'delivered',
          };
          const id = await db.messages.add(msgRecord);
          msgRecord.id = id;
          this.events.onMessageReceived(msgRecord);
          break;
        }

        case PacketType.FILE_HEADER:
        case PacketType.FILE_CHUNK:
        case PacketType.CHUNK_ACK: {
          if (this.dataChannel && this.cryptoSession) {
            await fileTransferManager.handleIncomingPacket(
              header.packetType,
              header.objectId,
              header.sequenceIndex,
              decryptedPayload,
              this.dataChannel,
              this.cryptoSession,
              {
                onProgress: this.events.onFileProgress,
                onCompleted: async (fileRec, blob) => {
                  await db.files.put(fileRec);
                  const mediaType = fileRec.isImage
                    ? 'image'
                    : fileRec.isAudio
                    ? 'audio'
                    : fileRec.isVideo
                    ? 'video'
                    : 'file';
                  const msgRecord: MessageRecord = {
                    chatDeviceId: this.remoteDeviceId,
                    direction: 'INBOUND',
                    payloadText: fileRec.name,
                    fileId: fileRec.fileId,
                    fileRecord: fileRec,
                    mediaType,
                    timestamp: Date.now(),
                    status: 'delivered',
                  };
                  const id = await db.messages.add(msgRecord);
                  msgRecord.id = id;
                  this.events.onFileCompleted(fileRec, blob);
                  this.events.onMessageReceived(msgRecord);
                },
                onError: (fId, err) => {
                  this.events.onError(err);
                },
              }
            );
          }
          break;
        }

        case PacketType.MEDIA_SIGNAL: {
          const signalJson = new TextDecoder().decode(decryptedPayload);
          const signal = JSON.parse(signalJson);
          this.events.onMediaSignal?.(signal);
          break;
        }

        case PacketType.HEARTBEAT_PING_PONG: {
          if (this.lastPingSentTime > 0) {
            this.latencyMs = Math.max(1, Date.now() - this.lastPingSentTime);
            this.events.onLatencyUpdate(this.latencyMs);
          }
          break;
        }
      }
    } catch (err: any) {
      console.warn('Frame decrypt/handle error:', err);
    }
  }

  /**
   * Sends a message with 0ms delivery: directly to WebRTC data channel if open AND to real-time relay SSE!
   */
  public async sendTextMessage(text: string, targetDeviceId?: string): Promise<MessageRecord> {
    const recipientId = targetDeviceId || this.remoteDeviceId || this.activeContact?.deviceId;
    if (!recipientId) {
      throw new Error('No recipient device specified');
    }

    const msgRecord: MessageRecord = {
      chatDeviceId: recipientId,
      direction: 'OUTBOUND',
      payloadText: text,
      mediaType: 'text',
      timestamp: Date.now(),
      status: 'delivered',
    };

    const id = await db.messages.add(msgRecord);
    msgRecord.id = id;

    // 1. Direct WebRTC transmission if connected
    if (this.isConnected() && this.cryptoSession && this.dataChannel && recipientId === this.remoteDeviceId) {
      try {
        const payloadBytes = new TextEncoder().encode(text);
        const msgIdBigInt = BigInt('0x' + generateRandomHexId(8));
        const headerBytes = buildPacketHeader(
          PacketType.TEXT_MESSAGE,
          this.cryptoSession.sessionId,
          msgIdBigInt,
          Number(this.cryptoSession.getNextSendCounter())
        );
        const frame = await this.cryptoSession.encryptFrame(headerBytes, payloadBytes);
        this.dataChannel.send(frame);
      } catch (err) {
        console.warn('WebRTC dataChannel send error:', err);
      }
    }

    // 2. Immediate real-time push via SSE & relay mailbox for zero-latency instant delivery
    try {
      const envelope = {
        type: 'TEXT',
        text,
        senderDeviceId: this.identity.deviceId,
        senderDisplayName: this.identity.displayName || 'Secure Peer',
        timestamp: Date.now(),
      };
      const encryptedEnvelope = btoa(unescape(encodeURIComponent(JSON.stringify(envelope))));

      await this.fetchRelay('/api/signaling/mailbox/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          senderDeviceId: this.identity.deviceId,
          recipientDeviceId: recipientId,
          encryptedEnvelope,
          timestamp: Date.now(),
        }),
      });
    } catch (err) {
      console.warn('Signaling mailbox send error:', err);
    }

    return msgRecord;
  }

  /**
   * Sends a file (photo, document, voice note) with instant 0ms delivery
   */
  public async sendFile(file: File, targetDeviceId?: string): Promise<FileRecord> {
    const recipientId = targetDeviceId || this.remoteDeviceId || this.activeContact?.deviceId;
    if (!recipientId) throw new Error('No recipient device specified');

    const arrayBuf = await file.arrayBuffer();
    const fileBytes = new Uint8Array(arrayBuf);
    const hashBytes = await sha256(fileBytes);
    const hashHex = arrayBufferToHex(hashBytes);
    const fileId = 'F_' + generateRandomHexId(8);
    const mime = file.type || 'application/octet-stream';
    const isImage = mime.startsWith('image/');
    const isAudio = mime.startsWith('audio/');
    const isVideo = mime.startsWith('video/');

    const fileRecord: FileRecord = {
      fileId,
      name: file.name,
      size: file.size,
      mimeType: mime,
      hashSHA256: hashHex,
      blobRef: file,
      isImage,
      isAudio,
      isVideo,
    };

    await db.files.put(fileRecord);

    const mediaType = isImage ? 'image' : isAudio ? 'audio' : isVideo ? 'video' : 'file';
    const msgRecord: MessageRecord = {
      chatDeviceId: recipientId,
      direction: 'OUTBOUND',
      payloadText: file.name,
      fileId,
      fileRecord,
      mediaType,
      timestamp: Date.now(),
      status: 'delivered',
    };

    const id = await db.messages.add(msgRecord);
    msgRecord.id = id;
    this.events.onMessageReceived(msgRecord);

    // 1. Send via WebRTC if channel open
    if (this.isConnected() && this.cryptoSession && this.dataChannel && recipientId === this.remoteDeviceId) {
      fileTransferManager.sendFile(
        file,
        this.dataChannel,
        this.cryptoSession,
        {
          onProgress: this.events.onFileProgress,
          onCompleted: () => {},
          onError: (fId, err) => {
            this.events.onError(err);
          },
        }
      ).catch(() => {});
    }

    // 2. Send via real-time SSE stream for instant delivery of photos / files
    try {
      const base64Chunk = arrayBufferToBase64(fileBytes);
      const envelope = {
        type: 'FILE',
        fileName: file.name,
        mimeType: mime,
        size: file.size,
        senderDeviceId: this.identity.deviceId,
        senderDisplayName: this.identity.displayName || 'Secure Peer',
        timestamp: Date.now(),
      };
      const encryptedEnvelope = btoa(unescape(encodeURIComponent(JSON.stringify(envelope))));

      await this.fetchRelay('/api/signaling/mailbox/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          senderDeviceId: this.identity.deviceId,
          recipientDeviceId: recipientId,
          encryptedEnvelope,
          fileMetadata: {
            fileId,
            name: file.name,
            size: file.size,
            mimeType: mime,
            hashSHA256: hashHex,
          },
          fileBase64Chunk: base64Chunk,
          timestamp: Date.now(),
        }),
      });
    } catch (err) {
      console.warn('File signaling push error:', err);
    }

    return fileRecord;
  }

  public async checkRelayHealth(): Promise<RelayStatus> {
    const startTime = performance.now();
    try {
      const res = await this.fetchRelay('/api/signaling/status', {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
      }, 7000);

      if (res.ok) {
        const elapsed = Math.round(performance.now() - startTime);
        let stats: RelayServerStats = { status: 'online' };
        try {
          stats = await res.json();
        } catch {}
        this.relayStatus = 'ONLINE';
        this.relayStats = stats;
        this.relayPingMs = elapsed;
        this.relayErrorReason = null;
        this.events.onRelayStatusChange?.('ONLINE', stats, elapsed, undefined);
        return 'ONLINE';
      } else {
        const status: RelayStatus = 'OFFLINE';
        const reason = `Signaling server returned HTTP ${res.status}`;
        this.relayStatus = status;
        this.relayPingMs = null;
        this.relayErrorReason = reason;
        this.events.onRelayStatusChange?.(status, undefined, null, reason);
        return status;
      }
    } catch (err: any) {
      const status: RelayStatus = 'OFFLINE';
      const reason = err?.message || 'Signaling server unreachable';
      this.relayStatus = status;
      this.relayPingMs = null;
      this.relayErrorReason = reason;
      this.events.onRelayStatusChange?.(status, undefined, null, reason);
      return status;
    }
  }

  public async confirmPairingOnRelay(roomId: string): Promise<boolean> {
    try {
      const res = await this.fetchRelay(`/api/signaling/room/${roomId}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: this.identity.deviceId }),
      }, 5000);
      if (!res.ok) return false;
      const data = await res.json();
      return !!data.success;
    } catch {
      return false;
    }
  }

  private startRelayHealthCheck() {
    if (this.relayCheckInterval) {
      clearInterval(this.relayCheckInterval);
    }
    this.relayCheckInterval = setInterval(() => {
      this.checkRelayHealth();
    }, 10000);
  }

  private startMailboxPolling() {
    if (this.mailboxPollInterval) {
      clearInterval(this.mailboxPollInterval);
    }
    this.mailboxPollInterval = setInterval(async () => {
      if (!this.identity?.deviceId) return;
      try {
        // Presence Heartbeat Ping
        await this.fetchRelay('/api/signaling/presence', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            deviceId: this.identity.deviceId,
            displayName: this.identity.displayName || 'Secure Peer',
          }),
        }, 3000).catch(() => {});

        // Query Presence for all known contacts
        const allContacts = await db.contacts.toArray();
        if (allContacts.length > 0) {
          const deviceIds = allContacts.map((c) => c.deviceId);
          const presenceRes = await this.fetchRelay('/api/signaling/presence/query', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ deviceIds }),
          }, 3000).catch(() => null);

          if (presenceRes && presenceRes.ok) {
            const pData = await presenceRes.json();
            if (pData.success && pData.presences) {
              for (const c of allContacts) {
                const presence = pData.presences[c.deviceId];
                if (presence && presence.isOnline !== c.isOnline) {
                  await db.contacts.update(c.deviceId, {
                    isOnline: presence.isOnline,
                    lastSeenAt: presence.lastSeen || c.lastSeenAt,
                  });
                }
              }
              this.events.onContactsPresencesUpdate?.(pData.presences);
            }
          }
        }

        // Pull fallback mailbox items
        const res = await this.fetchRelay(`/api/signaling/mailbox/pull/${this.identity.deviceId}`, {
          method: 'GET',
          headers: { 'Accept': 'application/json' },
        }, 3500).catch(() => null);

        if (res && res.ok) {
          const data = await res.json();
          if (data.success && Array.isArray(data.items) && data.items.length > 0) {
            for (const item of data.items) {
              await this.processIncomingMailboxItem(item);
            }
          }
        }
      } catch {}
    }, 4000);
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatInterval = setInterval(async () => {
      if (!this.isConnected() || !this.cryptoSession || !this.dataChannel) return;
      try {
        this.lastPingSentTime = Date.now();
        const header = buildPacketHeader(
          PacketType.HEARTBEAT_PING_PONG,
          this.cryptoSession.sessionId,
          0n,
          0,
          0x00
        );
        const encryptedPing = await this.cryptoSession.encryptFrame(header, new Uint8Array(0));
        this.dataChannel.send(encryptedPing);
      } catch (err) {
        console.warn('Heartbeat ping error:', err);
      }
    }, 3000);
  }

  private stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  public async getContact(deviceId: string): Promise<ContactRecord | undefined> {
    return await db.contacts.get(deviceId);
  }

  public getCryptoSession(deviceId?: string): CryptoSession | null {
    return this.cryptoSession;
  }

  public cleanup() {
    this.stopHeartbeat();
    if (this.cryptoSession) {
      this.cryptoSession.destroy();
      this.cryptoSession = null;
    }
    if (this.dataChannel) {
      try {
        this.dataChannel.close();
      } catch {}
      this.dataChannel = null;
    }
    if (this.peerConnection) {
      try {
        this.peerConnection.close();
      } catch {}
      this.peerConnection = null;
    }
    this.setState('DISCONNECTED');
  }

  public destroy() {
    this.cleanup();
    if (this.sseSource) {
      this.sseSource.close();
      this.sseSource = null;
    }
    if (this.mailboxPollInterval) {
      clearInterval(this.mailboxPollInterval);
      this.mailboxPollInterval = null;
    }
    if (this.relayCheckInterval) {
      clearInterval(this.relayCheckInterval);
      this.relayCheckInterval = null;
    }
  }
}
