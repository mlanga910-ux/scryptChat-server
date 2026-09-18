import {
  AckStatus,
  ContactRecord,
  FileRecord,
  FileTransferProgress,
  GroupRecord,
  HandshakeAnswerData,
  HandshakeFinalizeData,
  HandshakeOfferData,
  IdentityRecord,
  MessageRecord,
  MessageStatus,
  PacketType,
  PROTOCOL_VERSION,
  ProfileSyncPayload,
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
  reimportIdentityKeys,
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
  // Pre-gather candidates so same-LAN devices negotiate a direct host route
  // immediately, and keep media/data on a single transport for lower overhead.
  iceCandidatePoolSize: 4,
  bundlePolicy: 'max-bundle',
  rtcpMuxPolicy: 'require',
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
  onContactsPresencesUpdate?: (presences?: Record<string, { isOnline: boolean; lastSeen: number }>) => void;
  onMessageReceived: (message: MessageRecord) => void;
  onFileProgress: (progress: FileTransferProgress) => void;
  onFileCompleted: (fileRecord: FileRecord, blob: Blob) => void;
  onMediaSignal?: (signal: any) => void;
  onPeerInfo: (contact: ContactRecord) => void;
  onError: (error: string) => void;
  onLatencyUpdate: (ms: number) => void;
  /** Reports how a live link is routed: local network, direct WebRTC or relay. */
  onTransportUpdate?: (info: { deviceId: string; transport: PeerTransport }) => void;
  /** A message we stored locally changed delivery state (sent/delivered/read/failed). */
  onMessageStatusChange?: (
    messageId: string,
    status: MessageStatus,
    chatDeviceId: string
  ) => void;
  /** The peer started or stopped typing. */
  onTypingState?: (info: { deviceId: string; isTyping: boolean }) => void;
}

/**
 * A locally stored message that has not been confirmed by the peer yet. The
 * outbox keeps re-sending it on a backoff, over the direct link when it exists
 * and through the encrypted relay otherwise, until an acknowledgement arrives.
 */
interface OutboxEntry {
  messageId: string;
  chatDeviceId: string;
  kind: 'text' | 'file';
  text?: string;
  fileId?: string;
  attempts: number;
  nextAttemptAt: number;
  everSent?: boolean;
  lastError?: string;
}

export type PeerTransport = 'lan' | 'direct' | 'relay';

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
  /** Route currently carrying traffic to the connected peer. */
  public transport: PeerTransport = 'relay';
  private transportTimer: any = null;
  private presenceBeaconBound = false;
  /** Last presence snapshot we surfaced, so idle polls do not churn the UI. */
  private lastPresenceSignature = '';

  public identity: IdentityRecord;
  private events: PeerManagerEvents;

  // Ephemeral handshake states
  private ephemeralKeyPair: CryptoKeyPair | null = null;
  private ephemeralPublicKeyRaw: Uint8Array | null = null;
  private ephemeralPublicKeyBase64 = '';
  private handshakeSalt: Uint8Array | null = null;
  private challengeNonceA: Uint8Array | null = null;
  /**
   * The exact offer SDP string we handed to the relay. The transcript hash must
   * fingerprint what the peer actually received, not the local description as
   * it looks later (ICE gathering keeps appending candidates, which used to
   * break the signature check on the initiator side).
   */
  private sentOfferSdp: string | null = null;

  /** Max characters per profile frame — safely under every browser's limit. */
  private static readonly PROFILE_CHUNK_CHARS = 7000;
  /** Partially received chunked profiles, keyed by chunk set id. */
  private profileChunks = new Map<
    string,
    { parts: Map<number, string>; total: number; startedAt: number }
  >();
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
  private callPollInterval: any = null;
  private sseSource: EventSource | null = null;
  private sseReconnectTimeout: any = null;
  private lastPingSentTime = 0;
  private processedMailboxIds = new Set<string>();

  // --- Guaranteed delivery -------------------------------------------------
  private outbox = new Map<string, OutboxEntry>();
  private outboxInterval: any = null;
  /** Files currently streaming over the direct link (never re-sent mid-flight). */
  private activeFileTransfers = new Set<string>();
  private wakeBound = false;
  private typingSentAt = 0;
  private lastTypingState = false;
  private static readonly MAX_DELIVERY_ATTEMPTS = 20;
  private static readonly OUTBOX_TICK_MS = 2000;

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
    this.startCallSignalPolling();
    this.startRelayHealthCheck();
    this.bindPresenceBeacon();
    this.bindWakeHandler();
    this.startOutboxLoop();
    void this.hydrateOutbox();
  }

  /**
   * Tells the relay the moment this tab goes away, so contacts flip to offline
   * immediately instead of looking online until the next presence timeout.
   */
  private bindPresenceBeacon() {
    if (this.presenceBeaconBound || typeof window === 'undefined') return;
    this.presenceBeaconBound = true;
    const goOffline = () => {
      try {
        const body = JSON.stringify({ deviceId: this.identity?.deviceId, isOnline: false });
        const url = `${this.getRelayBaseUrl()}/api/signaling/presence`;
        if (navigator.sendBeacon) {
          navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
        } else {
          void fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body,
            keepalive: true,
          }).catch(() => {});
        }
      } catch {
        /* nothing else we can do on unload */
      }
    };
    window.addEventListener('pagehide', goOffline);
    window.addEventListener('beforeunload', goOffline);
  }

  public getRelayBaseUrl(): string {
    if (this.customRelayUrl) return this.customRelayUrl;
    if (typeof window !== 'undefined' && window.location?.origin) return window.location.origin;
    return '';
  }

  public setRelayBaseUrl(url: string) {
    this.customRelayUrl = url?.trim() || '';
    this.checkRelayHealth();
    this.startRealtimeStream();
  }

  /**
   * Manual retry from the UI. Re-probes the relay and reopens the push stream so
   * a user never has to reload the page to get live pairing back.
   * Everything else in the app keeps working while the relay is unreachable.
   */
  public reconnectRelay() {
    this.relayStatus = 'CONNECTING';
    this.relayErrorReason = null;
    this.events.onRelayStatusChange?.('CONNECTING', undefined, null, undefined);
    this.startRealtimeStream();
    void this.checkRelayHealth();
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
    const profileChanged =
      identity.displayName !== this.identity.displayName ||
      identity.avatarUrl !== this.identity.avatarUrl ||
      identity.avatarColor !== this.identity.avatarColor ||
      identity.statusBio !== this.identity.statusBio ||
      identity.status !== this.identity.status;
    this.identity = identity;
    this.startRealtimeStream();
    // A photo or name change must reach paired devices immediately.
    if (profileChanged) void this.sendProfileUpdate();
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
        // No invented latency: the status chip shows a ping only once the health
        // probe has actually measured one.
        this.events.onRelayStatusChange?.('ONLINE', { status: 'online' }, undefined, undefined);
        // The stream is back: anything still unsent gets another chance.
        this.flushOutbox();
      });

      sse.addEventListener('mailbox_item', (e: MessageEvent) => {
        try {
          const item = JSON.parse(e.data);
          this.processIncomingMailboxItem(item);
        } catch (err) {
          console.warn('SSE mailbox item parse error:', err);
        }
      });

      sse.addEventListener('call_signal', (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data);
          const signal = data.signal || data;
          if (data.senderDeviceId !== this.identity.deviceId && signal) {
            this.events.onMediaSignal?.(signal);
          }
        } catch (err) {
          console.warn('SSE call_signal parse error:', err);
        }
      });

      sse.onerror = () => {
        sse.close();
        this.sseSource = null;
        // A dropped push stream is not a dead relay: the health probe decides
        // the reported status, and polling keeps messages flowing meanwhile.
        if (!this.sseReconnectTimeout) {
          this.sseReconnectTimeout = setTimeout(() => {
            this.startRealtimeStream();
          }, 3000);
        }
      };
    } catch {}
  }

  /**
   * Phones freeze timers and drop the push stream while a tab is in the
   * background. Waking up must feel instant, so we re-open the stream, probe
   * the relay, pull anything queued and replay the outbox right away.
   */
  private bindWakeHandler() {
    if (this.wakeBound || typeof document === 'undefined') return;
    this.wakeBound = true;
    const wake = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      if (!this.sseSource) this.startRealtimeStream();
      void this.checkRelayHealth();
      void this.pullMailboxNow();
      this.flushOutbox();
    };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('online', wake);
    window.addEventListener('focus', wake);
  }

  /** One immediate mailbox pull, for wake/reconnect instead of the poll tick. */
  public async pullMailboxNow(): Promise<void> {
    if (!this.identity?.deviceId) return;
    try {
      const res = await this.fetchRelay(
        `/api/signaling/mailbox/pull/${this.identity.deviceId}`,
        { method: 'GET', headers: { Accept: 'application/json' } },
        5000
      );
      if (!res.ok) return;
      const data = await res.json();
      if (data.success && Array.isArray(data.items)) {
        for (const item of data.items) {
          await this.processIncomingMailboxItem(item);
        }
      }
    } catch {
      /* the poll tick will try again */
    }
  }

  private startOutboxLoop() {
    if (this.outboxInterval) clearInterval(this.outboxInterval);
    this.outboxInterval = setInterval(() => void this.tickOutbox(), PeerManager.OUTBOX_TICK_MS);
  }

  /** Messages left unsent by a reload or a crash are picked up again. */
  private async hydrateOutbox(): Promise<void> {
    try {
      const pending = await db.messages
        .filter(
          (m) =>
            m.direction === 'OUTBOUND' &&
            (m.status === 'sending' || m.status === 'queued')
        )
        .toArray();
      for (const msg of pending) {
        if (!msg.messageId) continue;
        this.registerOutbox({
          messageId: msg.messageId,
          chatDeviceId: msg.chatDeviceId,
          kind: msg.fileId ? 'file' : 'text',
          text: msg.fileId ? undefined : msg.payloadText,
          fileId: msg.fileId,
          attempts: 0,
          nextAttemptAt: Date.now() + 1500,
        });
      }
    } catch {
      /* history stays usable either way */
    }
  }

  private registerOutbox(entry: OutboxEntry) {
    this.outbox.set(entry.messageId, entry);
  }

  /** Replays everything unconfirmed — used when a link or the relay comes back. */
  public flushOutbox() {
    if (this.outbox.size === 0) return;
    for (const entry of this.outbox.values()) entry.nextAttemptAt = 0;
    void this.tickOutbox();
  }

  public getPendingCount(): number {
    return this.outbox.size;
  }

  /** Manual re-send, used by the retry action on a failed message. */
  public async retryMessage(messageId: string): Promise<void> {
    const row = await db.messages.where('messageId').equals(messageId).first();
    if (!row || !row.messageId) return;
    await this.setMessageStatus(messageId, 'sending');
    this.registerOutbox({
      messageId,
      chatDeviceId: row.chatDeviceId,
      kind: row.fileId ? 'file' : 'text',
      text: row.fileId ? undefined : row.payloadText,
      fileId: row.fileId,
      attempts: 0,
      nextAttemptAt: Date.now(),
    });
    void this.tickOutbox();
  }

  private async setMessageStatus(messageId: string, status: MessageStatus): Promise<void> {
    try {
      await db.messages.where('messageId').equals(messageId).modify({ status });
    } catch {
      /* nothing else to do when the row is gone */
    }
    const row = await db.messages.where('messageId').equals(messageId).first();
    this.events.onMessageStatusChange?.(messageId, status, row?.chatDeviceId || '');
  }

  /**
   * The delivery loop. Messages stay here until the peer acknowledges them, so
   * "sent" on the sender's side always means "stored on the other device".
   */
  private async tickOutbox() {
    if (this.outbox.size === 0) return;
    const now = Date.now();
    for (const entry of Array.from(this.outbox.values())) {
      if (entry.nextAttemptAt > now) continue;

      const maxAttempts = entry.everSent
        ? 6
        : entry.kind === 'file'
        ? 60
        : PeerManager.MAX_DELIVERY_ATTEMPTS;
      if (entry.attempts >= maxAttempts) {
        this.outbox.delete(entry.messageId);
        if (!entry.everSent) await this.setMessageStatus(entry.messageId, 'failed');
        continue;
      }

      entry.attempts += 1;
      let delay = this.retryDelay(entry);
      try {
        await this.deliverOutboxEntry(entry);
        if (!entry.everSent) {
          entry.everSent = true;
          await this.setMessageStatus(entry.messageId, 'delivered');
          delay = 4000;
        }
      } catch (err: any) {
        entry.lastError = err?.message;
        delay = Math.max(delay, 5000);
      }
      entry.nextAttemptAt = now + delay;
    }
  }

  private retryDelay(entry: OutboxEntry): number {
    const base = entry.kind === 'file' ? 8000 : 2500;
    return Math.min(30000, base * Math.min(entry.attempts, 5));
  }

  /**
   * One delivery attempt: direct WebRTC first (zero latency, LAN-fast), then
   * the encrypted relay mailbox, which stores the message until the peer pulls
   * it — even if that device is offline right now.
   */
  private async deliverOutboxEntry(entry: OutboxEntry): Promise<void> {
    const hasDirect =
      this.isConnected() &&
      !!this.dataChannel &&
      this.dataChannel.readyState === 'open' &&
      !!this.cryptoSession &&
      entry.chatDeviceId === this.remoteDeviceId;

    if (entry.kind === 'text') {
      if (!entry.text) throw new Error('Nothing to send');
      if (hasDirect) {
        try {
          await this.sendTextOverDirect(entry.messageId, entry.text);
          return;
        } catch (err) {
          console.warn('Direct retry failed, falling back to relay:', err);
        }
      }
      await this.pushTextViaRelay(entry.chatDeviceId, entry.messageId, entry.text);
      return;
    }

    if (this.activeFileTransfers.has(entry.messageId)) return;

    const record = entry.fileId ? await db.files.get(entry.fileId) : undefined;
    const blob = record?.blobRef;
    if (!record || !blob) throw new Error('Attachment is no longer available');
    const file =
      blob instanceof File
        ? blob
        : new File([blob], record.name || 'attachment', {
            type: record.mimeType || 'application/octet-stream',
          });

    if (hasDirect) {
      try {
        await this.runDirectFileTransfer(file, entry.chatDeviceId, entry.messageId, entry.fileId!);
        return;
      } catch (err) {
        console.warn('Direct file retry failed, using relay:', err);
      }
    }
    await this.pushFileViaRelay(
      file,
      entry.chatDeviceId,
      entry.fileId!,
      record.hashSHA256 || '',
      entry.messageId
    );
  }

  /**
   * Streams an attachment over the live link. Resolves only once every chunk has
   * been acknowledged, so a stalled transfer surfaces as a failure the outbox
   * can act on instead of an attachment that silently never arrives.
   */
  private async runDirectFileTransfer(
    file: File,
    recipientId: string,
    messageId: string,
    _fileId: string
  ): Promise<void> {
    const channel = this.dataChannel;
    const session = this.cryptoSession;
    if (
      !channel ||
      !session ||
      channel.readyState !== 'open' ||
      recipientId !== this.remoteDeviceId
    ) {
      throw new Error('No open direct link');
    }
    this.activeFileTransfers.add(messageId);
    try {
      await fileTransferManager.sendFile(file, channel, session, {
        onProgress: this.events.onFileProgress,
        onCompleted: (fileRec) => {
          void db.messages
            .where('messageId')
            .equals(messageId)
            .modify({
              fileId: fileRec.fileId,
              fileRecord: fileRec,
              mediaType: fileRec.isImage
                ? 'image'
                : fileRec.isAudio
                ? 'audio'
                : fileRec.isVideo
                ? 'video'
                : 'file',
            })
            .catch(() => {});
        },
        onError: (_fileId, err) => this.events.onError(err),
      });
    } finally {
      this.activeFileTransfers.delete(messageId);
    }
  }

  private async sendTextOverDirect(messageId: string, text: string): Promise<void> {
    if (!this.cryptoSession || !this.dataChannel || this.dataChannel.readyState !== 'open') {
      throw new Error('No open direct link');
    }
    const payloadBytes = new TextEncoder().encode(JSON.stringify({ messageId, text }));
    const headerBytes = buildPacketHeader(
      PacketType.TEXT_MESSAGE,
      this.cryptoSession.sessionId,
      BigInt('0x' + generateRandomHexId(8)),
      Number(this.cryptoSession.getNextSendCounter())
    );
    const frame = await this.cryptoSession.encryptFrame(headerBytes, payloadBytes);
    this.dataChannel.send(frame);
  }

  private async pushTextViaRelay(
    recipientId: string,
    messageId: string,
    text: string
  ): Promise<void> {
    await this.pushEnvelope(recipientId, {
      type: 'TEXT',
      messageId,
      text,
      senderDeviceId: this.identity.deviceId,
      senderDisplayName: this.identity.displayName || 'Secure Peer',
      timestamp: Date.now(),
    });
  }

  /** Pushes an encrypted envelope into the peer's relay mailbox. */
  private async pushEnvelope(
    recipientId: string,
    envelope: Record<string, any>,
    timeoutMs = 8000
  ): Promise<void> {
    const encryptedEnvelope = btoa(unescape(encodeURIComponent(JSON.stringify(envelope))));
    const response = await this.fetchRelay(
      '/api/signaling/mailbox/send',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          senderDeviceId: this.identity.deviceId,
          recipientDeviceId: recipientId,
          encryptedEnvelope,
          timestamp: Date.now(),
        }),
      },
      timeoutMs
    );
    if (!response.ok) throw new Error(`Relay returned HTTP ${response.status}`);
  }

  /**
   * Confirms receipt back to the sender. Their outbox keeps retrying until this
   * lands, which is what turns delivery from best-effort into guaranteed.
   */
  public async sendDeliveryAck(
    ack: { messageId?: string; fileId?: string },
    targetDeviceId: string,
    preferDirect: boolean
  ): Promise<void> {
    if (!targetDeviceId) return;
    if (
      preferDirect &&
      this.cryptoSession &&
      this.dataChannel?.readyState === 'open' &&
      targetDeviceId === this.remoteDeviceId
    ) {
      try {
        const session = this.cryptoSession;
        const headerBytes = buildPacketHeader(
          PacketType.DELIVERY_ACK,
          session.sessionId,
          BigInt('0x' + generateRandomHexId(8)),
          Number(session.getNextSendCounter())
        );
        const frame = await session.encryptFrame(
          headerBytes,
          new TextEncoder().encode(JSON.stringify(ack))
        );
        this.dataChannel.send(frame);
        return;
      } catch (err) {
        console.warn('Direct delivery ack failed, using relay:', err);
      }
    }
    try {
      await this.pushEnvelope(targetDeviceId, { type: 'DELIVERY_ACK', ...ack }, 6000);
    } catch {
      /* the sender keeps retrying and will ask again */
    }
  }

  private async handleDeliveryAck(payload: { messageId?: string; fileId?: string }): Promise<void> {
    let messageId = payload.messageId;
    if (!messageId && payload.fileId) {
      const byFile = await db.messages.where('fileId').equals(payload.fileId).first();
      messageId = byFile?.messageId;
    }
    if (!messageId) return;
    this.outbox.delete(messageId);
    const row = await db.messages.where('messageId').equals(messageId).first();
    if (!row || row.direction !== 'OUTBOUND') return;
    if (row.status === 'delivered' || row.status === 'read') return;
    await this.setMessageStatus(messageId, 'delivered');
  }

  /**
   * Tells the peer that messages were actually read (chat open on this side),
   * which upgrades their ticks from delivered to read.
   */
  public async sendReadReceipt(chatDeviceId: string, messageIds: string[]): Promise<void> {
    if (!chatDeviceId || !messageIds || messageIds.length === 0) return;
    const payload = { type: 'READ', messageIds, senderDeviceId: this.identity.deviceId };
    if (
      this.cryptoSession &&
      this.dataChannel?.readyState === 'open' &&
      chatDeviceId === this.remoteDeviceId
    ) {
      try {
        const session = this.cryptoSession;
        const headerBytes = buildPacketHeader(
          PacketType.READ_RECEIPT,
          session.sessionId,
          BigInt('0x' + generateRandomHexId(8)),
          Number(session.getNextSendCounter())
        );
        const frame = await session.encryptFrame(
          headerBytes,
          new TextEncoder().encode(JSON.stringify(payload))
        );
        this.dataChannel.send(frame);
        return;
      } catch {
        /* falls through to the relay */
      }
    }
    try {
      await this.pushEnvelope(chatDeviceId, payload, 6000);
    } catch {
      /* read state is a nicety, never a blocker */
    }
  }

  private async markMessagesRead(messageIds?: string[]): Promise<void> {
    if (!Array.isArray(messageIds) || messageIds.length === 0) return;
    for (const messageId of messageIds) {
      const row = await db.messages.where('messageId').equals(messageId).first();
      if (!row || row.direction !== 'OUTBOUND' || row.status === 'read') continue;
      await this.setMessageStatus(messageId, 'read');
    }
  }

  /** Publishes a throttled "typing…" hint on the fastest available route. */
  public setTypingState(isTyping: boolean): void {
    const targetDeviceId = this.activeContact?.deviceId || this.remoteDeviceId;
    if (!targetDeviceId) return;
    const now = Date.now();
    if (isTyping && this.lastTypingState && now - this.typingSentAt < 2000) return;
    if (isTyping === this.lastTypingState && now - this.typingSentAt < 4000) return;
    this.lastTypingState = isTyping;
    this.typingSentAt = now;
    const envelope = { type: 'TYPING', isTyping, senderDeviceId: this.identity.deviceId };

    if (
      this.cryptoSession &&
      this.dataChannel?.readyState === 'open' &&
      targetDeviceId === this.remoteDeviceId
    ) {
      const session = this.cryptoSession;
      const channel = this.dataChannel;
      void (async () => {
        try {
          const headerBytes = buildPacketHeader(
            PacketType.TYPING_INDICATOR,
            session.sessionId,
            BigInt('0x' + generateRandomHexId(8)),
            Number(session.getNextSendCounter())
          );
          const frame = await session.encryptFrame(
            headerBytes,
            new TextEncoder().encode(JSON.stringify(envelope))
          );
          channel.send(frame);
        } catch {
          await this.pushEnvelope(targetDeviceId, envelope, 4000).catch(() => {});
        }
      })();
      return;
    }
    void this.pushEnvelope(targetDeviceId, envelope, 4000).catch(() => {});
  }

  public async processIncomingMailboxItem(item: any) {
    if (!item) return;
    try {
      if (item.id) {
        if (this.processedMailboxIds.has(item.id)) return;
        this.processedMailboxIds.add(item.id);
        if (this.processedMailboxIds.size > 500) {
          const oldest = this.processedMailboxIds.values().next().value;
          if (oldest) this.processedMailboxIds.delete(oldest);
        }
      }

      let envelope: any = {};
      if (item.encryptedEnvelope) {
        try {
          const decodedJson = decodeURIComponent(escape(atob(item.encryptedEnvelope)));
          envelope = JSON.parse(decodedJson);
        } catch {
          // Group relay packets from older clients were sent as plain JSON.
          try {
            envelope = JSON.parse(item.encryptedEnvelope);
          } catch {
            envelope = {};
          }
        }
      }

      // 1. Media Call Signal
      if (envelope.type === 'CALL_SIGNAL' || envelope.signal || envelope.action) {
        const signal = envelope.signal || envelope;
        this.events.onMediaSignal?.(signal);
        return;
      }

      // 1.02 Delivery / read / typing envelopes coming back through the relay
      if (envelope.type === 'DELIVERY_ACK') {
        await this.handleDeliveryAck(envelope);
        return;
      }
      if (envelope.type === 'READ') {
        await this.markMessagesRead(envelope.messageIds);
        return;
      }
      if (envelope.type === 'TYPING') {
        const senderId = item.senderDeviceId || envelope.senderDeviceId;
        if (senderId) {
          this.events.onTypingState?.({ deviceId: senderId, isTyping: !!envelope.isTyping });
        }
        return;
      }

      // 1.05 Profile change (photo / name / bio) pushed over the relay
      if (envelope.type === 'PROFILE') {
        await this.applyRemoteProfile(
          envelope.profile || envelope,
          item.senderDeviceId || envelope.senderDeviceId
        );
        return;
      }

      // 1.1 Contact Revocation / Deletion Sync
      if (envelope.type === 'CONTACT_REVOKED') {
        const senderId = item.senderDeviceId || envelope.senderDeviceId;
        if (senderId) {
          await db.contacts.delete(senderId);
          await db.messages.where('chatDeviceId').equals(senderId).delete();
          this.events.onContactsPresencesUpdate?.();
        }
        return;
      }

      // 2. Group message / group metadata relay packet
      if (envelope.type === 'GROUP_TEXT' || envelope.type === 'GROUP_FILE') {
        const group = envelope.group as any;
        if (group?.groupId) {
          await db.groups.put({
            ...group,
            memberDeviceIds: Array.from(
              new Set([...(group.memberDeviceIds || []), this.identity.deviceId])
            ),
            lastActivityAt: Date.now(),
          });
        }

        const messageId = envelope.messageId || item.id;
        const duplicate = await db.messages
          .filter((message) => message.messageId === messageId)
          .first();
        if (duplicate) return;

        const groupId = envelope.groupId || group?.groupId;
        if (!groupId) return;
        let groupFile: FileRecord | undefined;
        if (envelope.type === 'GROUP_FILE' && envelope.fileBase64Chunk) {
          const mimeType = envelope.mimeType || 'application/octet-stream';
          groupFile = {
            fileId: envelope.fileId,
            name: envelope.fileName,
            size: envelope.size,
            mimeType,
            hashSHA256: envelope.hashSHA256 || '',
            blobRef: new Blob([base64ToArrayBuffer(envelope.fileBase64Chunk)], { type: mimeType }),
            isImage: mimeType.startsWith('image/'),
            isAudio: mimeType.startsWith('audio/'),
            isVideo: mimeType.startsWith('video/'),
          };
          if (groupFile.fileId) await db.files.put(groupFile);
        }
        const groupMessage: MessageRecord = {
          messageId,
          chatDeviceId: groupId,
          groupId,
          isGroup: true,
          senderDeviceId: item.senderDeviceId || envelope.senderDeviceId,
          senderDisplayName: envelope.senderDisplayName,
          senderAvatarColor: envelope.senderAvatarColor,
          direction: 'INBOUND',
          payloadText: envelope.text || envelope.fileName || '[Encrypted Message]',
          fileId: groupFile?.fileId,
          fileRecord: groupFile,
          timestamp: envelope.timestamp || item.timestamp || Date.now(),
          status: 'delivered',
          mediaType: envelope.type === 'GROUP_FILE' ? 'file' : 'text',
        };
        const id = await db.messages.add(groupMessage);
        groupMessage.id = id;
        this.events.onMessageReceived(groupMessage);
        return;
      }

      // 3. File Attachment / Photo / Voice Note
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
      const messageId = envelope.messageId || item.id;

      const duplicate = await db.messages
        .filter((message) =>
          message.messageId === messageId ||
          (!!fileId && message.fileId === fileId)
        )
        .first();
      if (duplicate) return;
      // Do not turn an invalid/stale relay envelope into a fake message.
      // This was the source of the intermittent "[Encrypted Message]" rows.
      if (!fileRecord && typeof envelope.text !== 'string') return;

      const msgRecord: MessageRecord = {
        messageId,
        chatDeviceId: item.senderDeviceId,
        direction: 'INBOUND',
        payloadText: envelope.text || fileRecord?.name || '',
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

      // Confirm receipt so the sender's outbox can stop retrying.
      void this.sendDeliveryAck({ messageId, fileId }, item.senderDeviceId, false);
    } catch (pErr) {
      console.warn('Process mailbox item error:', pErr);
    }
  }

  // --- WebRTC Peer Signaling ---

  /**
   * This device can only complete a secure handshake with a real signing key.
   * Browsers without WebCrypto (an insecure context) get a clear message
   * instead of an obscure crypto failure.
   */
  private async requireSigningKey(): Promise<CryptoKey> {
    let key = this.identity.privateKeyECDSA;
    // IndexedDB can sometimes hand back a plain-object stub instead of a live
    // CryptoKey.  When that happens, re-import from the JWK in localStorage.
    if (key && !(key instanceof CryptoKey)) {
      try {
        await reimportIdentityKeys(this.identity);
        key = this.identity.privateKeyECDSA;
      } catch (err) {
        console.warn('Auto-recovery of signing key failed:', err);
      }
    }
    if (!key) {
      throw new Error(
        'Secure pairing needs WebCrypto. Open scryptChat over https (or localhost) to pair devices.'
      );
    }
    return key;
  }

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
    // Pin the negotiated SDP before anything else can touch it.
    this.sentOfferSdp = this.peerConnection.localDescription!.sdp;

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
    // Both sides must sign the same transcript. The initiator's offer SDP is
    // the stable fingerprint included in the original pairing payload.
    const sdpRaw = new TextEncoder().encode(offerData.sdp.sdp);
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

    const signingKey = await this.requireSigningKey();
    const signature = await signTranscriptHash(signingKey, transcriptHash);

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

    if (this.dataChannel?.readyState === 'open') {
      this.setState('CONNECTED');
      this.startHeartbeat();
      this.onLinkReady();
    }

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
    // Use the SDP we actually sent; a re-read local description may already
    // contain extra ICE candidates and would produce a different transcript.
    const negotiatedSdp = this.sentOfferSdp || this.peerConnection.localDescription!.sdp;
    const sdpRaw = new TextEncoder().encode(negotiatedSdp);
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

    const signingKey = await this.requireSigningKey();
    const ourSignature = await signTranscriptHash(signingKey, transcriptHash);
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
      this.onLinkReady();
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
      this.onLinkReady();
    }
  }

  /**
   * Runs once a direct link is up: exchange profiles, then keep the reported
   * route (LAN vs internet) fresh for the contact list badge.
   */
  private onLinkReady() {
    void this.sendProfileUpdate();
    // The other side may still be finishing its own handshake when our first
    // push lands, so send the profile once more shortly after.
    setTimeout(() => {
      if (this.isConnected()) void this.sendProfileUpdate();
    }, 2500);
    void this.detectTransport();
    // A fresh zero-latency link: replay everything still waiting on it.
    this.flushOutbox();
    if (this.transportTimer) clearInterval(this.transportTimer);
    this.transportTimer = setInterval(() => void this.detectTransport(), 8000);
  }

  /**
   * Reads the selected ICE candidate pair to tell a same-network (host-to-host)
   * link apart from a link that goes out through a STUN/TURN route.
   */
  public async detectTransport(): Promise<PeerTransport> {
    const pc = this.peerConnection;
    if (!pc || !this.isConnected()) return this.transport;
    try {
      const stats = await pc.getStats();
      let transportId: string | undefined;
      let pair: any = null;
      stats.forEach((report: any) => {
        if (report.type === 'transport' && report.selectedCandidatePairId) {
          transportId = report.selectedCandidatePairId;
        }
      });
      stats.forEach((report: any) => {
        if (report.type !== 'candidate-pair') return;
        if (transportId && report.id === transportId) pair = report;
        else if (!pair && report.selected && report.state === 'succeeded') pair = report;
      });
      if (!pair) return this.transport;
      const local = stats.get(pair.localCandidateId) as any;
      const remote = stats.get(pair.remoteCandidateId) as any;
      const isHostPair = local?.candidateType === 'host' && remote?.candidateType === 'host';
      const next: PeerTransport = isHostPair ? 'lan' : 'direct';
      if (next !== this.transport || this.activeContact?.deviceId !== this.remoteDeviceId) {
        this.transport = next;
        // Tune the file pipeline for the route we actually got.
        fileTransferManager.setLanHint(next === 'lan');
        const deviceId = this.remoteDeviceId;
        this.events.onTransportUpdate?.({ deviceId, transport: next });
        if (deviceId) {
          const contact = await db.contacts.get(deviceId);
          if (contact && contact.isLan !== (next === 'lan')) {
            await db.contacts.update(deviceId, { isLan: next === 'lan' });
            this.events.onContactsPresencesUpdate?.();
          }
        }
      }
    } catch (err) {
      console.warn('Transport probe failed:', err);
    }
    return this.transport;
  }

  /** True while the current link stays inside the local network. */
  public isLanLink(): boolean {
    return this.transport === 'lan' && this.isConnected();
  }

  public async saveContact(deviceId: string, publicKeyRaw: string, safetyNumber: string, alias?: string): Promise<ContactRecord> {
    const existing = await db.contacts.get(deviceId);
    const contact: ContactRecord = {
      deviceId,
      alias: alias || existing?.alias || `Peer-${deviceId.slice(4, 8)}`,
      // Keep the profile look we already know about: a re-handshake must never
      // wipe the contact's photo or bio back to an empty placeholder.
      avatarUrl: existing?.avatarUrl,
      avatarColor: existing?.avatarColor,
      statusBio: existing?.statusBio,
      status: existing?.status,
      profileSyncedAt: existing?.profileSyncedAt,
      identityPublicKeyPEM: publicKeyRaw || existing?.identityPublicKeyPEM || '',
      publicKeyRaw: publicKeyRaw || existing?.publicKeyRaw || '',
      verificationStatus: existing?.verificationStatus || 'TOFU',
      safetyNumber,
      addedAt: existing?.addedAt || Date.now(),
      lastSeenAt: Date.now(),
      isOnline: true,
      isLan: existing?.isLan,
    };
    await db.contacts.put(contact);
    this.activeContact = contact;
    this.events.onPeerInfo(contact);
    return contact;
  }

  /**
   * Buffers one profile chunk. Returns the full JSON text once every part of a
   * set has arrived, otherwise null. Stale sets are dropped so a broken link
   * cannot leak memory on a phone.
   */
  private collectProfileChunk(
    chunk: { id?: string; index?: number; total?: number },
    data: string
  ): string | null {
    const id = String(chunk?.id || 'default');
    const index = Number(chunk?.index) || 0;
    const total = Number(chunk?.total) || 1;
    if (total <= 1 || total > 400) return null;

    const now = Date.now();
    for (const [key, entry] of this.profileChunks) {
      if (now - entry.startedAt > 30000) this.profileChunks.delete(key);
    }

    const entry = this.profileChunks.get(id) || {
      parts: new Map<number, string>(),
      total,
      startedAt: now,
    };
    entry.parts.set(index, data);
    this.profileChunks.set(id, entry);

    if (entry.parts.size < entry.total) return null;
    this.profileChunks.delete(id);

    let assembled = '';
    for (let i = 0; i < entry.total; i += 1) {
      const part = entry.parts.get(i);
      if (part === undefined) return null;
      assembled += part;
    }
    return assembled;
  }

  /**
   * Stores a profile received from a paired device, so photos, names and bios
   * stay identical everywhere (contact list, chat header, message rows).
   */
  private async applyRemoteProfile(raw: any, fallbackDeviceId?: string): Promise<void> {
    const payload: ProfileSyncPayload | null = raw && typeof raw === 'object' ? raw : null;
    const deviceId = payload?.deviceId || fallbackDeviceId;
    if (!deviceId || deviceId === this.identity.deviceId) return;

    const existing = await db.contacts.get(deviceId);
    if (!existing) return;

    // Ignore out-of-order frames from an older profile snapshot.
    const stamp = Number(payload?.updatedAt) || Date.now();
    if (existing.profileSyncedAt && stamp < existing.profileSyncedAt) return;

    // A contact the user renamed keeps that name; an auto-generated placeholder
    // follows whatever the device now calls itself.
    const keepAlias = !!existing.alias && !existing.alias.startsWith('Peer-');

    const updated: ContactRecord = {
      ...existing,
      avatarUrl: payload?.avatarUrl || undefined,
      avatarColor: payload?.avatarColor || existing.avatarColor,
      statusBio: payload?.statusBio || undefined,
      status: payload?.status || undefined,
      alias: keepAlias ? existing.alias : payload?.displayName || existing.alias,
      lastSeenAt: Date.now(),
      profileSyncedAt: stamp,
    };
    await db.contacts.put(updated);
    if (this.activeContact?.deviceId === deviceId) this.activeContact = updated;
    this.events.onPeerInfo(updated);
    this.events.onContactsPresencesUpdate?.();
  }

  /**
   * Pushes this device's profile to every contact (data channel when open, relay
   * mailbox otherwise) so a photo change is visible on the other side at once.
   */
  public async sendProfileUpdate(): Promise<void> {
    const stamp = Date.now();
    const profile: ProfileSyncPayload = {
      deviceId: this.identity.deviceId,
      displayName: this.identity.displayName,
      avatarUrl: this.identity.avatarUrl,
      avatarColor: this.identity.avatarColor,
      statusBio: this.identity.statusBio,
      status: this.identity.status,
      updatedAt: stamp,
    };

    // 1. Live link (instant). Photos are chunked so no browser's data-channel
    //    message limit can silently swallow the profile.
    let deliveredDirectly = false;
    if (this.isConnected() && this.cryptoSession && this.dataChannel) {
      deliveredDirectly = await this.sendProfileOverDataChannel(profile);
    }

    // 2. Relay mailbox for contacts that are not directly connected — and for
    //    the connected one when the direct push did not go through.
    try {
      const contacts = await db.contacts.toArray();
      await Promise.all(
        contacts.map(async (contact) => {
          if (contact.deviceId === this.identity.deviceId) return;
          if (
            deliveredDirectly &&
            this.isConnected() &&
            contact.deviceId === this.remoteDeviceId
          ) {
            return;
          }
          const envelope = {
            type: 'PROFILE',
            senderDeviceId: this.identity.deviceId,
            profile,
            timestamp: stamp,
          };
          const encryptedEnvelope = btoa(unescape(encodeURIComponent(JSON.stringify(envelope))));
          await this.fetchRelay('/api/signaling/mailbox/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              senderDeviceId: this.identity.deviceId,
              recipientDeviceId: contact.deviceId,
              encryptedEnvelope,
              timestamp: stamp,
            }),
          }, 5000).catch(() => {});
        })
      );
    } catch {
      /* the live link already carried it when possible */
    }
  }

  /**
   * Sends the profile over the live data channel, splitting large payloads
   * (a base64 photo easily passes 32 KB) into independent frames.
   */
  private async sendProfileOverDataChannel(profile: ProfileSyncPayload): Promise<boolean> {
    const session = this.cryptoSession;
    const channel = this.dataChannel;
    if (!session || !channel || channel.readyState !== 'open') return false;

    try {
      const json = JSON.stringify(profile);
      const header = buildPacketHeader(PacketType.PROFILE_INFO, session.sessionId, 0n, 0);

      if (json.length <= PeerManager.PROFILE_CHUNK_CHARS) {
        const frame = await session.encryptFrame(header, new TextEncoder().encode(json));
        channel.send(frame);
        return true;
      }

      const total = Math.ceil(json.length / PeerManager.PROFILE_CHUNK_CHARS);
      const chunkId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      for (let index = 0; index < total; index += 1) {
        const slice = json.slice(
          index * PeerManager.PROFILE_CHUNK_CHARS,
          (index + 1) * PeerManager.PROFILE_CHUNK_CHARS
        );
        const payload = JSON.stringify({ chunk: { id: chunkId, index, total }, data: slice });
        const chunkHeader = buildPacketHeader(PacketType.PROFILE_INFO, session.sessionId, 0n, index);
        const frame = await session.encryptFrame(chunkHeader, new TextEncoder().encode(payload));
        channel.send(frame);
      }
      return true;
    } catch (err) {
      console.warn('Profile push over data channel failed, falling back to the relay:', err);
      return false;
    }
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
        this.onLinkReady();
      }
    };

    dc.onclose = () => {
      this.setState('DISCONNECTED');
    this.stopHeartbeat();
    this.sentOfferSdp = null;
    this.transport = 'relay';
    if (this.transportTimer) {
        clearInterval(this.transportTimer);
        this.transportTimer = null;
      }
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
          const decodedText = new TextDecoder().decode(decryptedPayload);
          let text = decodedText;
          let messageId: string | undefined;
          try {
            const packet = JSON.parse(decodedText);
            if (packet && typeof packet.text === 'string') {
              text = packet.text;
              messageId = packet.messageId;
            }
          } catch {
            // Messages from older clients were plain UTF-8 text.
          }

          if (
            messageId &&
            await db.messages.filter((message) => message.messageId === messageId).first()
          ) {
            // A retry means our earlier acknowledgement went missing: answer
            // again instead of leaving the sender stuck in its outbox.
            void this.sendDeliveryAck({ messageId }, this.remoteDeviceId, true);
            break;
          }

          const msgRecord: MessageRecord = {
            messageId,
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
          if (messageId) {
            void this.sendDeliveryAck({ messageId }, this.remoteDeviceId, true);
          }
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
                  // Tell the sender the attachment landed, whether this was the
                  // first delivery or a retry of one we already stored.
                  void this.sendDeliveryAck(
                    { fileId: fileRec.fileId },
                    this.remoteDeviceId,
                    true
                  );
                  if (await db.messages.where('fileId').equals(fileRec.fileId).first()) {
                    return;
                  }
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

        case PacketType.PROFILE_INFO: {
          try {
            const remoteProfile = JSON.parse(new TextDecoder().decode(decryptedPayload));
            if (remoteProfile?.chunk && typeof remoteProfile.data === 'string') {
              // Large profile (custom photo): reassemble the chunks first.
              const assembled = this.collectProfileChunk(remoteProfile.chunk, remoteProfile.data);
              if (assembled) {
                await this.applyRemoteProfile(JSON.parse(assembled), this.remoteDeviceId);
              }
            } else {
              await this.applyRemoteProfile(remoteProfile, this.remoteDeviceId);
            }
          } catch (err) {
            console.warn('Profile packet parse error:', err);
          }
          break;
        }

        case PacketType.DELIVERY_ACK: {
          try {
            const ack = JSON.parse(new TextDecoder().decode(decryptedPayload));
            await this.handleDeliveryAck(ack);
          } catch (err) {
            console.warn('Delivery ack parse error:', err);
          }
          break;
        }

        case PacketType.READ_RECEIPT: {
          try {
            const receipt = JSON.parse(new TextDecoder().decode(decryptedPayload));
            await this.markMessagesRead(receipt.messageIds);
          } catch (err) {
            console.warn('Read receipt parse error:', err);
          }
          break;
        }

        case PacketType.TYPING_INDICATOR: {
          try {
            const typing = JSON.parse(new TextDecoder().decode(decryptedPayload));
            this.events.onTypingState?.({
              deviceId: this.remoteDeviceId,
              isTyping: !!typing.isTyping,
            });
          } catch (err) {
            console.warn('Typing packet parse error:', err);
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
   * Notify peer of mutual contact deletion / revocation
   */
  public async notifyContactRemoved(targetDeviceId: string): Promise<void> {
    try {
      const envelope = {
        type: 'CONTACT_REVOKED',
        senderDeviceId: this.identity.deviceId,
        timestamp: Date.now(),
      };
      const encryptedEnvelope = btoa(unescape(encodeURIComponent(JSON.stringify(envelope))));
      await this.fetchRelay('/api/signaling/mailbox/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          senderDeviceId: this.identity.deviceId,
          recipientDeviceId: targetDeviceId,
          encryptedEnvelope,
          timestamp: Date.now(),
        }),
      }, 5000);
    } catch (err) {
      console.warn('Failed to notify contact deletion:', err);
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

    const messageId = `msg_${Date.now()}_${generateRandomHexId(8)}`;
    const msgRecord: MessageRecord = {
      messageId,
      chatDeviceId: recipientId,
      direction: 'OUTBOUND',
      payloadText: text,
      mediaType: 'text',
      timestamp: Date.now(),
      status: 'sending',
    };

    const id = await db.messages.add(msgRecord);
    msgRecord.id = id;

    // The outbox owns delivery from here: it prefers the direct link, falls back
    // to the relay and keeps retrying until the peer acknowledges, so a message
    // cannot be lost to a dropped link, a sleeping tab or a relay hiccup.
    this.registerOutbox({
      messageId,
      chatDeviceId: recipientId,
      kind: 'text',
      text,
      attempts: 0,
      nextAttemptAt: Date.now(),
    });
    void this.tickOutbox();

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
    // Keep the file id compatible with the chunked WebRTC transfer id so a
    // reconnect/fallback can never create a second copy of the same file.
    const fileId = arrayBufferToHex(hashBytes.slice(0, 8)).toUpperCase();
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
    const messageId = `msg_${Date.now()}_${generateRandomHexId(8)}`;
    const msgRecord: MessageRecord = {
      messageId,
      chatDeviceId: recipientId,
      direction: 'OUTBOUND',
      payloadText: file.name,
      fileId,
      fileRecord,
      mediaType,
      timestamp: Date.now(),
      status: 'sending',
    };

    const id = await db.messages.add(msgRecord);
    msgRecord.id = id;
    this.events.onMessageReceived(msgRecord);

    // 1. Send over the direct link when it is up. The transfer runs in the
    // background so the composer stays responsive; if it fails for any reason
    // the relay fallback below takes over instead of losing the file.
    // The outbox watches this attachment: it keeps retrying (direct, then the
    // relay) until the peer confirms, so a file survives a stalled or dropped
    // link instead of vanishing on the way over.
    this.registerOutbox({
      messageId,
      chatDeviceId: recipientId,
      kind: 'file',
      fileId,
      attempts: 0,
      nextAttemptAt: Date.now() + 15000,
    });

    let deliveredDirectly = false;
    if (this.isConnected() && this.cryptoSession && this.dataChannel && recipientId === this.remoteDeviceId) {
      deliveredDirectly = true;
      const directChannel = this.dataChannel;
      const directSession = this.cryptoSession;
      void fileTransferManager
        .sendFile(file, directChannel, directSession, {
          onProgress: this.events.onFileProgress,
          onCompleted: async (fileRec) => {
            const msgId = msgRecord.messageId;
            if (msgId) {
              await db.messages.where('messageId').equals(msgId).modify({
                fileId: fileRec.fileId,
                fileRecord: fileRec,
                mediaType: fileRec.isImage ? 'image' : fileRec.isAudio ? 'audio' : fileRec.isVideo ? 'video' : 'file',
              });
            }
          },
          onError: (fId, err) => {
            this.events.onError(err);
          },
        })
        .catch(async (err) => {
          // The direct stream failed mid-flight: hand the attachment to the
          // outbox, which retries and switches to the relay on its own.
          console.warn('Direct file transfer failed, using relay:', err);
          const entry = this.outbox.get(messageId);
          if (!entry) return;
          entry.nextAttemptAt = 0;
          try {
            await this.deliverOutboxEntry(entry);
          } catch (relayErr: any) {
            this.events.onError(relayErr?.message || 'File transfer failed');
          }
        });
    }

    // 2. Relay path: no direct link, or (handled above) a direct transfer that
    // failed. Attachments that exceed the relay body limit need the direct link.
    if (!deliveredDirectly) {
      await this.pushFileViaRelay(file, recipientId, fileId, hashHex, msgRecord.messageId);
    }

    return fileRecord;
  }

  /** Maximum attachment size the JSON relay accepts (base64 inflates by ~33%). */
  private static readonly RELAY_FILE_LIMIT = 12 * 1024 * 1024;

  /**
   * Pushes a whole attachment through the encrypted relay mailbox. Used when no
   * direct link exists (for example a device behind a restrictive network).
   */
  private async pushFileViaRelay(
    file: File,
    recipientId: string,
    fileId: string,
    hashHex: string,
    messageId?: string
  ): Promise<void> {
    if (file.size > PeerManager.RELAY_FILE_LIMIT) {
      throw new Error(
        `“${file.name}” is ${(file.size / 1024 / 1024).toFixed(1)} MB. Attachments over 12 MB need a direct or LAN connection between the two devices.`
      );
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const mime = file.type || 'application/octet-stream';
    const envelope = {
      type: 'FILE',
      messageId: messageId || `msg_${Date.now()}_${generateRandomHexId(8)}`,
      fileName: file.name,
      mimeType: mime,
      size: file.size,
      senderDeviceId: this.identity.deviceId,
      senderDisplayName: this.identity.displayName || 'Secure Peer',
      timestamp: Date.now(),
    };
    const encryptedEnvelope = btoa(unescape(encodeURIComponent(JSON.stringify(envelope))));

    const response = await this.fetchRelay('/api/signaling/mailbox/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        senderDeviceId: this.identity.deviceId,
        recipientDeviceId: recipientId,
        encryptedEnvelope,
        timestamp: Date.now(),
        fileMetadata: {
          fileId,
          name: file.name,
          size: file.size,
          mimeType: mime,
          hashSHA256: hashHex,
        },
        fileBase64Chunk: arrayBufferToBase64(bytes),
      }),
    });
    if (!response.ok) {
      throw new Error(`File relay returned HTTP ${response.status}`);
    }
    this.events.onFileCompleted(
      {
        fileId,
        name: file.name,
        size: file.size,
        mimeType: mime,
        hashSHA256: hashHex,
        blobRef: file,
        isImage: mime.startsWith('image/'),
        isAudio: mime.startsWith('audio/'),
        isVideo: mime.startsWith('video/'),
      },
      file
    );
  }

  public async sendGroupTextMessage(text: string, group: GroupRecord): Promise<string> {
    const messageId = `msg_${Date.now()}_${generateRandomHexId(8)}`;
    const payload = {
      type: 'GROUP_TEXT',
      messageId,
      groupId: group.groupId,
      text,
      senderDeviceId: this.identity.deviceId,
      senderDisplayName: this.identity.displayName || 'Secure Peer',
      senderAvatarColor: this.identity.avatarColor,
      group,
      timestamp: Date.now(),
    };

    const recipients = group.memberDeviceIds.filter(
      (deviceId) => deviceId !== this.identity.deviceId
    );
    await Promise.all(
      recipients.map(async (recipientDeviceId) => {
        const response = await this.fetchRelay('/api/signaling/group/broadcast', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            groupId: group.groupId,
            senderDeviceId: this.identity.deviceId,
            recipients: [recipientDeviceId],
            payload,
          }),
        });
        if (!response.ok) {
          throw new Error(`Group relay returned HTTP ${response.status}`);
        }
      })
    );
    return messageId;
  }

  public async sendGroupFile(
    file: File,
    group: GroupRecord
  ): Promise<{ fileRecord: FileRecord; messageId: string }> {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const hashBytes = await sha256(bytes);
    const mimeType = file.type || 'application/octet-stream';
    const fileRecord: FileRecord = {
      fileId: arrayBufferToHex(hashBytes.slice(0, 8)).toUpperCase(),
      name: file.name,
      size: file.size,
      mimeType,
      hashSHA256: arrayBufferToHex(hashBytes),
      blobRef: new Blob([bytes], { type: mimeType }),
      isImage: mimeType.startsWith('image/'),
      isAudio: mimeType.startsWith('audio/'),
      isVideo: mimeType.startsWith('video/'),
    };
    const messageId = `msg_${Date.now()}_${generateRandomHexId(8)}`;
    const payload = {
      type: 'GROUP_FILE',
      messageId,
      groupId: group.groupId,
      fileId: fileRecord.fileId,
      fileName: fileRecord.name,
      size: fileRecord.size,
      mimeType: fileRecord.mimeType,
      hashSHA256: fileRecord.hashSHA256,
      fileBase64Chunk: arrayBufferToBase64(bytes),
      senderDeviceId: this.identity.deviceId,
      senderDisplayName: this.identity.displayName || 'Secure Peer',
      senderAvatarColor: this.identity.avatarColor,
      group,
      timestamp: Date.now(),
    };

    await db.files.put(fileRecord);
    const recipients = group.memberDeviceIds.filter(
      (deviceId) => deviceId !== this.identity.deviceId
    );
    await Promise.all(
      recipients.map(async (recipientDeviceId) => {
        const response = await this.fetchRelay('/api/signaling/group/broadcast', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            groupId: group.groupId,
            senderDeviceId: this.identity.deviceId,
            recipients: [recipientDeviceId],
            payload,
          }),
        });
        if (!response.ok) {
          throw new Error(`Group file relay returned HTTP ${response.status}`);
        }
      })
    );
    return { fileRecord, messageId };
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
              // Presence ages are measured against the server clock, so a
              // skewed local clock can never keep a departed device "online".
              const serverTime = Number(pData.serverTime) || 0;
              const signature: string[] = [];

              for (const c of allContacts) {
                const presence = pData.presences[c.deviceId];
                if (!presence) continue;

                let isOnline = !!presence.isOnline;
                if (isOnline && serverTime && presence.lastSeen) {
                  isOnline = serverTime - presence.lastSeen < 30000;
                }
                const lastSeenAt = presence.lastSeen || c.lastSeenAt;
                // Presence age only matters to the minute; anything finer would
                // rewrite the contact row (and re-render the list) every poll.
                signature.push(
                  `${c.deviceId}:${isOnline ? 1 : 0}:${Math.round(lastSeenAt / 60000)}`
                );

                const flagChanged = isOnline !== c.isOnline;
                const minuteChanged = Math.abs(lastSeenAt - c.lastSeenAt) >= 60000;
                if (flagChanged || minuteChanged) {
                  await db.contacts.update(c.deviceId, {
                    isOnline,
                    lastSeenAt: isOnline || flagChanged ? lastSeenAt : c.lastSeenAt,
                  });
                }
              }

              // Only wake the UI when something actually changed.
              const presenceSignature = signature.join('|');
              if (presenceSignature !== this.lastPresenceSignature) {
                this.lastPresenceSignature = presenceSignature;
                this.events.onContactsPresencesUpdate?.(pData.presences);
              }
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

  private startCallSignalPolling() {
    if (this.callPollInterval) clearInterval(this.callPollInterval);
    this.callPollInterval = setInterval(async () => {
      if (!this.identity?.deviceId) return;
      try {
        const response = await this.fetchRelay(
          `/api/signaling/call/poll/${encodeURIComponent(this.identity.deviceId)}`,
          { method: 'GET', headers: { Accept: 'application/json' } },
          2500
        );
        if (!response.ok) return;
        const data = await response.json();
        if (!Array.isArray(data.signals)) return;
        for (const queued of data.signals) {
          if (queued.senderDeviceId !== this.identity.deviceId && queued.signal) {
            await this.events.onMediaSignal?.(queued.signal);
          }
        }
      } catch {
        // The mailbox/SSE path remains available while the fast poll retries.
      }
    }, 2500);
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
    this.transport = 'relay';
    if (this.transportTimer) {
      clearInterval(this.transportTimer);
      this.transportTimer = null;
    }
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
    if (this.callPollInterval) {
      clearInterval(this.callPollInterval);
      this.callPollInterval = null;
    }
  }
}
