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
import { fileTransferManager, FileCompletionMeta } from '../protocol/fileTransfer';
import { notifyVaultChange } from '../utils/vaultEvents';
import { fileToImagePreviewDataUrl } from '../utils/imageHelper';

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
 * One attachment being downloaded from the relay. Downloads are attempted in the
 * background, never more than one at a time per message, and a failure is
 * retried with a cooldown so a flaky link cannot become a request storm.
 */
interface InboundFileState {
  attempts: number;
  lastAttemptAt: number;
  inFlight: boolean;
  askedForResend: boolean;
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
  /** When the payload last reached the peer's relay mailbox. */
  lastSentAt?: number;
  lastError?: string;
  /**
   * Secret for this attachment's relay transfer. Kept so a retry resumes the
   * same upload (already stored chunks cost nothing) instead of starting over.
   */
  transferToken?: string;
  /**
   * When this attachment started streaming over the direct (LAN / peer-to-peer)
   * link. While that transfer is running — and for a short grace period after
   * it finishes, waiting for the peer's receipt — the relay upload is held back,
   * so a photo sent between two devices on the same network never travels to
   * the internet and back. The hold always expires, so a stalled direct link
   * still ends with a relayed copy instead of a lost file.
   */
  directStartedAt?: number;
  directCompletedAt?: number;
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
  private static readonly MAX_DELIVERY_ATTEMPTS = 120;
  private static readonly OUTBOX_TICK_MS = 2000;
  /** Largest attachment the attachment relay accepts (matches the relay cap). */
  private static readonly MAX_RELAY_ATTACHMENT_BYTES = 64 * 1024 * 1024;
  /**
   * Raw bytes per upload request: big enough that a photo is a handful of
   * requests instead of dozens, small enough that a failed one is cheap to send
   * again. The relay accepts up to 3 MB per request, so 2 MB stays inside it.
   */
  private static readonly UPLOAD_CHUNK_BYTES = 2 * 1024 * 1024;
  /**
   * Parallel upload requests. A single stream leaves most of a home uplink
   * unused; six lanes fill it while still sharing fairly with other traffic and
   * staying gentle on a phone's radio.
   */
  private static readonly UPLOAD_LANES = 6;
  /**
   * Downloads come down several connections at once: a single stream pays one
   * round trip per window and rarely fills a fast line, while parallel byte
   * ranges use the whole pipe from the first second. Small files are not worth
   * the extra requests and keep the single-stream path.
   */
  private static readonly DOWNLOAD_PART_BYTES = 2 * 1024 * 1024;
  private static readonly DOWNLOAD_LANES = 6;
  private static readonly PARALLEL_DOWNLOAD_MIN_BYTES = 4 * 1024 * 1024;
  /**
   * How long the relay upload is held back for a direct transfer. A LAN copy of
   * a 40 MB video finishes in seconds; the ceiling exists so a device that
   * silently drops off the network cannot strand the file.
   */
  private static readonly DIRECT_TRANSFER_MAX_MS = 90_000;
  private static readonly DIRECT_RECEIPT_GRACE_MS = 10_000;
  /**
   * How often the rescue sweep runs, and how long an attachment may sit without
   * its bytes before the sweep asks for them again. The grace is longer than a
   * slow download takes on purpose: asking too early would duplicate traffic.
   */
  private static readonly ATTACHMENT_SWEEP_MS = 20_000;
  private static readonly ATTACHMENT_SWEEP_GRACE_MS = 25_000;
  /** Minimum gap between two download attempts of the same attachment. */
  private static readonly DOWNLOAD_RETRY_COOLDOWN_MS = 8000;
  /** How many download attempts before this side asks the sender to re-upload. */
  private static readonly MAX_TRANSFER_PULL_REQUESTS = 3;
  /** Relay mailbox items stored here but not yet acknowledged to the server. */
  private mailboxAckQueue = new Set<string>();
  private mailboxAckTimer: any = null;
  /** Consecutive failures per mailbox item, so one bad item cannot loop. */
  private mailboxFailures = new Map<string, number>();
  /** Attachments being downloaded from the relay, keyed by message id. */
  private inboundFiles = new Map<string, InboundFileState>();
  /** Throttles resend requests the sender serves, keyed by message id. */
  private lastPullServedAt = new Map<string, number>();
  /** Throttles resend requests this device asks for, keyed by message id. */
  private lastResendAskedAt = new Map<string, number>();
  /** Slow sweep that rescues attachments whose bytes never landed. */
  private attachmentSweepInterval: ReturnType<typeof setInterval> | null = null;
  /** Throttles the sweep itself, so it can never become a polling loop. */
  private lastAttachmentSweepAt = 0;
  /** How many times the sweep has asked for one attachment's bytes. */
  private attachmentSweepCounts = new Map<string, number>();

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
    void this.cleanupStaleInboundAttachments();

    // Every inbound attachment - carried by the direct link or by the relay -
    // is stored by this class, in the bubble the sender's own message id names.
    // Nothing else may create a message for a file: that is what produced twin
    // bubbles and photos that loaded forever.
    fileTransferManager.setAttachmentCompletionSink(async (fileRecord, blob, meta) => {
      await this.storeInboundAttachment({
        fileId: fileRecord.fileId,
        name: fileRecord.name,
        size: fileRecord.size,
        mimeType: fileRecord.mimeType,
        hashSHA256: fileRecord.hashSHA256,
        blob,
        messageId: meta?.messageId,
        senderDeviceId: meta?.senderDeviceId || this.remoteDeviceId,
        senderDisplayName: meta?.senderDisplayName,
        previewUrl: meta?.previewUrl,
        timestamp: Date.now(),
      });
    });
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

    // A request that carries a payload (an upload) gets a budget that grows
    // with its size: a photo on a slow uplink must never be cut off mid-flight
    // and reported to the user as an aborted request.
    const bodySize = typeof options.body === 'string' ? options.body.length : 0;
    const effectiveTimeout =
      bodySize > 0 ? Math.max(timeoutMs, this.uploadTimeoutMs(bodySize)) : timeoutMs;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), effectiveTimeout);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      clearTimeout(timer);
      return response;
    } catch (err: any) {
      clearTimeout(timer);
      if (err?.name === 'AbortError') {
        throw new Error('The signaling server did not respond in time.');
      }
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
        this.events.onRelayStatusChange?.('ONLINE', { status: 'online' }, undefined, undefined);
        // The stream is back: pull queued messages immediately, then retry
        // anything still waiting in the outbox. The relay keeps everything we
        // have not confirmed, so one catch-up pull is enough.
        void this.pullMailboxNow();
        this.flushOutbox();
        setTimeout(() => void this.pullMailboxNow(), 1500);
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
    this.outboxInterval = setInterval(() => {
      void this.tickOutbox();
      this.flushPendingReceipts();
    }, PeerManager.OUTBOX_TICK_MS);
    // A file can be announced and then never arrive — the sender's upload died
    // in the middle, the relay evicted its copy, the tab froze while the bytes
    // were travelling. The bubble exists, so instead of leaving it loading
    // forever (or deleting it) this slow sweep asks for the bytes again.
    if (this.attachmentSweepInterval) clearInterval(this.attachmentSweepInterval);
    this.attachmentSweepInterval = setInterval(() => {
      void this.sweepInboundAttachments();
    }, PeerManager.ATTACHMENT_SWEEP_MS);
  }

  /**
   * Finds inbound attachments whose bytes are missing and asks their sender for
   * them again. Throttled per message id (see `requestAttachmentBytes`), so a
   * conversation that is genuinely waiting cannot turn into a request storm.
   */
  private async sweepInboundAttachments(): Promise<void> {
    const now = Date.now();
    if (now - this.lastAttachmentSweepAt < PeerManager.ATTACHMENT_SWEEP_MS) return;
    this.lastAttachmentSweepAt = now;
    try {
      const waiting = await db.messages
        .filter(
          (m) =>
            m.direction === 'INBOUND' &&
            !!m.fileId &&
            m.attachmentState !== 'ready' &&
            now - m.timestamp > PeerManager.ATTACHMENT_SWEEP_GRACE_MS
        )
        .toArray();
      for (const row of waiting.slice(-6)) {
        if (!row.messageId || !row.fileId) continue;
        if (row.fileRecord?.blobRef) continue;
        const stored = await db.files.get(row.fileId);
        if (stored?.blobRef) {
          // The bytes are here after all: just finish the bubble.
          await this.finishAttachmentRow(row, stored);
          continue;
        }
        // Long enough that the bubble should stop pretending it is on its way
        // and start offering the retry the user can act on. Automatic asking
        // stops there: the sender may not hold the file any more, and a request
        // loop would help nobody. The bubble's own retry stays available.
        if (now - row.timestamp > 90_000) {
          if (row.attachmentState !== 'failed' && row.id !== undefined) {
            await db.messages.update(row.id, { attachmentState: 'failed' }).catch(() => {});
            notifyVaultChange('file');
          }
          continue;
        }
        const asked = this.attachmentSweepCounts.get(row.messageId) || 0;
        if (asked >= 5) continue;
        this.attachmentSweepCounts.set(row.messageId, asked + 1);
        this.requestAttachmentBytes(row.messageId, row.fileId, row.chatDeviceId);
      }
    } catch {
      /* the next sweep comes back around */
    }
  }

  /** Marks a row as complete once its bytes are provably in the local vault. */
  private async finishAttachmentRow(row: MessageRecord, stored: FileRecord): Promise<void> {
    if (row.id === undefined) return;
    const { blobRef, ...fileMeta } = stored;
    await db.messages
      .update(row.id, {
        fileId: stored.fileId,
        fileRecord: { ...(row.fileRecord || {}), ...fileMeta },
        attachmentState: 'ready',
      })
      .catch(() => {});
    notifyVaultChange('file');
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
          // The token survives a reload, so an interruption resumes the same
          // relay transfer (and the chunks already there) instead of colliding
          // with its own upload.
          transferToken: msg.transferToken,
          attempts: 0,
          nextAttemptAt: Date.now() + 1500,
        });
      }

      // Attachments that reached the relay but were never confirmed are checked
      // once per session: the relay forgets its copy after a day, and a photo
      // nobody can download is a message that silently never arrives. The
      // uploader asks the relay first, so this costs no bandwidth while the file
      // is still there — and restores it when it is not.
      const unconfirmed = await db.messages
        .filter(
          (m) =>
            m.direction === 'OUTBOUND' &&
            !!m.fileId &&
            m.status === 'sent' &&
            m.timestamp < Date.now() - 60 * 60 * 1000
        )
        .toArray();
      for (const msg of unconfirmed.slice(-20)) {
        if (!msg.messageId || !msg.fileId) continue;
        this.registerOutbox({
          messageId: msg.messageId,
          chatDeviceId: msg.chatDeviceId,
          kind: 'file',
          fileId: msg.fileId,
          transferToken: msg.transferToken,
          attempts: 0,
          nextAttemptAt: Date.now() + 8000,
        });
      }
    } catch {
      /* history stays usable either way */
    }
  }

  /**
   * Reconciles attachments left mid-flight by an earlier session.
   *
   * Older builds could park a message in a state that could never finish, which
   * showed up as a permanently loading photo. Nothing is deleted here: a row
   * whose bytes are in the vault is completed, and one whose bytes never made it
   * is marked failed so the conversation offers a retry instead of an endless
   * spinner.
   */
  private async cleanupStaleInboundAttachments(): Promise<void> {
    try {
      const pendingRows = await db.messages
        .filter(
          (message) =>
            message.direction === 'INBOUND' &&
            !!message.fileId &&
            message.attachmentState !== 'ready'
        )
        .toArray();
      for (const row of pendingRows) {
        if (row.fileRecord?.blobRef) continue;
        const stored = row.fileId ? await db.files.get(row.fileId) : undefined;
        if (stored?.blobRef) {
          await this.finishAttachmentRow(row, stored);
          continue;
        }
        if (row.id !== undefined && row.attachmentState !== 'failed') {
          await db.messages.update(row.id, { attachmentState: 'failed' }).catch(() => {});
        }
      }
      notifyVaultChange('file');
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
      transferToken: row.transferToken,
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

      // After the first successful send, keep retrying until the DELIVERY_ACK
      // arrives — messages in 'sent' state must not be abandoned.  Only mark
      // 'failed' if we never managed to push the payload at all.
      const maxAttempts = entry.everSent
        ? 50
        : entry.kind === 'file'
        ? 60
        : PeerManager.MAX_DELIVERY_ATTEMPTS;
      if (entry.attempts >= maxAttempts) {
        this.outbox.delete(entry.messageId);
        if (!entry.everSent) await this.setMessageStatus(entry.messageId, 'failed');
        continue;
      }

      // An attachment streaming over the direct (LAN / peer-to-peer) link is
      // already on its way, and the relay copy is deliberately held back for the
      // duration so local transfers stay local. The hold expires on its own, so
      // a link that dies mid-file ends with a relayed copy instead of a loss.
      if (entry.kind === 'file' && this.holdsForDirectLink(entry)) {
        entry.nextAttemptAt = now + 1500;
        continue;
      }

      // A text message is tiny, so re-sending it until the peer confirms is
      // cheap self-healing. An attachment is not: re-uploading it on a timer
      // would hammer the relay for a peer that is merely slow. Once the bytes
      // are on the relay the transfer is complete on this side — the relay owns
      // the notification and holds the file until the peer has it, so all this
      // entry waits for now is the peer's receipt. Only an explicit request from
      // the peer (FILE_PULL_REQUEST) restarts an upload.
      if (entry.kind === 'file' && entry.everSent) {
        entry.attempts += 1;
        entry.nextAttemptAt = now + 15000;
        continue;
      }

      entry.attempts += 1;
      let delay = this.retryDelay(entry);
      try {
        await this.deliverOutboxEntry(entry);
        if (!entry.everSent) {
          entry.everSent = true;
          entry.lastSentAt = Date.now();
          // Mark as 'sent' — the peer has not confirmed yet. Only a
          // DELIVERY_ACK from the receiver upgrades this to 'delivered'.
          await this.setMessageStatus(entry.messageId, 'sent');
          delay = 4000;
        }
      } catch (err: any) {
        entry.lastError = err?.message;
        // Unrecoverable (an attachment the relay can never carry): fail right
        // away with a clear message instead of retrying for minutes.
        if (err?.fatal) {
          this.outbox.delete(entry.messageId);
          await this.setMessageStatus(entry.messageId, 'failed');
          continue;
        }
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

    // One path for every attachment, online or offline, LAN or cellular: upload
    // the bytes to the relay, which holds them until the peer has them and
    // notifies that device itself. A single code path is the whole point — two
    // transports meant two behaviours, and the unreliable one always won.
    // Claim the transfer so no other tick can start a second upload of the
    // same attachment while this one is still in flight.
    this.activeFileTransfers.add(entry.messageId);
    try {
      await this.uploadAttachmentToRelay(file, entry, record);
    } finally {
      this.activeFileTransfers.delete(entry.messageId);
    }
  }

  /**
   * True while this attachment is being carried by the direct link (or is
   * waiting for its receipt moments after finishing), which is when the relay
   * upload must stay out of the way.
   */
  private holdsForDirectLink(entry: OutboxEntry): boolean {
    if (!entry.directStartedAt && !entry.directCompletedAt) return false;
    if (!this.canReachDirectly(entry.chatDeviceId)) {
      entry.directStartedAt = undefined;
      entry.directCompletedAt = undefined;
      return false;
    }
    if (entry.directCompletedAt) {
      return Date.now() - entry.directCompletedAt < PeerManager.DIRECT_RECEIPT_GRACE_MS;
    }
    return Date.now() - (entry.directStartedAt || 0) < PeerManager.DIRECT_TRANSFER_MAX_MS;
  }

  /** A live, encrypted data channel to exactly this device. */
  private canReachDirectly(deviceId: string): boolean {
    return (
      this.isConnected() &&
      !!this.cryptoSession &&
      !!this.dataChannel &&
      this.dataChannel.readyState === 'open' &&
      deviceId === this.remoteDeviceId
    );
  }

  /**
   * Streams an attachment straight to the peer over the encrypted data channel.
   *
   * This is the fast path: two devices on the same network copy the bytes
   * host-to-host at link speed, with no server in the middle and no internet
   * needed. It never replaces the guarantee — the outbox entry stays registered,
   * so unless the peer's receipt arrives the relay takes over exactly as if the
   * direct link had never existed.
   */
  private async streamAttachmentDirectly(
    entry: OutboxEntry,
    file: File,
    record: FileRecord
  ): Promise<void> {
    const channel = this.dataChannel;
    const session = this.cryptoSession;
    if (!channel || !session) {
      entry.directStartedAt = undefined;
      return;
    }
    try {
      await fileTransferManager.sendFile(
        file,
        channel,
        session,
        {
          onProgress: this.events.onFileProgress,
          onCompleted: () => {
            entry.directCompletedAt = Date.now();
          },
          onError: (_fileId, err) => this.events.onError(err),
        },
        {
          isLan: this.transport === 'lan',
          meta: {
            messageId: entry.messageId,
            senderDeviceId: this.identity.deviceId,
            senderDisplayName: this.identity.displayName || 'Secure Peer',
            previewUrl: record.previewUrl,
          },
        }
      );
      entry.directCompletedAt = Date.now();
    } catch (err) {
      // A dropped or stalled link is an ordinary fallback, never a lost file.
      console.warn('Direct attachment stream failed, handing it to the relay:', err);
      entry.directStartedAt = undefined;
      entry.directCompletedAt = undefined;
    }
  }

  /**
   * Sends a photo's thumbnail ahead of its bytes.
   *
   * The receiver shows the picture straight away — soft, with a tiny progress
   * badge — and it sharpens the moment the real file lands. It is a retained
   * envelope, so a device that is offline right now still gets it, and it costs
   * a fraction of what the photo does.
   */
  private async pushAttachmentPreview(
    recipientId: string,
    messageId: string,
    file: File,
    record: FileRecord
  ): Promise<void> {
    try {
      const previewUrl = await fileToImagePreviewDataUrl(file);
      if (!previewUrl) return;
      record.previewUrl = previewUrl;
      await db.files.put(record).catch(() => {});
      notifyVaultChange('file');
      // On a local link the file itself lands within moments: an extra envelope
      // would only add noise.
      if (this.transport === 'lan' && this.canReachDirectly(recipientId)) return;
      await this.pushEnvelope(
        recipientId,
        {
          type: 'FILE_PREVIEW',
          messageId,
          fileId: record.fileId,
          name: record.name,
          size: record.size,
          mimeType: record.mimeType,
          previewUrl,
          senderDeviceId: this.identity.deviceId,
          senderDisplayName: this.identity.displayName || 'Secure Peer',
          timestamp: Date.now(),
        },
        12000
      );
    } catch (err) {
      // A preview is a courtesy: its absence changes nothing about delivery.
      console.warn('Attachment preview was not sent:', err);
    }
  }

  /**
   * Sends an attachment and hands delivery to the outbox.
   *
   * This is the single entry point the UI uses. It never blocks on the network
   * and never throws for transport reasons: the file is stored locally, shown
   * in the conversation immediately, and the outbox walks the direct link and
   * then the durable relay until the peer acknowledges it. That is what turns
   * “the receiver sometimes never sees the photo” into a guarantee.
   */
  public async sendAttachment(file: File, targetDeviceId?: string): Promise<FileRecord> {
    const recipientId = targetDeviceId || this.remoteDeviceId || this.activeContact?.deviceId;
    if (!recipientId) throw new Error('No recipient device specified');

    const hashBytes = await sha256(new Uint8Array(await file.arrayBuffer()));
    const hashHex = arrayBufferToHex(hashBytes);
    // Same id the chunked WebRTC transfer derives, so a link that comes up
    // later can never store a second copy of the same attachment.
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
    // The bytes live in the local vault before anything else happens, so a
    // retry minutes later (or after a reload) still has them.
    await db.files.put(fileRecord);

    const messageId = `msg_${Date.now()}_${generateRandomHexId(8)}`;
    // The bubble keeps the attachment's metadata, not a second copy of its
    // bytes: a 4 MB photo used to be written to the vault twice, which doubled
    // both the write time and the storage for no benefit.
    const { blobRef: _bytes, ...fileMeta } = fileRecord;
    const msgRecord: MessageRecord = {
      messageId,
      chatDeviceId: recipientId,
      direction: 'OUTBOUND',
      payloadText: file.name,
      fileId,
      fileRecord: fileMeta,
      mediaType: isImage ? 'image' : isAudio ? 'audio' : isVideo ? 'video' : 'file',
      timestamp: Date.now(),
      status: 'sending',
      attachmentState: 'ready',
    };
    const insertedId = await db.messages.add(msgRecord);
    msgRecord.id = insertedId;
    this.events.onMessageReceived(msgRecord);
    notifyVaultChange('file');

    const direct = this.canReachDirectly(recipientId);
    const entry: OutboxEntry = {
      messageId,
      chatDeviceId: recipientId,
      kind: 'file',
      fileId,
      attempts: 0,
      nextAttemptAt: Date.now(),
      directStartedAt: direct ? Date.now() : undefined,
    };
    this.registerOutbox(entry);

    // Direct link first (LAN speed, no server in the middle). The relay upload
    // is held back only while that stream is genuinely alive.
    if (direct) void this.streamAttachmentDirectly(entry, file, fileRecord);
    void this.tickOutbox();

    // The thumbnail follows on its own so it can never delay the file itself.
    if (isImage) void this.pushAttachmentPreview(recipientId, messageId, file, fileRecord);

    return fileRecord;
  }

  /**
   * Uploads an attachment to the relay in raw binary chunks.
   *
   * Every request is small, independent and idempotent, so an interrupted upload
   * resumes at the next missing chunk instead of starting over, and re-sending a
   * chunk the relay already has costs nothing. Nothing here waits for the peer:
   * the relay holds the finished file and notifies the peer device itself, which
   * is what turns "the photo sometimes never arrives" into an ordinary case.
   *
   * The returned token is remembered on the outbox entry so every retry (and a
   * resend the peer asks for) continues the same transfer instead of uploading
   * the file again from byte zero.
   */
  private async uploadAttachmentToRelay(
    file: File,
    entry: OutboxEntry,
    record: FileRecord
  ): Promise<string> {
    if (file.size > PeerManager.MAX_RELAY_ATTACHMENT_BYTES) {
      throw Object.assign(
        new Error(
          `“${file.name}” is ${(file.size / 1024 / 1024).toFixed(1)} MB. Attachments over ${
            PeerManager.MAX_RELAY_ATTACHMENT_BYTES / 1024 / 1024
          } MB cannot be sent.`
        ),
        { fatal: true }
      );
    }

    const token = entry.transferToken || generateRandomHexId(24);
    if (entry.transferToken !== token) {
      entry.transferToken = token;
      // Remembered on the row too: after a reload this upload continues instead
      // of starting a second transfer the relay would refuse.
      await db.messages
        .where('messageId')
        .equals(entry.messageId)
        .modify({ transferToken: token })
        .catch(() => {});
    }

    const mime = file.type || record.mimeType || 'application/octet-stream';
    const chunkSize = PeerManager.UPLOAD_CHUNK_BYTES;
    const totalChunks = Math.max(1, Math.ceil(file.size / chunkSize));

    const progress: FileTransferProgress = {
      fileId: record.fileId,
      name: file.name,
      size: file.size,
      mimeType: mime,
      hashSHA256: record.hashSHA256,
      direction: 'OUTBOUND',
      totalChunks,
      transferredChunks: 0,
      progressPercent: 0,
      status: 'transferring',
    };
    this.events.onFileProgress({ ...progress });

    // If the relay already holds this exact transfer — a retry after a reload, an
    // upload that finished while the page was closing — there is not a byte left
    // to send, so the peer can just download it.
    if (await this.relayTransferReady(entry.messageId, token)) {
      progress.transferredChunks = totalChunks;
      progress.progressPercent = 100;
      progress.status = 'completed';
      this.events.onFileProgress({ ...progress });
      return token;
    }

    let nextChunk = 0;
    let uploaded = 0;
    let failure: any = null;

    const uploadOne = async (index: number): Promise<void> => {
      const start = index * chunkSize;
      const bytes = new Uint8Array(
        await file.slice(start, Math.min(start + chunkSize, file.size)).arrayBuffer()
      );
      const params = new URLSearchParams({
        transferId: entry.messageId,
        token,
        recipient: entry.chatDeviceId,
        sender: this.identity.deviceId,
        senderName: this.identity.displayName || 'Secure Peer',
        messageId: entry.messageId,
        fileId: record.fileId,
        name: file.name,
        mime,
        size: String(file.size),
        hash: record.hashSHA256 || '',
        index: String(index),
        total: String(totalChunks),
      });

      let lastError: any = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        if (attempt > 0) {
          await new Promise((resolve) => setTimeout(resolve, 700 * attempt * attempt));
        }
        let response: Response | null = null;
        try {
          response = await this.fetchRelay(
            `/api/signaling/file/upload?${params.toString()}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/octet-stream' },
              body: bytes as unknown as BodyInit,
            },
            this.uploadTimeoutMs(bytes.byteLength)
          );
        } catch (err: any) {
          lastError = err;
          continue;
        }
        if (response.ok) return;
        if (response.status === 413) {
          throw Object.assign(new Error(`“${file.name}” is too large for the relay.`), {
            fatal: true,
          });
        }
        if (response.status === 429) {
          await new Promise((resolve) => setTimeout(resolve, 3000 + attempt * 2000));
          lastError = new Error('The relay is limiting uploads right now.');
          continue;
        }
        lastError = new Error(`Relay upload failed (HTTP ${response.status}).`);
      }
      throw lastError || new Error('Relay upload failed.');
    };

    const lane = async (): Promise<void> => {
      while (!failure) {
        const index = nextChunk;
        nextChunk += 1;
        if (index >= totalChunks) return;
        try {
          await uploadOne(index);
        } catch (err) {
          failure = err;
          return;
        }
        uploaded += 1;
        const percent = Math.round((uploaded / totalChunks) * 100);
        if (percent !== progress.progressPercent || uploaded === totalChunks) {
          progress.transferredChunks = uploaded;
          progress.progressPercent = percent;
          this.events.onFileProgress({ ...progress });
        }
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(PeerManager.UPLOAD_LANES, totalChunks) }, () => lane())
    );
    if (failure) throw failure;

    progress.status = 'completed';
    progress.progressPercent = 100;
    progress.transferredChunks = totalChunks;
    this.events.onFileProgress({ ...progress });
    return token;
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
    await this.pushMailboxItem(recipientId, envelope, undefined, timeoutMs);
  }

  /**
   * How long a relay upload may take. A fixed timeout used to abort a photo
   * upload on a slow uplink and surface as a bogus “request aborted” error, so
   * the budget now scales with the payload and is generous by design.
   */
  private uploadTimeoutMs(payloadBytes: number): number {
    return Math.min(240000, 20000 + Math.ceil(payloadBytes / (96 * 1024)) * 1000);
  }

  /**
   * One POST into the recipient's encrypted mailbox. An aborted request (slow
   * uplink) or a transient server error is retried here, because a message the
   * relay never stored is a message that can be lost.
   */
  /**
   * Delivery receipts that never made it back to the sender. A receipt is what
   * turns a single tick into a double tick, so losing one silently would leave
   * the sender believing its photo was never stored — these are retried until
   * they land (a receipt is idempotent, so repeating one costs nothing).
   */
  private pendingReceipts = new Map<
    string,
    {
      ack: { messageId?: string; fileId?: string };
      targetDeviceId: string;
      attempts: number;
      nextAttemptAt: number;
    }
  >();

  private flushPendingReceipts() {
    if (this.pendingReceipts.size === 0) return;
    const now = Date.now();
    for (const [key, entry] of Array.from(this.pendingReceipts.entries())) {
      if (entry.nextAttemptAt > now) continue;
      if (entry.attempts >= 30) {
        this.pendingReceipts.delete(key);
        continue;
      }
      entry.attempts += 1;
      entry.nextAttemptAt = now + 15000;
      void this.pushEnvelope(entry.targetDeviceId, { type: 'DELIVERY_ACK', ...entry.ack }, 6000)
        .then(() => this.pendingReceipts.delete(key))
        .catch(() => {});
    }
  }

  private async pushMailboxItem(
    recipientId: string,
    envelope: Record<string, any>,
    attachment?: { metadata: Record<string, any>; base64: string },
    timeoutMs = 8000
  ): Promise<void> {
    const encryptedEnvelope = btoa(unescape(encodeURIComponent(JSON.stringify(envelope))));
    const body = JSON.stringify({
      senderDeviceId: this.identity.deviceId,
      recipientDeviceId: recipientId,
      encryptedEnvelope,
      timestamp: Date.now(),
      ...(attachment
        ? { fileMetadata: attachment.metadata, fileBase64Chunk: attachment.base64 }
        : {}),
    });

    let lastError: any = null;
    let failures = 0;
    let throttles = 0;
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    while (failures < 3) {
      let response: Response | null = null;
      try {
        response = await this.fetchRelay(
          '/api/signaling/mailbox/send',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body,
          },
          timeoutMs
        );
      } catch (err: any) {
        if (err?.fatal) throw err;
        lastError = err;
      }

      if (response) {
        if (response.ok) return;
        // A chunk the relay refuses as too large will never fit: tell the
        // outbox this is final instead of retrying it.
        if (response.status === 413) {
          throw Object.assign(
            new Error('This attachment is too large for the relay.'),
            { fatal: true }
          );
        }
        // The relay meters requests per minute. Chunked uploads are bursts of
        // small requests, so wait the window out instead of failing a file.
        if (response.status === 429 && throttles < 8) {
          throttles += 1;
          await sleep(5000);
          continue;
        }
        lastError = new Error(`Signaling server returned HTTP ${response.status}`);
      }

      failures += 1;
      if (failures < 3) await sleep(500 * failures);
    }
    throw lastError || new Error('Could not reach the signaling server');
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
      this.pendingReceipts.delete(`${ack.messageId || ''}|${ack.fileId || ''}`);
    } catch {
      // Remember it and keep trying: without this receipt the sender would only
      // ever see a single tick for a file that is safely stored here.
      this.pendingReceipts.set(`${ack.messageId || ''}|${ack.fileId || ''}`, {
        ack,
        targetDeviceId,
        attempts: 0,
        nextAttemptAt: Date.now() + 8000,
      });
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

  /**
   * Handles one item from the relay: an SSE push or a poll result.
   *
   * The item is acknowledged back to the relay only once it is stored on this
   * device, so a dropped push stream, a lost response or a crash mid-processing
   * can never lose a message — the relay simply keeps it and offers it again.
   * A duplicate is still run through the dispatcher so the sender gets its
   * confirmation once more.
   */
  public async processIncomingMailboxItem(item: any) {
    if (!item) return;
    if (item.id && !this.processedMailboxIds.has(item.id)) {
      this.processedMailboxIds.add(item.id);
      if (this.processedMailboxIds.size > 1000) {
        const oldest = this.processedMailboxIds.values().next().value;
        if (oldest) this.processedMailboxIds.delete(oldest);
      }
    }
    try {

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

      // 2.9 The sender's thumbnail for a photo whose bytes are still on their
      //     way. It fills the bubble immediately and is replaced by the real
      //     file the moment it lands — nothing here confirms delivery.
      if (envelope.type === 'FILE_PREVIEW') {
        await this.handleFilePreview(envelope, item.senderDeviceId || envelope.senderDeviceId);
        return;
      }

      // 3. A complete attachment is waiting on the relay. It is downloaded,
      //    verified and stored before it is acknowledged, and it becomes a
      //    message exactly once — when the whole file is safely here.
      if (envelope.type === 'FILE_READY') {
        await this.handleFileReady(envelope, item);
        return;
      }

      // 3.1 The peer could not download an attachment we sent (the relay lost
      //     or expired the bytes). Upload it once more, same transfer, so the
      //     chunks still on the relay are reused.
      if (envelope.type === 'FILE_PULL_REQUEST') {
        await this.handleFileResendRequest(
          envelope,
          item.senderDeviceId || envelope.senderDeviceId
        );
        return;
      }

      const messageId = envelope.messageId || item.id;

      const duplicate = await db.messages
        .filter((message) => !!messageId && message.messageId === messageId)
        .first();
      if (duplicate) {
        // Our earlier confirmation went missing: answer again so the sender
        // stops retrying and shows the double tick.
        void this.sendDeliveryAck({ messageId }, item.senderDeviceId, false);
        return;
      }
      // Do not turn an invalid/stale relay envelope into a fake message.
      // This was the source of the intermittent "[Encrypted Message]" rows.
      if (typeof envelope.text !== 'string') return;

      const msgRecord: MessageRecord = {
        messageId,
        chatDeviceId: item.senderDeviceId,
        direction: 'INBOUND',
        payloadText: envelope.text,
        mediaType: 'text',
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
      void this.sendDeliveryAck({ messageId }, item.senderDeviceId, false);
    } catch (pErr) {
      // Leave the item unacknowledged: the relay keeps it and offers it again,
      // so a transient failure can never lose a message. A genuinely broken
      // item is dropped after a few attempts instead of looping forever.
      console.warn('Process mailbox item error:', pErr);
      if (item.id) {
        const failures = (this.mailboxFailures.get(item.id) || 0) + 1;
        if (failures < 4) {
          this.mailboxFailures.set(item.id, failures);
        } else {
          this.mailboxFailures.delete(item.id);
          this.ackMailboxItem(item.id);
        }
        if (this.mailboxFailures.size > 500) this.mailboxFailures.clear();
      }
      return;
    }
    if (item.id) this.mailboxFailures.delete(item.id);
    this.ackMailboxItem(item.id);
  }

  /**
   * Tells the relay an item is safely stored here so it can drop its copy.
   * Acks are batched: a large attachment arrives as many chunks, and one
   * request per chunk would cost more than the chunks themselves.
   */
  private ackMailboxItem(id?: string) {
    if (!id || !this.identity?.deviceId) return;
    this.mailboxAckQueue.add(id);
    if (this.mailboxAckTimer) return;
    this.mailboxAckTimer = setTimeout(() => void this.flushMailboxAcks(), 350);
  }

  private async flushMailboxAcks(): Promise<void> {
    this.mailboxAckTimer = null;
    if (this.mailboxAckQueue.size === 0 || !this.identity?.deviceId) return;
    const ids = Array.from(this.mailboxAckQueue);
    this.mailboxAckQueue.clear();
    try {
      await this.fetchRelay(
        '/api/signaling/mailbox/ack',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deviceId: this.identity.deviceId, ids }),
        },
        8000
      );
    } catch {
      // Still unacknowledged on the relay; the next poll hands it over again.
    }
  }

  /**
   * The one place an incoming attachment becomes a stored file and a message.
   *
   * Every transport ends here — the direct link and the relay — so a photo can
   * never be stored twice, can never gain a twin bubble, and always lands in the
   * bubble the sender already sees. Matching happens on the sender's message id
   * first (the thumbnail may have created the row minutes earlier) and on the
   * file id as a fallback.
   */
  private async storeInboundAttachment(params: {
    fileId: string;
    name: string;
    size: number;
    mimeType: string;
    hashSHA256: string;
    blob: Blob;
    messageId?: string;
    senderDeviceId: string;
    senderDisplayName?: string;
    previewUrl?: string;
    timestamp?: number;
  }): Promise<{ row: MessageRecord; fileRecord: FileRecord; isNew: boolean } | null> {
    const { messageId, senderDeviceId } = params;
    if (!params.fileId || !senderDeviceId) return null;
    if (!params.blob || params.blob.size === 0) return null;

    const fileRecord: FileRecord = {
      fileId: params.fileId,
      name: params.name || 'attachment',
      size: params.size || params.blob.size,
      mimeType: params.mimeType || 'application/octet-stream',
      hashSHA256: params.hashSHA256,
      blobRef: params.blob,
      isImage: (params.mimeType || '').startsWith('image/'),
      isAudio: (params.mimeType || '').startsWith('audio/'),
      isVideo: (params.mimeType || '').startsWith('video/'),
      previewUrl: params.previewUrl,
    };
    await db.files.put(fileRecord);

    // An attachment from a device we have never paired with still needs a
    // conversation to live in, so the contact exists before the message does.
    if (!(await db.contacts.get(senderDeviceId))) {
      await this.saveContact(
        senderDeviceId,
        '',
        '000000',
        params.senderDisplayName || `Peer-${senderDeviceId.slice(4, 8)}`
      );
    }

    const existing =
      (messageId
        ? await db.messages.where('messageId').equals(messageId).first()
        : undefined) ||
      (await db.messages.where('fileId').equals(fileRecord.fileId).first());
    const isNew = !existing;
    const alreadyStored = existing?.attachmentState === 'ready';

    const { blobRef: _bytes, ...fileMeta } = fileRecord;
    const mediaType = fileRecord.isImage
      ? 'image'
      : fileRecord.isAudio
      ? 'audio'
      : fileRecord.isVideo
      ? 'video'
      : 'file';

    const row: MessageRecord = {
      ...(existing || {}),
      messageId: existing?.messageId || messageId,
      chatDeviceId: existing?.chatDeviceId || senderDeviceId,
      direction: 'INBOUND',
      payloadText: existing?.payloadText || fileRecord.name,
      fileId: fileRecord.fileId,
      fileRecord: fileMeta,
      mediaType: existing?.mediaType && existing.mediaType !== 'text' ? existing.mediaType : mediaType,
      senderDisplayName: existing?.senderDisplayName || params.senderDisplayName,
      timestamp: existing?.timestamp || params.timestamp || Date.now(),
      status: 'delivered',
      attachmentState: 'ready',
    };

    if (existing?.id !== undefined) {
      await db.messages.update(existing.id, {
        messageId: row.messageId,
        chatDeviceId: row.chatDeviceId,
        payloadText: row.payloadText,
        fileId: row.fileId,
        fileRecord: row.fileRecord,
        mediaType: row.mediaType,
        senderDisplayName: row.senderDisplayName,
        status: 'delivered',
        attachmentState: 'ready',
      });
      row.id = existing.id;
    } else {
      row.id = await db.messages.add(row);
    }

    notifyVaultChange('file');

    // A retry of something we already have stays silent: no second bubble, no
    // second sound, no second notification — only the receipt the sender needs.
    if (!alreadyStored) {
      this.events.onFileCompleted(fileRecord, params.blob);
      this.events.onMessageReceived(row);
    }
    return { row, fileRecord, isNew };
  }

  /**
   * The sender's thumbnail for a photo whose bytes have not landed yet.
   *
   * It fills the bubble immediately — slightly blurred, with a progress badge —
   * so the conversation reads as “here it is, sharpening” instead of a silent
   * loading box. It never confirms delivery: only the real bytes do that.
   */
  private async handleFilePreview(envelope: any, senderDeviceId: string): Promise<void> {
    const messageId = String(envelope.messageId || '');
    const previewUrl = String(envelope.previewUrl || '');
    const fileId = String(envelope.fileId || '');
    if (!messageId || !previewUrl || !senderDeviceId) return;

    const existing = await db.messages.where('messageId').equals(messageId).first();
    // Fully stored already: the preview has nothing left to add.
    if (existing?.attachmentState === 'ready') return;

    const name = String(envelope.name || existing?.fileRecord?.name || 'Photo');
    const row: MessageRecord = {
      ...(existing || {}),
      messageId,
      chatDeviceId: existing?.chatDeviceId || senderDeviceId,
      direction: 'INBOUND',
      payloadText: existing?.payloadText || name,
      fileId: fileId || existing?.fileId,
      fileRecord: {
        ...(existing?.fileRecord || { fileId, name, size: 0, mimeType: 'image/jpeg', hashSHA256: '' }),
        fileId: fileId || existing?.fileId || '',
        name,
        size: Number(envelope.size) || existing?.fileRecord?.size || 0,
        mimeType: String(envelope.mimeType || existing?.fileRecord?.mimeType || 'image/jpeg'),
        isImage: true,
        previewUrl,
      },
      mediaType: 'image',
      senderDisplayName: existing?.senderDisplayName || envelope.senderDisplayName,
      timestamp: existing?.timestamp || Number(envelope.timestamp) || Date.now(),
      status: 'delivered',
      attachmentState: 'receiving',
    };

    if (existing?.id !== undefined) {
      await db.messages.update(existing.id, {
        fileId: row.fileId,
        fileRecord: row.fileRecord,
        mediaType: row.mediaType,
        attachmentState: 'receiving',
      });
      row.id = existing.id;
    } else {
      if (!(await db.contacts.get(senderDeviceId))) {
        await this.saveContact(
          senderDeviceId,
          '',
          '000000',
          envelope.senderDisplayName || `Peer-${senderDeviceId.slice(4, 8)}`
        );
      }
      row.id = await db.messages.add(row);
      this.events.onMessageReceived(row);
    }
    notifyVaultChange('message');
  }

  /**
   * Asks the sender to put an attachment back on the relay.
   *
   * Used when this device knows about a photo — it has the bubble, maybe even
   * the thumbnail — but its bytes never arrived, or the local vault lost them.
   * Throttled per message so a retrying UI can never turn into a storm.
   */
  public requestAttachmentBytes(
    messageId: string,
    fileId: string,
    peerDeviceId: string,
    force = false
  ): void {
    if (!messageId || !peerDeviceId) return;
    const now = Date.now();
    if (!force && now - (this.lastResendAskedAt.get(messageId) || 0) < 20_000) return;
    this.lastResendAskedAt.set(messageId, now);
    if (this.lastResendAskedAt.size > 300) {
      const oldest = this.lastResendAskedAt.keys().next().value;
      if (oldest) this.lastResendAskedAt.delete(oldest);
    }
    void this.pushEnvelope(
      peerDeviceId,
      {
        type: 'FILE_PULL_REQUEST',
        messageId,
        fileId,
        senderDeviceId: this.identity.deviceId,
        timestamp: now,
      },
      10000
    ).catch(() => {
      /* the next attempt (or the chat's own retry) comes back around */
    });
  }

  /**
   * A complete attachment is waiting on the relay: download it, verify it,
   * store it and only then confirm it.
   *
   * The conversation is not touched before the whole file is in the local
   * vault, so a chat can never show a half photo, a stuck “decrypting”
   * placeholder, or the same photo arriving twice. If anything fails the relay
   * note is simply left alone and comes back around, which makes a retry
   * automatic and free.
   */
  private async handleFileReady(envelope: any, item: any): Promise<void> {
    const transferId = String(envelope.transferId || '');
    const token = String(envelope.token || '');
    const messageId = String(envelope.messageId || '');
    const fileId = String(envelope.fileId || '');
    const senderDeviceId = String(item.senderDeviceId || envelope.senderDeviceId || '');
    if (!transferId || !token || !messageId || !senderDeviceId) {
      if (item?.id) this.ackMailboxItem(item.id);
      return;
    }

    const now = Date.now();
    let state = this.inboundFiles.get(messageId);
    if (!state) {
      state = { attempts: 0, lastAttemptAt: 0, inFlight: false, askedForResend: false };
      this.inboundFiles.set(messageId, state);
    }
    // One download at a time, never in a tight loop. The relay keeps the note,
    // so a slow or failed attempt comes back around instead of storming. The
    // claim happens before any await: the note can arrive twice at once (a push
    // and a poll), and two passes would mean two photos and two sounds.
    if (state.inFlight) return;
    if (now - state.lastAttemptAt < PeerManager.DOWNLOAD_RETRY_COOLDOWN_MS) return;
    state.inFlight = true;
    state.lastAttemptAt = now;

    // The file is already here (the relay re-offered its note): confirm it once
    // more so the sender can stop retrying, then drop the note.
    if (await this.findStoredAttachment(messageId, fileId)) {
      state.inFlight = false;
      this.inboundFiles.delete(messageId);
      void this.sendDeliveryAck({ messageId, fileId }, senderDeviceId, false);
      if (item?.id) this.ackMailboxItem(item.id);
      return;
    }

    const name = String(envelope.name || 'attachment');
    const mimeType = String(envelope.mimeType || 'application/octet-stream');

    try {
      const blob = await this.downloadRelayFile(
        transferId,
        token,
        fileId,
        name,
        mimeType,
        Number(envelope.size) || 0
      );
      const digest = arrayBufferToHex(await sha256(new Uint8Array(await blob.arrayBuffer())));
      const expectedHash = String(envelope.hashSHA256 || '');
      if (expectedHash && digest !== expectedHash) {
        throw new Error('Attachment failed its integrity check.');
      }

      const fileRecord: FileRecord = {
        fileId: fileId || digest.slice(0, 16).toUpperCase(),
        name,
        size: Number(envelope.size) || blob.size,
        mimeType,
        hashSHA256: digest,
        blobRef: blob,
        isImage: mimeType.startsWith('image/'),
        isAudio: mimeType.startsWith('audio/'),
        isVideo: mimeType.startsWith('video/'),
      };
      await db.files.put(fileRecord);

      // An attachment from a device we have never paired with still needs a
      // conversation to live in, so the contact exists before the message does.
      if (!(await db.contacts.get(senderDeviceId))) {
        await this.saveContact(
          senderDeviceId,
          '',
          '000000',
          String(envelope.senderDisplayName || `Peer-${senderDeviceId.slice(4, 8)}`)
        );
      }

      // One row per message id, always: a placeholder left behind by an earlier
      // attempt is completed here instead of gaining a twin next to it.
      const existingRow = await db.messages.where('messageId').equals(messageId).first();
      const row: MessageRecord = {
        ...(existingRow || {}),
        messageId,
        chatDeviceId: senderDeviceId,
        direction: 'INBOUND',
        payloadText: existingRow?.payloadText || name,
        fileId: fileRecord.fileId,
        fileRecord,
        mediaType: fileRecord.isImage
          ? 'image'
          : fileRecord.isAudio
          ? 'audio'
          : fileRecord.isVideo
          ? 'video'
          : 'file',
        timestamp: existingRow?.timestamp || Number(envelope.timestamp) || Date.now(),
        status: 'delivered',
      };
      if (existingRow) {
        await db.messages.update(existingRow.id!, {
          payloadText: row.payloadText,
          fileId: row.fileId,
          fileRecord: row.fileRecord,
          mediaType: row.mediaType,
          status: 'delivered',
        });
      } else {
        row.id = await db.messages.add(row);
      }

      this.inboundFiles.delete(messageId);

      // Exactly one completion, exactly one sound, exactly one bubble: this is
      // the only place a received attachment becomes a message.
      this.events.onFileCompleted(fileRecord, blob);
      this.events.onMessageReceived(row);
      void this.sendDeliveryAck({ messageId, fileId: fileRecord.fileId }, senderDeviceId, false);
      if (item?.id) this.ackMailboxItem(item.id);
      // Stored here, so the relay may let the bytes go.
      void this.releaseRelayFile(transferId, token);
    } catch (err) {
      state.inFlight = false;
      state.attempts += 1;
      this.inboundFiles.set(messageId, state);
      console.warn('Attachment download failed:', err);
      if (state.attempts >= PeerManager.MAX_TRANSFER_PULL_REQUESTS && !state.askedForResend) {
        // The relay no longer has it (expired, evicted, or a fresh relay): ask
        // the sender for the bytes once. Anything more would be a storm.
        state.askedForResend = true;
        void this.pushEnvelope(
          senderDeviceId,
          {
            type: 'FILE_PULL_REQUEST',
            messageId,
            fileId,
            senderDeviceId: this.identity.deviceId,
            timestamp: Date.now(),
          },
          8000
        ).catch(() => {});
      }
    }
  }

  /**
   * True when the relay already holds the complete attachment. Asks the relay to
   * remind the recipient as well, because the recipient answers with a fresh
   * receipt and this is how a receipt lost to a reload finds its way home.
   */
  private async relayTransferReady(transferId: string, token: string): Promise<boolean> {
    try {
      const response = await this.fetchRelay(
        `/api/signaling/file/${encodeURIComponent(transferId)}/status?renotify=1&token=${encodeURIComponent(
          token
        )}`,
        { method: 'GET', headers: { Accept: 'application/json' } },
        8000
      );
      if (!response.ok) return false;
      const data: any = await response.json();
      return !!data?.ready;
    } catch {
      // Unknown: upload it. Sending bytes again is always safe, assuming they
      // are already there is not.
      return false;
    }
  }

  /**
   * Pulls a completed attachment off the relay as a single file, reporting
   * progress while it streams. One request means the result is either the whole
   * file or a clean failure — never a partial one to stitch back together.
   */
  private async downloadRelayFile(
    transferId: string,
    token: string,
    fileId: string,
    name: string,
    mimeType: string,
    size: number
  ): Promise<Blob> {
    // The download budget grows with the attachment: a big video on a slow link
    // must not be cut off halfway and reported as a failed transfer.
    const response = await this.fetchRelay(
      `/api/signaling/file/${encodeURIComponent(transferId)}/${encodeURIComponent(token)}`,
      { method: 'GET', headers: { Accept: 'application/octet-stream' } },
      Math.max(45000, this.uploadTimeoutMs(size))
    );
    if (!response.ok) {
      throw new Error(`Attachment is not available on the relay (HTTP ${response.status}).`);
    }

    const totalBytes = Number(response.headers.get('Content-Length')) || size || 0;
    const progress: FileTransferProgress = {
      fileId,
      name,
      size: totalBytes,
      mimeType,
      hashSHA256: '',
      direction: 'INBOUND',
      // Progress is reported in bytes for a download, which is what the user
      // actually sees moving.
      totalChunks: totalBytes || 1,
      transferredChunks: 0,
      progressPercent: totalBytes ? 0 : 50,
      status: 'transferring',
    };
    this.events.onFileProgress({ ...progress });

    const finish = (received: number) => {
      progress.transferredChunks = received;
      progress.progressPercent = 100;
      progress.status = 'completed';
      this.events.onFileProgress({ ...progress });
    };

    if (!response.body) {
      const buffer = await response.arrayBuffer();
      finish(buffer.byteLength);
      return new Blob([buffer], { type: mimeType });
    }

    const reader = response.body.getReader();
    const parts: BlobPart[] = [];
    let received = 0;
    let lastReport = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      parts.push(value as unknown as BlobPart);
      received += value.byteLength;
      const now = Date.now();
      if (now - lastReport > 120) {
        lastReport = now;
        progress.transferredChunks = received;
        progress.progressPercent = totalBytes
          ? Math.min(99, Math.round((received / totalBytes) * 100))
          : 50;
        this.events.onFileProgress({ ...progress });
      }
    }

    finish(received);
    return new Blob(parts, { type: mimeType });
  }

  /** Lets the relay drop the bytes now that this device has them. */
  private async releaseRelayFile(transferId: string, token: string): Promise<void> {
    try {
      await this.fetchRelay(
        `/api/signaling/file/${encodeURIComponent(transferId)}/ack`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        },
        8000
      );
    } catch {
      // The relay's own TTL cleans up if this never lands.
    }
  }

  /** The stored attachment for a message, if this device already has it. */
  private async findStoredAttachment(messageId: string, fileId: string): Promise<boolean> {
    const row = await db.messages.where('messageId').equals(messageId).first();
    if (!row) return false;
    if (row.fileRecord?.blobRef) return true;
    if (!fileId) return false;
    const record = await db.files.get(fileId);
    return !!record?.blobRef;
  }

  /**
   * The peer is telling us an attachment it announced is still missing here.
   * That is a request to send it again, not to trust anything else, so the
   * message has to be one of ours and addressed to that device.
   */
  private async handleFileResendRequest(envelope: any, requesterDeviceId: string): Promise<void> {
    const messageId = String(envelope?.messageId || '');
    if (!messageId || !requesterDeviceId) return;
    const now = Date.now();
    // Serve at most one resend per transfer per window, however many devices ask.
    if (now - (this.lastPullServedAt.get(messageId) || 0) < 15000) return;

    const row = await db.messages.where('messageId').equals(messageId).first();
    if (!row || row.direction !== 'OUTBOUND' || row.chatDeviceId !== requesterDeviceId) return;
    if (!row.fileId) return;

    this.lastPullServedAt.set(messageId, now);
    if (this.lastPullServedAt.size > 200) {
      const oldest = this.lastPullServedAt.keys().next().value;
      if (oldest) this.lastPullServedAt.delete(oldest);
    }

    // Same transfer, same token: the chunks the relay already holds are reused,
    // so a resend only uploads what is genuinely missing.
    const previous = this.outbox.get(messageId);
    this.outbox.delete(messageId);
    this.activeFileTransfers.delete(messageId);
    this.registerOutbox({
      messageId,
      chatDeviceId: row.chatDeviceId,
      kind: 'file',
      fileId: row.fileId,
      transferToken: previous?.transferToken,
      attempts: 0,
      nextAttemptAt: Date.now(),
    });
    void this.tickOutbox();
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
