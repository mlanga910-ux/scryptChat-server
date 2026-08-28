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

  private identity: IdentityRecord;
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
  private lastPingSentTime = 0;

  constructor(identity: IdentityRecord, events: PeerManagerEvents) {
    this.identity = identity;
    this.events = events;
    try {
      const stored = localStorage.getItem('scryptchat_relay_server_url');
      if (stored !== null && stored !== undefined) {
        this.customRelayUrl = stored;
      } else {
        // If not running directly on Render, default to the deployed Render server
        if (typeof window !== 'undefined' && window.location.hostname.includes('onrender.com')) {
          this.customRelayUrl = '';
        } else {
          this.customRelayUrl = 'https://scryptchat.onrender.com';
        }
      }
    } catch {
      this.customRelayUrl = 'https://scryptchat.onrender.com';
    }
    this.checkRelayHealth();
    this.startMailboxPolling();
    this.startRelayHealthCheck();
  }

  public getRelayBaseUrl(): string {
    if (this.customRelayUrl && this.customRelayUrl.trim()) {
      return this.customRelayUrl.trim().replace(/\/+$/, '');
    }
    return '';
  }

  public setRelayBaseUrl(url: string) {
    const cleaned = (url || '').trim().replace(/\/+$/, '');
    this.customRelayUrl = cleaned;
    try {
      if (cleaned) {
        localStorage.setItem('scryptchat_relay_server_url', cleaned);
      } else {
        localStorage.removeItem('scryptchat_relay_server_url');
      }
    } catch {}
    this.checkRelayHealth();
  }

  public async fetchRelay(endpoint: string, options: RequestInit = {}, timeoutMs = 4500): Promise<Response> {
    const baseUrl = this.getRelayBaseUrl();
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    // Add anti-caching query parameter to prevent browser & CDN false-positive cache hits
    const cacheBuster = `_cb=${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const separator = cleanEndpoint.includes('?') ? '&' : '?';
    const finalEndpoint = `${cleanEndpoint}${separator}${cacheBuster}`;
    const url = baseUrl ? `${baseUrl}${finalEndpoint}` : finalEndpoint;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...options,
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          ...(options.headers || {}),
        },
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
  }

  private setState(newState: ConnectionState) {
    this.state = newState;
    this.events.onStateChange(newState);
  }

  public isConnected(): boolean {
    return this.state === 'CONNECTED' && this.dataChannel?.readyState === 'open';
  }

  /**
   * INITIATOR STEP 1: Create WebRTC Offer & Handshake Package with rolling 60s info
   */
  public async createOffer(): Promise<HandshakeOfferData> {
    this.cleanup();
    this.currentRole = 'initiator';
    this.setState('CONNECTING');

    // 1. Generate Ephemeral ECDH keypair
    const ephemeral = await generateEphemeralECDH();
    this.ephemeralKeyPair = ephemeral.keyPair;
    this.ephemeralPublicKeyRaw = ephemeral.rawPublicKey;
    this.ephemeralPublicKeyBase64 = ephemeral.publicKeyBase64;

    // 2. Generate HandshakeSalt (32 bytes) & ChallengeNonceA (16 bytes)
    this.handshakeSalt = generateRandomBytes(32);
    this.challengeNonceA = generateRandomBytes(16);

    // 3. Create RTCPeerConnection and RTCDataChannel
    this.peerConnection = new RTCPeerConnection(RTC_CONFIG);
    this.setupPeerConnectionEvents();

    this.dataChannel = this.peerConnection.createDataChannel('scryptChat-v3.1', {
      ordered: true,
    });
    this.setupDataChannelEvents();

    // 4. Create SDP offer and wait for ICE gathering
    const offer = await this.peerConnection.createOffer();
    await this.peerConnection.setLocalDescription(offer);

    await this.waitForIceCandidates(this.peerConnection);

    const localDesc = this.peerConnection.localDescription!;
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
        type: localDesc.type,
        sdp: localDesc.sdp,
      },
    };

    return offerData;
  }

  /**
   * RESPONDER STEP 1: Process Offer, Generate Ephemeral ECDH, Sign Transcript, Create Answer
   */
  public async acceptOffer(offerData: HandshakeOfferData): Promise<HandshakeAnswerData> {
    this.cleanup();
    this.currentRole = 'responder';
    this.setState('CONNECTING');

    this.remoteDeviceId = offerData.deviceId;
    this.remoteDisplayName = offerData.displayName || `Peer-${offerData.deviceId.slice(4, 8)}`;
    this.remoteIdentityPublicKeyRaw = base64ToArrayBuffer(offerData.identityPublicKeyRaw);
    this.remoteEphemeralPublicKeyRaw = base64ToArrayBuffer(offerData.ephemeralPublicKeyRaw);
    this.challengeNonceA = base64ToArrayBuffer(offerData.challengeNonce);
    this.handshakeSalt = base64ToArrayBuffer(offerData.handshakeSalt);

    // 1. Generate Ephemeral ECDH keypair for responder
    const ephemeral = await generateEphemeralECDH();
    this.ephemeralKeyPair = ephemeral.keyPair;
    this.ephemeralPublicKeyRaw = ephemeral.rawPublicKey;
    this.ephemeralPublicKeyBase64 = ephemeral.publicKeyBase64;
    this.challengeNonceB = generateRandomBytes(16);

    // 2. Setup RTCPeerConnection
    this.peerConnection = new RTCPeerConnection(RTC_CONFIG);
    this.setupPeerConnectionEvents();

    this.peerConnection.ondatachannel = (e) => {
      this.dataChannel = e.channel;
      this.setupDataChannelEvents();
    };

    await this.peerConnection.setRemoteDescription(new RTCSessionDescription(offerData.sdp));
    const answer = await this.peerConnection.createAnswer();
    await this.peerConnection.setLocalDescription(answer);

    await this.waitForIceCandidates(this.peerConnection);

    const localDesc = this.peerConnection.localDescription!;

    // 3. Compute Canonical Transcript & Signature
    const ourIdentityRaw = base64ToArrayBuffer(this.identity.publicKeyRaw);
    const sdpHash = await sha256(new TextEncoder().encode(localDesc.sdp || ''));

    const transcriptHash = await computeTranscriptHash({
      protocolVer: PROTOCOL_VERSION,
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

    // 4. Derive Directional Keys
    const peerEphemeralCryptoKey = await importPeerECDHKey(offerData.ephemeralPublicKeyRaw);
    const sessionKeys = await deriveSessionKeys(
      this.ephemeralKeyPair.privateKey,
      peerEphemeralCryptoKey,
      this.handshakeSalt,
      transcriptHash
    );

    const safetyNumber = await computeSafetyNumber(ourIdentityRaw, this.remoteIdentityPublicKeyRaw);
    const sessionId = new DataView(transcriptHash.buffer, transcriptHash.byteOffset, 8).getBigUint64(0, false);

    // Responder: sendKey is B2A, recvKey is A2B
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

    // Save contact record in DB
    await this.saveContact(this.remoteDeviceId, offerData.identityPublicKeyRaw, safetyNumber, this.remoteDisplayName);

    const answerData: HandshakeAnswerData = {
      protocolVer: PROTOCOL_VERSION,
      role: 'responder',
      deviceId: this.identity.deviceId,
      displayName: this.identity.displayName || 'Secure Peer',
      identityPublicKeyRaw: this.identity.publicKeyRaw,
      ephemeralPublicKeyRaw: this.ephemeralPublicKeyBase64,
      challengeNonce: arrayBufferToBase64(this.challengeNonceB),
      sdp: {
        type: localDesc.type,
        sdp: localDesc.sdp,
      },
      signature,
    };

    return answerData;
  }

  /**
   * INITIATOR STEP 2: Process Answer, Verify Responder's ECDSA Signature, Derive Session Keys
   */
  public async acceptAnswer(answerData: HandshakeAnswerData): Promise<HandshakeFinalizeData> {
    if (!this.peerConnection || !this.ephemeralKeyPair || !this.ephemeralPublicKeyRaw || !this.challengeNonceA || !this.handshakeSalt) {
      throw new Error('Initiator state is invalid or missing');
    }

    this.remoteDeviceId = answerData.deviceId;
    this.remoteDisplayName = answerData.displayName || `Peer-${answerData.deviceId.slice(4, 8)}`;
    this.remoteIdentityPublicKeyRaw = base64ToArrayBuffer(answerData.identityPublicKeyRaw);
    this.remoteEphemeralPublicKeyRaw = base64ToArrayBuffer(answerData.ephemeralPublicKeyRaw);
    this.challengeNonceB = base64ToArrayBuffer(answerData.challengeNonce);

    await this.peerConnection.setRemoteDescription(new RTCSessionDescription(answerData.sdp));

    // 1. Verify Responder's Signature on Canonical Transcript
    const ourIdentityRaw = base64ToArrayBuffer(this.identity.publicKeyRaw);
    const sdpHash = await sha256(new TextEncoder().encode(answerData.sdp.sdp || ''));

    const transcriptHash = await computeTranscriptHash({
      protocolVer: PROTOCOL_VERSION,
      identityPublicKeyA: ourIdentityRaw,
      ephemeralPublicKeyA: this.ephemeralPublicKeyRaw,
      challengeNonceA: this.challengeNonceA,
      identityPublicKeyB: this.remoteIdentityPublicKeyRaw,
      ephemeralPublicKeyB: this.remoteEphemeralPublicKeyRaw,
      challengeNonceB: this.challengeNonceB,
      handshakeSalt: this.handshakeSalt,
      sdpFingerprintSHA256: sdpHash,
    });

    const peerIdentityKey = await importPeerECDSAKey(answerData.identityPublicKeyRaw);
    const isValidSignature = await verifyTranscriptSignature(
      peerIdentityKey,
      transcriptHash,
      answerData.signature
    );

    if (!isValidSignature) {
      this.cleanup();
      throw new Error('SECURITY ALERT: Responder ECDSA Signature over Transcript Hash is INVALID (MITM Attack Blocked)!');
    }

    // 2. Sign for Initiator
    const ourSignature = await signTranscriptHash(this.identity.privateKeyECDSA, transcriptHash);

    // 3. Derive Directional Keys
    const peerEphemeralCryptoKey = await importPeerECDHKey(answerData.ephemeralPublicKeyRaw);
    const sessionKeys = await deriveSessionKeys(
      this.ephemeralKeyPair.privateKey,
      peerEphemeralCryptoKey,
      this.handshakeSalt,
      transcriptHash
    );

    const safetyNumber = await computeSafetyNumber(ourIdentityRaw, this.remoteIdentityPublicKeyRaw);
    const sessionId = new DataView(transcriptHash.buffer, transcriptHash.byteOffset, 8).getBigUint64(0, false);

    // Initiator: sendKey is A2B, recvKey is B2A
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

    return {
      protocolVer: PROTOCOL_VERSION,
      role: 'initiator',
      signature: ourSignature,
    };
  }

  private async saveContact(deviceId: string, publicKeyRaw: string, safetyNumber: string, alias?: string): Promise<ContactRecord> {
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

  private waitForIceCandidates(pc: RTCPeerConnection): Promise<void> {
    return new Promise((resolve) => {
      if (pc.iceGatheringState === 'complete') {
        resolve();
        return;
      }
      const checkState = () => {
        if (pc.iceGatheringState === 'complete') {
          pc.removeEventListener('icegatheringstatechange', checkState);
          resolve();
        }
      };
      pc.addEventListener('icegatheringstatechange', checkState);
      setTimeout(resolve, 2000);
    });
  }

  private setupPeerConnectionEvents() {
    if (!this.peerConnection) return;
    this.peerConnection.onconnectionstatechange = () => {
      const s = this.peerConnection?.connectionState;
      if (s === 'connected') {
        if (this.dataChannel?.readyState === 'open' && this.cryptoSession) {
          this.setState('CONNECTED');
          this.startHeartbeat();
        }
      } else if (s === 'disconnected' || s === 'failed' || s === 'closed') {
        this.setState('DISCONNECTED');
        this.stopHeartbeat();
      }
    };
  }

  private setupDataChannelEvents() {
    if (!this.dataChannel) return;
    this.dataChannel.binaryType = 'arraybuffer';

    this.dataChannel.onopen = () => {
      if (this.cryptoSession) {
        this.setState('CONNECTED');
        this.startHeartbeat();
      } else {
        this.setState('HANDSHAKING');
      }
    };

    this.dataChannel.onclose = () => {
      this.setState('DISCONNECTED');
      this.stopHeartbeat();
    };

    this.dataChannel.onerror = (err) => {
      console.error('DataChannel error:', err);
      this.events.onError('DataChannel encountered an error');
    };

    this.dataChannel.onmessage = async (e: MessageEvent) => {
      await this.handleIncomingRawMessage(e.data);
    };
  }

  private async handleIncomingRawMessage(data: ArrayBuffer | string) {
    if (typeof data === 'string') return;
    if (!this.cryptoSession || !this.dataChannel) return;

    const rawBytes = new Uint8Array(data);
    if (rawBytes.byteLength < 24) return;

    const headerBytes = rawBytes.slice(0, 24);
    const ciphertextBytes = rawBytes.slice(24);

    try {
      const header = parsePacketHeader(headerBytes);
      const decryptedPayload = await this.cryptoSession.decryptFrame(
        headerBytes,
        ciphertextBytes,
        BigInt(header.sequenceIndex)
      );

      switch (header.packetType) {
        case PacketType.TEXT_MESSAGE: {
          const text = new TextDecoder().decode(decryptedPayload);
          const msgRecord: MessageRecord = {
            chatDeviceId: this.remoteDeviceId,
            direction: 'INBOUND',
            payloadText: text,
            mediaType: 'text',
            timestamp: Date.now(),
            status: 'verified',
          };
          const id = await db.messages.add(msgRecord);
          msgRecord.id = id;
          this.events.onMessageReceived(msgRecord);
          break;
        }

        case PacketType.FILE_HEADER:
        case PacketType.FILE_CHUNK:
        case PacketType.CHUNK_ACK: {
          await fileTransferManager.handleIncomingPacket(
            header.packetType,
            header.objectId,
            header.sequenceIndex,
            decryptedPayload,
            this.dataChannel,
            this.cryptoSession,
            {
              onProgress: this.events.onFileProgress,
              onCompleted: async (fileRecord, blob) => {
                const mediaType = fileRecord.isImage
                  ? 'image'
                  : fileRecord.isAudio
                  ? 'audio'
                  : fileRecord.isVideo
                  ? 'video'
                  : 'file';

                const msgRecord: MessageRecord = {
                  chatDeviceId: this.remoteDeviceId,
                  direction: 'INBOUND',
                  payloadText: fileRecord.name,
                  fileId: fileRecord.fileId,
                  fileRecord,
                  mediaType,
                  timestamp: Date.now(),
                  status: 'verified',
                };
                const id = await db.messages.add(msgRecord);
                msgRecord.id = id;
                this.events.onMessageReceived(msgRecord);
                this.events.onFileCompleted(fileRecord, blob);
              },
              onError: (fileId, err) => {
                this.events.onError(`File transfer error: ${err}`);
              },
            }
          );
          break;
        }

        case PacketType.HEARTBEAT_PING_PONG: {
          if (header.flags === 0x00) {
            // Reply with Pong
            const pongHeader = buildPacketHeader(
              PacketType.HEARTBEAT_PING_PONG,
              this.cryptoSession.sessionId,
              header.objectId,
              header.sequenceIndex,
              0x01
            );
            const encryptedPong = await this.cryptoSession.encryptFrame(
              pongHeader,
              new Uint8Array(0)
            );
            this.dataChannel.send(encryptedPong);
          } else {
            // Pong received
            const now = Date.now();
            if (this.lastPingSentTime > 0) {
              const rtt = now - this.lastPingSentTime;
              this.events.onLatencyUpdate(rtt);
            }
          }
          break;
        }
      }
    } catch (err) {
      console.error('Packet processing error:', err);
    }
  }

  /**
   * Sends a message directly via WebRTC if connected, or queues into the Encrypted Mailbox if offline.
   */
  public async sendTextMessage(text: string, targetDeviceId?: string): Promise<MessageRecord> {
    const recipientId = targetDeviceId || this.remoteDeviceId || this.activeContact?.deviceId;
    if (!recipientId) {
      throw new Error('No recipient device specified');
    }

    if (this.isConnected() && this.cryptoSession && this.dataChannel && recipientId === this.remoteDeviceId) {
      // Direct WebRTC transmission
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
      return msgRecord;
    } else {
      // Offline / Relay Mailbox Queueing
      const envelope = JSON.stringify({
        text,
        senderDeviceId: this.identity.deviceId,
        senderDisplayName: this.identity.displayName || 'Secure Peer',
        timestamp: Date.now(),
      });

      // Post to relay mailbox buffer
      try {
        await this.fetchRelay('/api/signaling/mailbox/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            senderDeviceId: this.identity.deviceId,
            recipientDeviceId: recipientId,
            encryptedEnvelope: btoa(unescape(encodeURIComponent(envelope))),
          }),
        });
      } catch (err) {
        console.warn('Mailbox relay buffer write error:', err);
      }

      const msgRecord: MessageRecord = {
        chatDeviceId: recipientId,
        direction: 'OUTBOUND',
        payloadText: text,
        mediaType: 'text',
        timestamp: Date.now(),
        status: 'queued',
        offlineEnvelope: true,
      };

      const id = await db.messages.add(msgRecord);
      msgRecord.id = id;
      return msgRecord;
    }
  }

  /**
   * Sends a file across active WebRTC session or queues metadata for offline peer.
   */
  public async sendFile(file: File, targetDeviceId?: string): Promise<FileRecord> {
    const recipientId = targetDeviceId || this.remoteDeviceId || this.activeContact?.deviceId;

    if (this.isConnected() && this.cryptoSession && this.dataChannel && recipientId === this.remoteDeviceId) {
      return await fileTransferManager.sendFile(
        file,
        this.dataChannel,
        this.cryptoSession,
        {
          onProgress: this.events.onFileProgress,
          onCompleted: async (rec) => {
            const mediaType = rec.isImage
              ? 'image'
              : rec.isAudio
              ? 'audio'
              : rec.isVideo
              ? 'video'
              : 'file';

            const msgRecord: MessageRecord = {
              chatDeviceId: recipientId,
              direction: 'OUTBOUND',
              payloadText: rec.name,
              fileId: rec.fileId,
              fileRecord: rec,
              mediaType,
              timestamp: Date.now(),
              status: 'delivered',
            };
            const id = await db.messages.add(msgRecord);
            msgRecord.id = id;
            this.events.onMessageReceived(msgRecord);
          },
          onError: (fId, err) => {
            this.events.onError(err);
          },
        }
      );
    } else {
      // Offline file queueing
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

      // If under 4MB, send as offline base64 envelope
      if (file.size <= 4 * 1024 * 1024) {
        const base64Content = arrayBufferToBase64(fileBytes);
        try {
          await this.fetchRelay('/api/signaling/mailbox/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              senderDeviceId: this.identity.deviceId,
              recipientDeviceId: recipientId,
              encryptedEnvelope: btoa(JSON.stringify({ fileName: file.name, fileId, mimeType: mime })),
              fileMetadata: {
                fileId,
                name: file.name,
                size: file.size,
                mimeType: mime,
                hashSHA256: hashHex,
              },
              fileBase64Chunk: base64Content,
            }),
          });
        } catch (mErr) {
          console.warn('Mailbox file buffer error:', mErr);
        }
      }

      const mediaType = isImage ? 'image' : isAudio ? 'audio' : isVideo ? 'video' : 'file';
      const msgRecord: MessageRecord = {
        chatDeviceId: recipientId,
        direction: 'OUTBOUND',
        payloadText: file.name,
        fileId,
        fileRecord,
        mediaType,
        timestamp: Date.now(),
        status: 'queued',
        offlineEnvelope: true,
      };

      const id = await db.messages.add(msgRecord);
      msgRecord.id = id;
      this.events.onMessageReceived(msgRecord);

      return fileRecord;
    }
  }

  public async checkRelayHealth(): Promise<RelayStatus> {
    const startTime = performance.now();
    try {
      const res = await this.fetchRelay('/api/signaling/status', {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
      }, 4500);

      if (res.ok) {
        const elapsed = Math.round(performance.now() - startTime);
        const stats: RelayServerStats = await res.json();
        this.relayStatus = 'ONLINE';
        this.relayStats = stats;
        this.relayPingMs = elapsed;
        this.relayErrorReason = null;
        this.events.onRelayStatusChange?.('ONLINE', stats, elapsed, undefined);
        return 'ONLINE';
      } else {
        const isRestarting = res.status === 502 || res.status === 503 || res.status === 504;
        const status: RelayStatus = isRestarting ? 'RESTARTING' : 'OFFLINE';
        const reason = isRestarting
          ? `Server instance restarting/waking up (HTTP ${res.status})`
          : `Signaling server returned HTTP ${res.status}`;
        this.relayStatus = status;
        this.relayPingMs = null;
        this.relayErrorReason = reason;
        this.events.onRelayStatusChange?.(status, undefined, null, reason);
        return status;
      }
    } catch (err: any) {
      const isTimeout = err?.name === 'AbortError';
      const status: RelayStatus = isTimeout ? 'RESTARTING' : 'OFFLINE';
      const reason = isTimeout
        ? 'Signaling connection timed out (Server sleeping or restarting on Render)'
        : (err?.message || 'Network error connecting to signaling server');
      this.relayStatus = status;
      this.relayPingMs = null;
      this.relayErrorReason = reason;
      this.events.onRelayStatusChange?.(status, undefined, null, reason);
      return status;
    }
  }

  /**
   * Explicitly confirm WebRTC pairing match on the signaling server
   */
  public async confirmPairingOnRelay(roomId: string): Promise<boolean> {
    try {
      const res = await this.fetchRelay(`/api/signaling/room/${roomId}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: this.identity.deviceId }),
      }, 4000);
      if (!res.ok) return false;
      const data = await res.json();
      return !!data.success && !!data.isConfirmed;
    } catch (e) {
      console.warn('Signaling pairing confirmation warning:', e);
      return false;
    }
  }

  private startRelayHealthCheck() {
    if (this.relayCheckInterval) {
      clearInterval(this.relayCheckInterval);
    }
    this.relayCheckInterval = setInterval(() => {
      this.checkRelayHealth();
    }, 5000);
  }

  private startMailboxPolling() {
    this.mailboxPollInterval = setInterval(async () => {
      if (!this.identity?.deviceId) return;
      try {
        // 1. Send Presence Heartbeat Ping
        await this.fetchRelay('/api/signaling/presence', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            deviceId: this.identity.deviceId,
            displayName: this.identity.displayName || 'Secure Peer',
          }),
        }, 3000).catch(() => {});

        // 2. Query Presence for all known contacts
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

        // 3. Pull Encrypted Mailbox items
        const res = await this.fetchRelay(`/api/signaling/mailbox/pull/${this.identity.deviceId}`, {
          method: 'GET',
          headers: { 'Accept': 'application/json' },
        }, 3500);

        if (res.ok) {
          const data = await res.json();
          if (data.success && Array.isArray(data.items) && data.items.length > 0) {
            for (const item of data.items) {
              try {
                const decodedJson = decodeURIComponent(escape(atob(item.encryptedEnvelope)));
                const envelope = JSON.parse(decodedJson);

              let fileId = undefined;
              let fileRecord = undefined;

              if (item.fileMetadata && item.fileBase64Chunk) {
                const fileBytes = base64ToArrayBuffer(item.fileBase64Chunk);
                const blob = new Blob([fileBytes], { type: item.fileMetadata.mimeType });
                fileRecord = {
                  fileId: item.fileMetadata.fileId,
                  name: item.fileMetadata.name,
                  size: item.fileMetadata.size,
                  mimeType: item.fileMetadata.mimeType,
                  hashSHA256: item.fileMetadata.hashSHA256,
                  blobRef: blob,
                  isImage: item.fileMetadata.mimeType.startsWith('image/'),
                  isAudio: item.fileMetadata.mimeType.startsWith('audio/'),
                  isVideo: item.fileMetadata.mimeType.startsWith('video/'),
                };
                await db.files.put(fileRecord);
                fileId = fileRecord.fileId;
              }

              const msgRecord: MessageRecord = {
                chatDeviceId: item.senderDeviceId,
                direction: 'INBOUND',
                payloadText: envelope.text || fileRecord?.name || '[Encrypted Message]',
                fileId,
                fileRecord,
                mediaType: fileRecord?.isImage ? 'image' : fileRecord?.isAudio ? 'audio' : fileRecord ? 'file' : 'text',
                timestamp: item.timestamp,
                status: 'verified',
              };

              const id = await db.messages.add(msgRecord);
              msgRecord.id = id;

              // Ensure contact exists
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
              console.warn('Mailbox item decode error:', pErr);
            }
          }
        }
      }
    } catch (err) {
      // Silent poll error
    }
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
