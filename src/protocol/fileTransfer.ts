import { db } from '../db/index';
import {
  AckStatus,
  FileRecord,
  FileTransferProgress,
  PacketType,
  TransferStateRecord,
} from '../types/index';
import { arrayBufferToHex, sha256 } from '../crypto/utils';
import {
  buildPacketHeader,
  ChunkAckPayload,
  decodeChunkAckPayload,
  decodeFileHeaderPayload,
  decodeFileResumePayload,
  encodeChunkAckPayload,
  encodeFileHeaderPayload,
  encodeFileResumePayload,
  FileHeaderPayload,
} from './packet';
import { CryptoSession } from '../crypto/session';
import { extractImageExif } from '../utils/exifParser';
import { measureImageDimensions } from '../utils/imageHelper';

/*
 * The attachment pipeline.
 * ---------------------------------------------------------------------------
 * One engine moves a file from one device to another and never guesses:
 *
 *   sender                                    receiver
 *   FILE_HEADER        ------------------->   "here is the file, in this shape"
 *                      <-------------------   FILE_RESUME "I already hold N bytes"
 *   FILE_CHUNK xN      ------------------->   (pipelined, windowed, in order)
 *                      <-------------------   CHUNK_ACK (batched, cumulative)
 *
 * Everything the protocol needs for the hard cases is in that first exchange.
 * A receiver that was interrupted — the tab was closed, the phone dropped off
 * the network, the browser was reloaded — answers with how much of the file it
 * still holds, and the sender simply streams the rest. That is what makes an
 * interrupted transfer a pause instead of a restart, and it is why the file
 * always lands even though the link behind it keeps changing.
 *
 * The bytes are never awaited one frame at a time: the sender keeps a window of
 * frames in flight, so a round trip no longer costs throughput. Frames are
 * written through the peer's ordered send queue, which keeps the AEAD counter
 * order and the wire order identical.
 */

export const CHUNK_SIZE = 256 * 1024; // Default frame: the largest every browser accepts
/** Biggest frame we will build, even on a very fast link. */
export const MAX_CHUNK_SIZE = 2 * 1024 * 1024;
/** Smallest frame, so a slow link still gets pipelined packets. */
export const MIN_CHUNK_SIZE = 32 * 1024;

/**
 * Largest frame we will ever build, whatever the channel claims.
 *
 * Browsers disagree wildly about `maxMessageSize`: Chrome reports ~256 KB,
 * Firefox roughly a gigabyte, and some builds report 0. A frame the SCTP layer
 * refuses makes `send()` throw and kills the whole transfer, so every frame is
 * capped at the size all implementations actually accept.
 */
export const SAFE_FRAME_CEILING = 256 * 1024 - 4096;

/** Bytes allowed in flight on an internet link, and on a host-to-host one. */
const WAN_WINDOW_BYTES = 24 * 1024 * 1024;
const LAN_WINDOW_BYTES = 64 * 1024 * 1024;
/** Receiver: acknowledge at least every N frames, and at least every N ms. */
const ACK_EVERY_CHUNKS_DEFAULT = 16;
const ACK_MAX_DELAY_MS = 1200;

/** How long the sender waits for the receiver's resume point before starting at 0. */
const RESUME_WAIT_MS = 1500;
/** Quiet time after which an unmoving transfer is nudged, and how often. */
const RESEND_QUIET_MS = 4000;
const MAX_RESEND_ROUNDS = 8;
const RESEND_BURST_FRAMES = 24;
/** Time for the final acknowledgement of a fully sent file. */
const FINAL_ACK_TIMEOUT_MS = 20000;

/** Received bytes are written to the vault this often, so a crash loses little. */
const PERSIST_EVERY_BYTES = 8 * 1024 * 1024;
const PERSIST_EVERY_FRAMES = 48;

/** How much of the previous speed reading survives each new sample. */
const SPEED_SMOOTHING = 0.35;

/**
 * Encrypts and writes one frame. Supplied by the peer manager so every frame on
 * a live link is written in the same order its nonce counter was allocated (see
 * the send queue in `PeerManager`). Without it a heartbeat or an ACK can reach
 * the channel before the chunk that was encrypted first, and neither side can
 * authenticate either frame afterwards.
 */
export type SendFrameFn = (header24: Uint8Array, payload: Uint8Array) => Promise<void>;

/**
 * Conversation metadata that rides in the FILE_HEADER.
 *
 * It is what lets an attachment delivered over the direct link land in the same
 * bubble the relay would have used: the receiver stores the file under the
 * sender's message id instead of inventing a second message for it.
 */
export interface FileCompletionMeta {
  messageId?: string;
  senderDeviceId?: string;
  senderDisplayName?: string;
  previewUrl?: string;
  width?: number;
  height?: number;
  durationMs?: number;
}

/**
 * Where a completed inbound attachment is handed over.
 *
 * The peer manager owns the conversation, so it is the one that knows whether
 * an attachment completes a bubble the sender already announced or has to open
 * a new one. The transfer engine therefore stores nothing itself: it reports the
 * file, its bytes and the metadata that travelled in the header, and exactly one
 * store step follows - whichever transport carried the bytes.
 */
export type AttachmentCompletionSink = (
  fileRecord: FileRecord,
  blob: Blob,
  meta?: FileCompletionMeta
) => Promise<void> | void;

/**
 * Where an announced-but-incomplete attachment is handed over.
 *
 * This is what puts the file's *shape* in the conversation the moment its
 * header arrives — name, size, kind, real pixel size and thumbnail — as a card
 * that cannot be opened yet. The bytes fill it in afterwards.
 */
export type AttachmentAnnounceSink = (
  announcement: {
    fileId: string;
    name: string;
    size: number;
    mimeType: string;
    hashSHA256: string;
    totalChunks: number;
    chunkSize: number;
    width?: number;
    height?: number;
    durationMs?: number;
  },
  meta?: FileCompletionMeta
) => Promise<void> | void;

export interface FileTransferEvents {
  onProgress?: (progress: FileTransferProgress) => void;
  onCompleted?: (fileRecord: FileRecord, blob: Blob, meta?: FileCompletionMeta) => void;
  onError?: (fileId: string, error: string) => void;
}

export interface TransferOptions {
  /**
   * True when both devices are on the same network (host-to-host ICE pair).
   * Frames get bigger and the in-flight window deeper, because there is no
   * uplink to saturate and no relay in the way.
   */
  isLan?: boolean;
  /** Force a frame size (tests, or a caller that already measured the link). */
  chunkSize?: number;
  /** Conversation metadata carried in the header (message id, sender, preview). */
  meta?: FileCompletionMeta;
  /** Serialized frame writer; see `SendFrameFn`. */
  sendFrame?: SendFrameFn;
  /**
   * True when the header should be sent before the bytes are available, which
   * is what puts the file's shape on the other device straight away.
   */
  announceOnly?: boolean;
}

/**
 * Picks the frame size for a link.
 *
 * Bigger frames mean fewer encrypt calls, fewer SCTP messages and far fewer
 * ACK round trips — which is exactly what a LAN needs. They are capped by the
 * channel's own maximum message size (browsers disagree: Chromium reports
 * 256 KB, others 64 KB) and by a ceiling so a weak device never has to
 * allocate a huge frame.
 */
export function pickChunkSize(dataChannel: RTCDataChannel, options?: TransferOptions): number {
  // Not in every TS DOM lib yet, but every browser ships it at runtime.
  const reported = Number((dataChannel as any).maxMessageSize) || 0;
  // Leave room for the packet header and the AEAD tag, and never exceed what
  // every browser's SCTP stack accepts: a rejected frame loses the transfer.
  const ceiling = reported > 4096
    ? Math.min(reported - 2048, SAFE_FRAME_CEILING)
    : SAFE_FRAME_CEILING;
  if (options?.chunkSize) {
    return Math.max(MIN_CHUNK_SIZE, Math.min(options.chunkSize, MAX_CHUNK_SIZE, ceiling));
  }
  const desired = options?.isLan ? SAFE_FRAME_CEILING : CHUNK_SIZE;
  return Math.max(MIN_CHUNK_SIZE, Math.min(desired, MAX_CHUNK_SIZE, ceiling));
}

/** Highest chunk index with no gap below it. */
function highestContiguous(chunks: Map<number, Uint8Array>, from: number): number {
  let index = from - 1;
  while (chunks.has(index + 1)) index += 1;
  return index;
}

interface IncomingFile {
  header: FileHeaderPayload;
  fileIdBigInt: bigint;
  /** Bytes already in the vault when this session picked the transfer up. */
  storedBytes: number;
  /** First chunk index (in the sender's frame grid) still wanted. */
  firstNeededChunk: number;
  chunks: Map<number, Uint8Array>;
  /** Bytes held right now: the stored prefix plus the contiguous frames after it. */
  heldBytes: number;
  startTime: number;
  lastAckAt: number;
  /** Highest chunk index this side has already acknowledged. */
  lastAckedChunk: number;
  lastReportAt: number;
  lastReportedPercent: number;
  speedBps: number;
  /** Bytes received since the prefix was last written to the vault. */
  unpersistedBytes: number;
  persistInFlight: boolean;
  persistPending: boolean;
  channel: RTCDataChannel;
  session: CryptoSession;
  sendFrame?: SendFrameFn;
  events?: FileTransferEvents;
  ackTimer: ReturnType<typeof setTimeout> | null;
}

interface OutgoingTransfer {
  fileId: string;
  fileIdBigInt: bigint;
  name: string;
  size: number;
  mimeType: string;
  hashSHA256: string;
  bytes: Uint8Array;
  chunkSize: number;
  totalChunks: number;
  /** First chunk the peer still needs (set from its FILE_RESUME). */
  startChunk: number;
  resolvedResume: boolean;
  highestAcked: number;
  lastAckAt: number;
  resendRounds: number;
  watchdog: ReturnType<typeof setInterval> | null;
  channel: RTCDataChannel;
  session: CryptoSession;
  sendFrame?: SendFrameFn;
  events?: FileTransferEvents;
  progress: FileTransferProgress;
  meta?: FileCompletionMeta;
  maxBufferedAmount: number;
  smoothedSpeedBps: number;
  asyncCompletion: { resolve: () => void } | null;
  /**
   * Every frame of this transfer is written behind the one before it, so the
   * nonce counter order and the wire order can never disagree. See
   * `writeChunkFrame`.
   */
  writeChain: Promise<void>;
  cancelled: boolean;
}

export class FileTransferManager {
  /** Receiver's batch size. Kept settable so the harness can compare modes. */
  private static ACK_EVERY_CHUNKS = ACK_EVERY_CHUNKS_DEFAULT;
  /**
   * Shortest gap between two progress reports. A transfer is not a stopwatch:
   * repainting the chat hundreds of times a second is work taken away from
   * moving the bytes, and on a phone it is felt as a slow transfer.
   */
  private static readonly PROGRESS_REPORT_MS = 120;

  private activeTransfers: Map<string, FileTransferProgress> = new Map();
  private incomingFiles: Map<string, IncomingFile> = new Map();
  private outgoing: Map<string, OutgoingTransfer> = new Map();
  private resumeWaiters: Map<string, () => void> = new Map();
  private isCancelled = new Set<string>();
  /**
   * Inbound packets are handled one at a time. Chunk bookkeeping is stateful
   * (a Map, a byte count and a completion check), and two chunks finishing at
   * once used to be able to reassemble the same file twice.
   */
  private inboundQueue: Promise<unknown> = Promise.resolve();

  /**
   * The peer manager tells us when the current link is host-to-host. It only
   * affects tuning (frame size, in-flight window) — never the wire format — so
   * a stale hint can never break a transfer.
   */
  private lanHint = false;

  /** Registered once by the peer manager; see `AttachmentCompletionSink`. */
  private completionSink: AttachmentCompletionSink | null = null;
  /** Registered once by the peer manager; see `AttachmentAnnounceSink`. */
  private announceSink: AttachmentAnnounceSink | null = null;

  public setAttachmentCompletionSink(sink: AttachmentCompletionSink | null): void {
    this.completionSink = sink;
  }

  public setAttachmentAnnounceSink(sink: AttachmentAnnounceSink | null): void {
    this.announceSink = sink;
  }

  public setLanHint(isLan: boolean): void {
    this.lanHint = isLan;
  }

  public getTransfer(fileId: string): FileTransferProgress | undefined {
    return this.activeTransfers.get(fileId);
  }

  public getAllTransfers(): FileTransferProgress[] {
    return Array.from(this.activeTransfers.values());
  }

  /** True while this device is still streaming these bytes to a peer. */
  public isSending(fileId: string): boolean {
    return this.outgoing.has(fileId);
  }

  public cancelTransfer(fileId: string): void {
    this.isCancelled.add(fileId);
    this.cleanupTransferState(fileId);
    const transfer = this.activeTransfers.get(fileId);
    if (transfer) transfer.status = 'error';
  }

  private cleanupTransferState(fileId: string): void {
    const ctx = this.outgoing.get(fileId);
    if (ctx?.watchdog) clearInterval(ctx.watchdog);
    ctx?.asyncCompletion?.resolve();
    this.outgoing.delete(fileId);
    this.resumeWaiters.delete(fileId);

    const incoming = this.incomingFiles.get(fileId);
    if (incoming?.ackTimer) clearTimeout(incoming.ackTimer);
    this.incomingFiles.delete(fileId);
  }

  /**
   * Drops resume state that can no longer be resumed.
   *
   * A transfer the sender never came back to is not worth keeping bytes for: on
   * a phone that is storage the user would rather spend on photos that did
   * arrive.
   */
  public async pruneTransferState(maxAgeMs = 24 * 60 * 60 * 1000): Promise<void> {
    try {
      const rows = await db.transfers.toArray();
      const cutoff = Date.now() - maxAgeMs;
      for (const row of rows) {
        if ((row.updatedAt || 0) < cutoff) {
          await db.transfers.delete(row.transferId).catch(() => {});
        }
      }
    } catch {
      /* resume state is a convenience, never a requirement */
    }
  }

  /**
   * Resolves as soon as the SCTP send buffer drains below its low watermark.
   * Uses the native `bufferedamountlow` signal so the send loop resumes on the
   * very next packet instead of after a polling tick.
   */
  private waitForDrain(
    dataChannel: RTCDataChannel,
    maxBufferedAmount = WAN_WINDOW_BYTES
  ): Promise<void> {
    return new Promise<void>((resolve) => {
      let settled = false;
      let poll: ReturnType<typeof setInterval> | undefined;
      const done = () => {
        if (settled) return;
        settled = true;
        if (poll) clearInterval(poll);
        try {
          dataChannel.removeEventListener('bufferedamountlow', done);
        } catch {
          /* a closed channel is fine */
        }
        resolve();
      };
      const lowWaterMark = Math.min(4 * 1024 * 1024, Math.max(256 * 1024, Math.floor(maxBufferedAmount / 2)));
      try {
        dataChannel.bufferedAmountLowThreshold = lowWaterMark;
        dataChannel.addEventListener('bufferedamountlow', done);
      } catch {
        /* engines without the event fall through to the poll below */
      }
      // Short poll as a safety net for engines that never fire the event, and
      // for a channel that closes while we wait.
      poll = setInterval(() => {
        if (dataChannel.readyState !== 'open') done();
        else if (dataChannel.bufferedAmount <= lowWaterMark) done();
      }, 12);
      if (dataChannel.readyState !== 'open') done();
    });
  }

  /**
   * Encrypts and writes one frame, in order.
   *
   * The live link's send queue is used when the peer manager supplied one, so
   * every frame is handed to the channel in the same order its nonce counter
   * was allocated.
   */
  private async writeFrame(
    dataChannel: RTCDataChannel,
    session: CryptoSession,
    header24: Uint8Array,
    payload: Uint8Array,
    sendFrame?: SendFrameFn
  ): Promise<void> {
    if (sendFrame) {
      await sendFrame(header24, payload);
      return;
    }
    const frame = await session.encryptFrame(header24, payload);
    if (dataChannel.readyState !== 'open') {
      throw new Error('Data channel is not open, cannot send chunk');
    }
    dataChannel.send(frame);
  }

  private reportProgress(ctx: OutgoingTransfer | IncomingFile, percent: number, speedBps: number): void {
    const fileId = 'fileId' in ctx ? ctx.fileId : ctx.header.fileId;
    const transfer = this.activeTransfers.get(fileId);
    if (!transfer) return;
    transfer.progressPercent = percent;
    transfer.speedBps = speedBps;
    this.activeTransfers.set(fileId, transfer);
    const events = ctx.events;
    events?.onProgress?.({ ...transfer });
  }

  /* ---------------------------------------------------------------------- */
  /* Sender                                                                  */
  /* ---------------------------------------------------------------------- */

  /**
   * Announces a file and streams it to the peer.
   *
   * The receiver answers the header with the number of bytes it already holds,
   * so an interrupted transfer continues instead of restarting, and the frames
   * that follow are pipelined: a window of them is always in flight.
   */
  public async sendFile(
    file: File,
    dataChannel: RTCDataChannel,
    session: CryptoSession,
    events?: FileTransferEvents,
    options?: TransferOptions
  ): Promise<FileRecord> {
    const arrayBuf = await file.arrayBuffer();
    const fileBytes = new Uint8Array(arrayBuf);
    const hashBytes = await sha256(fileBytes);
    const hashHex = arrayBufferToHex(hashBytes);

    const isLan = options?.isLan ?? this.lanHint;
    const chunkSize = pickChunkSize(dataChannel, { ...options, isLan });
    const maxBufferedAmount = isLan ? LAN_WINDOW_BYTES : WAN_WINDOW_BYTES;

    const fileIdBigInt = BigInt(
      '0x' +
        Array.from(hashBytes.slice(0, 8))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('')
    );
    const fileId = fileIdBigInt.toString(16).padStart(16, '0').toUpperCase();

    const totalChunks = Math.max(1, Math.ceil(fileBytes.byteLength / chunkSize));
    const mime = file.type || 'application/octet-stream';
    const isImage = mime.startsWith('image/');
    const isAudio = mime.startsWith('audio/');
    const isVideo = mime.startsWith('video/');

    let exifData = undefined;
    let dimensions: { width: number; height: number } | undefined;
    if (isImage) {
      // Measured from the pixels, not from EXIF: the conversation needs the real
      // aspect ratio to lay the photo out before its bytes arrive.
      dimensions = await measureImageDimensions(file).catch(() => undefined);
      try {
        exifData = await extractImageExif(file);
      } catch (err) {
        console.warn('Exif error:', err);
      }
    }
    const width = dimensions?.width ?? exifData?.imageWidth;
    const height = dimensions?.height ?? exifData?.imageHeight;

    const meta: FileCompletionMeta | undefined = options?.meta
      ? { ...options.meta, width, height }
      : { width, height };

    const fileHeader: FileHeaderPayload = {
      fileId,
      name: file.name,
      size: file.size,
      mimeType: mime,
      hashSHA256: hashHex,
      totalChunks,
      chunkSize,
      ...(meta || {}),
    };

    // A resumed transfer knows roughly where it stands before a byte moves.
    let resumedBytes = 0;
    try {
      const previous = await db.transfers.get(`out:${fileId}`);
      if (previous && previous.receivedBytes > 0 && previous.receivedBytes < file.size) {
        resumedBytes = previous.receivedBytes;
      }
    } catch {
      /* no resume state, start from the top */
    }

    const progress: FileTransferProgress = {
      fileId,
      name: file.name,
      size: file.size,
      mimeType: mime,
      hashSHA256: hashHex,
      direction: 'OUTBOUND',
      totalChunks,
      transferredChunks: Math.floor(resumedBytes / chunkSize),
      progressPercent: Math.round((resumedBytes / Math.max(file.size, 1)) * 100),
      status: 'transferring',
      blobUrl: typeof URL !== 'undefined' && URL.createObjectURL ? URL.createObjectURL(file) : undefined,
    };

    const ctx: OutgoingTransfer = {
      fileId,
      fileIdBigInt,
      name: file.name,
      size: file.size,
      mimeType: mime,
      hashSHA256: hashHex,
      bytes: fileBytes,
      chunkSize,
      totalChunks,
      startChunk: 0,
      resolvedResume: false,
      highestAcked: -1,
      lastAckAt: Date.now(),
      resendRounds: 0,
      watchdog: null,
      channel: dataChannel,
      session,
      sendFrame: options?.sendFrame,
      events,
      progress,
      meta,
      maxBufferedAmount,
      smoothedSpeedBps: 0,
      asyncCompletion: null,
      writeChain: Promise.resolve(),
      cancelled: false,
    };

    this.activeTransfers.set(fileId, progress);
    // Re-sending the same file (a retry after a dropped link, or the relay
    // fallback) must never inherit the cancelled flag of the earlier attempt.
    this.isCancelled.delete(fileId);
    this.outgoing.set(fileId, ctx);
    events?.onProgress?.({ ...progress });

    try {
      // 1. The header carries the file's shape: name, size, kind, real pixels.
      const headerBytes = buildPacketHeader(
        PacketType.FILE_HEADER,
        session.sessionId,
        fileIdBigInt,
        0
      );
      await this.writeFrame(
        dataChannel,
        session,
        headerBytes,
        encodeFileHeaderPayload(fileHeader),
        options?.sendFrame
      );

      // 2. Wait a moment for the receiver to say what it already holds. A peer
      //    that has nothing (or is running an older build) simply does not
      //    answer, and the transfer starts at the first frame.
      if (!ctx.resolvedResume) {
        await this.waitForResume(ctx);
      }

      // 3. Stream the frames that are still needed.
      await this.pumpChunks(ctx);

      // 4. The last frame has to be acknowledged before this side may claim the
      //    peer has the file.
      await this.awaitFinalAck(ctx);

      progress.status = 'completed';
      progress.progressPercent = 100;
      progress.transferredChunks = totalChunks;
      events?.onProgress?.({ ...progress });

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
        exifData,
        width,
        height,
        transferSpeedBps: ctx.smoothedSpeedBps,
      };

      await db.files.put(fileRecord);
      await db.transfers.delete(`out:${fileId}`).catch(() => {});
      events?.onCompleted?.(fileRecord, file, meta);
      return fileRecord;
    } catch (err: any) {
      const transfer = this.activeTransfers.get(fileId);
      if (transfer) {
        transfer.status = 'error';
        events?.onProgress?.({ ...transfer });
      }
      events?.onError?.(fileId, err?.message || 'Transfer failed');
      throw err;
    } finally {
      this.cleanupTransferState(fileId);
    }
  }

  /** Resolves when the peer's FILE_RESUME arrives, or after a short wait. */
  private waitForResume(ctx: OutgoingTransfer): Promise<void> {
    return new Promise<void>((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        this.resumeWaiters.delete(ctx.fileId);
        resolve();
      };
      this.resumeWaiters.set(ctx.fileId, done);
      setTimeout(done, RESUME_WAIT_MS);
    });
  }

  /**
   * Encrypts and writes one frame of a transfer, behind every frame already
   * queued for it.
   *
   * `CryptoSession.encryptFrame` allocates its nonce counter the moment it is
   * called, but the ciphertext only reaches the channel after an await. Two
   * frames encrypted at the same time can therefore leave in the opposite order
   * to their counters, and a receiver that is even slightly behind refuses a
   * counter it cannot place within its window - the chunk is then lost for good.
   * That is what made a slower link lose pieces of a file forever. Chaining the
   * writes makes the counter order and the wire order the same thing.
   */
  private writeChunkFrame(ctx: OutgoingTransfer, index: number): Promise<void> {
    const run = ctx.writeChain.then(async () => {
      if (ctx.channel.readyState !== 'open') {
        throw new Error('The direct link closed during the transfer');
      }
      const start = index * ctx.chunkSize;
      const end = Math.min(start + ctx.chunkSize, ctx.bytes.byteLength);
      const header = buildPacketHeader(
        PacketType.FILE_CHUNK,
        ctx.session.sessionId,
        ctx.fileIdBigInt,
        index
      );
      await this.writeFrame(
        ctx.channel,
        ctx.session,
        header,
        ctx.bytes.subarray(start, end),
        ctx.sendFrame
      );
    });
    // The chain has to survive a failed frame, or one error would stall every
    // later frame of the transfer.
    ctx.writeChain = run.catch(() => {});
    return run;
  }

  /**
   * Streams the frames the peer still needs.
   *
   * Nothing here waits for the peer. `send` hands the frame to the SCTP layer
   * and the loop moves straight on, so throughput follows the link rather than
   * the round trip; the only thing allowed to hold the loop back is the send
   * buffer, which keeps a slow peer from being flooded.
   */
  private async pumpChunks(ctx: OutgoingTransfer): Promise<void> {
    const { totalChunks, bytes } = ctx;
    let lastReportAt = 0;
    const startedAt = Date.now();
    const movedBytes = Math.max(1, bytes.byteLength - ctx.startChunk * ctx.chunkSize);

    this.armWatchdog(ctx);

    for (let index = ctx.startChunk; index < totalChunks; index += 1) {
      if (this.isCancelled.has(ctx.fileId) || ctx.cancelled) {
        throw new Error('File transfer cancelled by user');
      }
      if (this.outgoing.get(ctx.fileId) !== ctx) {
        throw new Error('Transfer was replaced by a newer attempt');
      }
      if (ctx.channel.bufferedAmount > ctx.maxBufferedAmount) {
        await this.waitForDrain(ctx.channel, ctx.maxBufferedAmount);
      }

      await this.writeChunkFrame(ctx, index);

      // Progress is throttled by time and by whole percent: a repaint per frame
      // costs more than the frames themselves on a fast link.
      const nowMs = Date.now();
      const pct = Math.min(100, Math.floor(((index + 1) / totalChunks) * 100));
      if (pct !== ctx.progress.progressPercent && nowMs - lastReportAt >= FileTransferManager.PROGRESS_REPORT_MS) {
        lastReportAt = nowMs;
        // Never zero: a report can land inside the very first millisecond.
        const elapsedSec = Math.max(0.001, (nowMs - startedAt) / 1000);
        const sentBytes = Math.min(movedBytes, (index + 1 - ctx.startChunk) * ctx.chunkSize);
        const instantaneous = sentBytes / elapsedSec;
        ctx.smoothedSpeedBps = ctx.smoothedSpeedBps > 0
          ? ctx.smoothedSpeedBps * (1 - SPEED_SMOOTHING) + instantaneous * SPEED_SMOOTHING
          : instantaneous;
        ctx.progress.transferredChunks = index + 1;
        ctx.progress.speedBps = ctx.smoothedSpeedBps;
        ctx.progress.progressPercent = pct;
        ctx.events?.onProgress?.({ ...ctx.progress });
      }
    }

    // Keep the peer's progress in the vault, so a reload resumes the display
    // (and the transfer) where it stopped instead of at zero.
    //
    // The speed the file keeps is the honest one - every byte it moved, over the
    // whole transfer. Reading it from the last live sample recorded a zero when
    // a transfer finished inside a single reporting interval.
    const elapsedSec = Math.max(0.001, (Date.now() - startedAt) / 1000);
    ctx.smoothedSpeedBps = movedBytes / elapsedSec;
    ctx.progress.transferredChunks = totalChunks;
    ctx.progress.progressPercent = 100;
    ctx.progress.speedBps = ctx.smoothedSpeedBps;
    ctx.events?.onProgress?.({ ...ctx.progress });
    void this.persistOutgoing(ctx, ctx.size);
  }

  private async persistOutgoing(ctx: OutgoingTransfer, receivedBytes: number): Promise<void> {
    try {
      const row: TransferStateRecord = {
        transferId: `out:${ctx.fileId}`,
        direction: 'OUTBOUND',
        fileId: ctx.fileId,
        messageId: ctx.meta?.messageId,
        name: ctx.name,
        size: ctx.size,
        mimeType: ctx.mimeType,
        hashSHA256: ctx.hashSHA256,
        chunkSize: ctx.chunkSize,
        totalChunks: ctx.totalChunks,
        receivedBytes,
        updatedAt: Date.now(),
      };
      await db.transfers.put(row);
    } catch {
      /* best effort */
    }
  }

  /**
   * Nudges a transfer that has stopped moving.
   *
   * The data channel is ordered and reliable, so a stall is not a lost frame -
   * it is a peer that stopped consuming. Re-sending the frames right after the
   * last acknowledged one is therefore cheap (the receiver drops what it
   * already has) and it recovers both a half-dead link and a busy receiver
   * without restarting the whole file.
   */
  private armWatchdog(ctx: OutgoingTransfer): void {
    if (ctx.watchdog) clearInterval(ctx.watchdog);
    ctx.watchdog = setInterval(() => {
      if (ctx.cancelled || this.isCancelled.has(ctx.fileId)) return;
      if (ctx.highestAcked >= ctx.totalChunks - 1) return;
      if (Date.now() - ctx.lastAckAt < RESEND_QUIET_MS) return;
      if (ctx.channel.readyState !== 'open') {
        ctx.cancelled = true;
        ctx.events?.onError?.(ctx.fileId, 'The direct link closed during the transfer');
        return;
      }

      ctx.resendRounds += 1;
      ctx.lastAckAt = Date.now();
      if (ctx.resendRounds > MAX_RESEND_ROUNDS) {
        ctx.cancelled = true;
        ctx.events?.onError?.(ctx.fileId, 'The peer stopped acknowledging the transfer');
        return;
      }

      const from = Math.max(ctx.highestAcked + 1, ctx.startChunk);
      const to = Math.min(ctx.totalChunks, from + RESEND_BURST_FRAMES);
      for (let index = from; index < to; index += 1) {
        // Sent through the same ordered queue as the rest of the file, so a
        // repair can never arrive out of counter order either.
        this.writeChunkFrame(ctx, index).catch(() => {
          /* the next round, or the relay fallback, takes over */
        });
      }
    }, RESEND_QUIET_MS);
  }

  /** Waits until the peer has acknowledged every frame of the file. */
  private awaitFinalAck(ctx: OutgoingTransfer): Promise<void> {
    if (ctx.highestAcked >= ctx.totalChunks - 1) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const deadline = Date.now() + FINAL_ACK_TIMEOUT_MS;
      ctx.asyncCompletion = { resolve: () => resolve() };
      const tick = setInterval(() => {
        if (ctx.highestAcked >= ctx.totalChunks - 1) {
          clearInterval(tick);
          ctx.asyncCompletion = null;
          resolve();
          return;
        }
        if (Date.now() > deadline || this.isCancelled.has(ctx.fileId)) {
          clearInterval(tick);
          ctx.asyncCompletion = null;
          reject(new Error('The peer did not confirm the transfer'));
        }
      }, 250);
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Inbound packets                                                         */
  /* ---------------------------------------------------------------------- */

  /**
   * Receiver: handles one decrypted packet.
   */
  public handleIncomingPacket(
    packetType: PacketType,
    objectId: bigint,
    sequenceIndex: number,
    payload: Uint8Array,
    dataChannel: RTCDataChannel,
    session: CryptoSession,
    events?: FileTransferEvents,
    sendFrame?: SendFrameFn
  ): Promise<{ fileRecord?: FileRecord; blob?: Blob } | void> {
    const run = this.inboundQueue.then(() =>
      this.handleIncomingPacketLocked(
        packetType,
        objectId,
        sequenceIndex,
        payload,
        dataChannel,
        session,
        events,
        sendFrame
      )
    );
    // One malformed packet must never stall the frames behind it.
    this.inboundQueue = run.catch(() => undefined);
    return run;
  }

  private async handleIncomingPacketLocked(
    packetType: PacketType,
    objectId: bigint,
    sequenceIndex: number,
    payload: Uint8Array,
    dataChannel: RTCDataChannel,
    session: CryptoSession,
    events?: FileTransferEvents,
    sendFrame?: SendFrameFn
  ): Promise<{ fileRecord?: FileRecord; blob?: Blob } | void> {
    const fileIdHex = objectId.toString(16).padStart(16, '0').toUpperCase();

    switch (packetType) {
      case PacketType.FILE_HEADER:
        return this.onFileHeader(
          fileIdHex,
          objectId,
          payload,
          dataChannel,
          session,
          events,
          sendFrame
        );
      case PacketType.FILE_CHUNK:
        return this.onFileChunk(fileIdHex, sequenceIndex, payload, dataChannel, session, events, sendFrame);
      case PacketType.CHUNK_ACK:
        return this.onChunkAck(fileIdHex, payload);
      case PacketType.FILE_RESUME:
        return this.onFileResume(fileIdHex, payload);
      default:
        return;
    }
  }

  /** The sender of a file is answering our header: listen for its offset. */
  private onFileResume(fileIdHex: string, payload: Uint8Array): void {
    const ctx = this.outgoing.get(fileIdHex);
    if (!ctx) return;
    try {
      const resume = decodeFileResumePayload(payload);
      const requested = Math.floor(Math.max(0, resume.bytes) / ctx.chunkSize);
      ctx.startChunk = Math.max(0, Math.min(ctx.totalChunks, requested));
      if (ctx.startChunk > 0) {
        const pct = Math.floor((ctx.startChunk / ctx.totalChunks) * 100);
        ctx.progress.progressPercent = pct;
        ctx.progress.transferredChunks = ctx.startChunk;
        ctx.events?.onProgress?.({ ...ctx.progress });
      }
    } catch (err) {
      console.warn('Could not read the resume point:', err);
    }
    ctx.resolvedResume = true;
    this.resumeWaiters.get(fileIdHex)?.();
  }

  /** A file is being announced: show its shape and say what we already hold. */
  private async onFileHeader(
    fileIdHex: string,
    objectId: bigint,
    payload: Uint8Array,
    dataChannel: RTCDataChannel,
    session: CryptoSession,
    events?: FileTransferEvents,
    sendFrame?: SendFrameFn
  ): Promise<void> {
    const header = decodeFileHeaderPayload(payload);
    const meta: FileCompletionMeta = {
      messageId: header.messageId,
      senderDeviceId: header.senderDeviceId,
      senderDisplayName: header.senderDisplayName,
      previewUrl: header.previewUrl,
      width: header.width,
      height: header.height,
      durationMs: header.durationMs,
    };

    // What do we still have from an earlier attempt? This is the whole reason a
    // transfer survives a reload, a closed tab or a network that went away.
    let storedBytes = 0;
    let prefix: Blob | undefined;
    try {
      const previous = await db.transfers.get(fileIdHex);
      if (previous && previous.direction === 'INBOUND' && previous.blobRef) {
        prefix = previous.blobRef;
        storedBytes = Math.max(0, Math.min(previous.blobRef.size, header.size));
      }
    } catch {
      /* starting from the top is always correct */
    }

    // Our stored prefix is aligned to the *sender's* frame grid, so a transfer
    // resumed over a link with a different frame size still lines up exactly.
    const alignedStored = Math.min(
      header.size,
      Math.floor(storedBytes / header.chunkSize) * header.chunkSize
    );
    const firstNeededChunk = Math.floor(alignedStored / header.chunkSize);

    const incoming: IncomingFile = {
      header,
      fileIdBigInt: objectId,
      storedBytes: alignedStored,
      firstNeededChunk,
      chunks: new Map(),
      heldBytes: alignedStored,
      startTime: Date.now(),
      lastAckAt: Date.now(),
      lastAckedChunk: firstNeededChunk - 1,
      lastReportAt: 0,
      lastReportedPercent: -1,
      speedBps: 0,
      unpersistedBytes: 0,
      persistInFlight: false,
      persistPending: false,
      channel: dataChannel,
      session,
      sendFrame,
      events,
      ackTimer: null,
    };
    this.incomingFiles.set(header.fileId, incoming);

    const progress: FileTransferProgress = {
      fileId: header.fileId,
      name: header.name,
      size: header.size,
      mimeType: header.mimeType,
      hashSHA256: header.hashSHA256,
      direction: 'INBOUND',
      totalChunks: header.totalChunks,
      transferredChunks: firstNeededChunk,
      progressPercent: Math.round((alignedStored / Math.max(header.size, 1)) * 100),
      status: 'transferring',
    };
    this.activeTransfers.set(header.fileId, progress);
    events?.onProgress?.({ ...progress });

    // Announce the shape straight away: the conversation shows the file (name,
    // size, kind, real pixel size, thumbnail) as a card that cannot be opened
    // until its bytes are complete.
    if (alignedStored < header.size) {
      await this.announceSink?.(
        {
          fileId: header.fileId,
          name: header.name,
          size: header.size,
          mimeType: header.mimeType,
          hashSHA256: header.hashSHA256,
          totalChunks: header.totalChunks,
          chunkSize: header.chunkSize,
          width: header.width,
          height: header.height,
          durationMs: header.durationMs,
        },
        meta
      );
    }

    // Tell the sender where to start. Sending it costs one frame and saves the
    // whole file in the case that matters most.
    try {
      await this.writeFrame(
        dataChannel,
        session,
        buildPacketHeader(
          PacketType.FILE_RESUME,
          session.sessionId,
          objectId,
          0
        ),
        encodeFileResumePayload({ bytes: alignedStored, chunkSize: header.chunkSize }),
        sendFrame
      );
    } catch (err) {
      console.warn('Could not answer the file header with a resume point:', err);
    }

    // A file we already hold in full (re-announced by a sender that lost its
    // receipt) verifies and stores again, silently.
    if (alignedStored >= header.size && header.size > 0) {
      await this.finishIncoming(header.fileId, prefix);
    }
  }

  private async onFileChunk(
    fileIdHex: string,
    sequenceIndex: number,
    payload: Uint8Array,
    dataChannel: RTCDataChannel,
    session: CryptoSession,
    events?: FileTransferEvents,
    sendFrame?: SendFrameFn
  ): Promise<{ fileRecord?: FileRecord; blob?: Blob } | void> {
    const incoming = this.incomingFiles.get(fileIdHex);
    if (!incoming) {
      // No header for these bytes. It is one frame of a file whose header we
      // never saw (an old sender, or a header lost to a closed tab): the sender
      // is told to start over rather than left waiting forever.
      console.warn(`Chunk ${sequenceIndex} for an unknown file ${fileIdHex}`);
      return;
    }

    // A frame the sender re-sent, or one that belongs to the prefix we already
    // stored: never counted twice, but always acknowledged so the sender's
    // watchdog can rest.
    const isDuplicate = sequenceIndex < incoming.firstNeededChunk || incoming.chunks.has(sequenceIndex);
    if (!isDuplicate) {
      incoming.chunks.set(sequenceIndex, payload);
      incoming.unpersistedBytes += payload.byteLength;
    }

    const contiguous = Math.max(sequenceIndex, highestContiguous(incoming.chunks, incoming.firstNeededChunk));
    incoming.heldBytes = incoming.storedBytes;
    for (let index = incoming.firstNeededChunk; index <= contiguous; index += 1) {
      incoming.heldBytes += incoming.chunks.get(index)?.byteLength || 0;
    }

    const isComplete = incoming.heldBytes >= incoming.header.size;
    const shouldAck =
      isDuplicate ||
      isComplete ||
      contiguous - incoming.lastAckedChunk >= FileTransferManager.ACK_EVERY_CHUNKS ||
      Date.now() - incoming.lastAckAt >= ACK_MAX_DELAY_MS;

    if (shouldAck) {
      incoming.lastAckAt = Date.now();
      incoming.lastAckedChunk = Math.max(incoming.lastAckedChunk, contiguous);
      try {
        const ackPayload: ChunkAckPayload = { chunkIndex: contiguous, status: AckStatus.OK_ACK };
        await this.writeFrame(
          dataChannel,
          session,
          buildPacketHeader(PacketType.CHUNK_ACK, session.sessionId, incoming.fileIdBigInt, contiguous),
          encodeChunkAckPayload(ackPayload),
          sendFrame
        );
      } catch (err) {
        console.error('Failed to send CHUNK_ACK:', err);
      }
    } else if (!incoming.ackTimer) {
      // A slow link must never look stalled to the sender's watchdog.
      incoming.ackTimer = setTimeout(() => {
        incoming.ackTimer = null;
        const highest = highestContiguous(incoming.chunks, incoming.firstNeededChunk);
        if (highest <= incoming.lastAckedChunk) return;
        incoming.lastAckedChunk = highest;
        incoming.lastAckAt = Date.now();
        this.writeFrame(
          incoming.channel,
          incoming.session,
          buildPacketHeader(
            PacketType.CHUNK_ACK,
            incoming.session.sessionId,
            incoming.fileIdBigInt,
            highest
          ),
          encodeChunkAckPayload({ chunkIndex: highest, status: AckStatus.OK_ACK }),
          incoming.sendFrame
        ).catch(() => {});
      }, ACK_MAX_DELAY_MS);
    }

    // Progress, throttled: every report repaints the conversation.
    const progress = this.activeTransfers.get(fileIdHex);
    if (progress) {
      const pct = Math.min(100, Math.floor((incoming.heldBytes / Math.max(incoming.header.size, 1)) * 100));
      const elapsed = (Date.now() - incoming.startTime) / 1000;
      const movedBytes = Math.max(0, incoming.heldBytes - incoming.storedBytes);
      const instantaneous = elapsed > 0 ? movedBytes / elapsed : 0;
      incoming.speedBps = incoming.speedBps > 0
        ? incoming.speedBps * (1 - SPEED_SMOOTHING) + instantaneous * SPEED_SMOOTHING
        : instantaneous;
      progress.transferredChunks = contiguous + 1;
      progress.progressPercent = pct;
      progress.speedBps = incoming.speedBps;
      const nowMs = Date.now();
      if (
        isComplete ||
        (pct !== incoming.lastReportedPercent &&
          nowMs - incoming.lastReportAt >= FileTransferManager.PROGRESS_REPORT_MS)
      ) {
        incoming.lastReportAt = nowMs;
        incoming.lastReportedPercent = pct;
        events?.onProgress?.({ ...progress });
      }
    }

    // Write what we hold to the vault every so often: an interrupted transfer
    // resumes from here, and a browser that dies mid-file loses only the last
    // few frames.
    if (
      incoming.unpersistedBytes >= PERSIST_EVERY_BYTES ||
      incoming.chunks.size % PERSIST_EVERY_FRAMES === 0
    ) {
      void this.persistIncoming(incoming);
    }

    if (isComplete) {
      const result = await this.finishIncoming(fileIdHex, undefined);
      return result;
    }
  }

  /**
   * Stores the contiguous prefix of a partially received file.
   *
   * The blob is rebuilt from whole frames, so what is on disk is always a run
   * of the file from byte zero - exactly what the sender can continue from.
   */
  private async persistIncoming(incoming: IncomingFile): Promise<void> {
    if (incoming.persistInFlight) {
      incoming.persistPending = true;
      return;
    }
    incoming.persistInFlight = true;
    try {
      const contiguous = highestContiguous(incoming.chunks, incoming.firstNeededChunk);
      const parts: BlobPart[] = [];
      let bytes = incoming.storedBytes;
      for (let index = incoming.firstNeededChunk; index <= contiguous; index += 1) {
        const chunk = incoming.chunks.get(index);
        if (!chunk) break;
        parts.push(chunk);
        bytes += chunk.byteLength;
      }
      if (parts.length === 0) return;

      // What was stored before this session lives in front of the new frames.
      const prefixParts: BlobPart[] = [];
      if (incoming.storedBytes > 0) {
        try {
          const previous = await db.transfers.get(incoming.header.fileId);
          if (previous?.blobRef) prefixParts.push(previous.blobRef.slice(0, incoming.storedBytes));
        } catch {
          /* the frames we hold now are enough to continue */
        }
      }

      const blob = new Blob([...prefixParts, ...parts], { type: incoming.header.mimeType });
      const row: TransferStateRecord = {
        transferId: incoming.header.fileId,
        direction: 'INBOUND',
        fileId: incoming.header.fileId,
        messageId: incoming.header.messageId,
        name: incoming.header.name,
        size: incoming.header.size,
        mimeType: incoming.header.mimeType,
        hashSHA256: incoming.header.hashSHA256,
        chunkSize: incoming.header.chunkSize,
        totalChunks: incoming.header.totalChunks,
        receivedBytes: bytes,
        blobRef: blob,
        meta: {
          senderDeviceId: incoming.header.senderDeviceId,
          senderDisplayName: incoming.header.senderDisplayName,
          previewUrl: incoming.header.previewUrl,
          width: incoming.header.width,
          height: incoming.header.height,
        },
        width: incoming.header.width,
        height: incoming.header.height,
        updatedAt: Date.now(),
      };
      await db.transfers.put(row);
      incoming.unpersistedBytes = 0;
    } catch (err) {
      console.warn('Could not store the partial attachment:', err);
    } finally {
      incoming.persistInFlight = false;
      if (incoming.persistPending) {
        incoming.persistPending = false;
        void this.persistIncoming(incoming);
      }
    }
  }

  /** Reassembles, verifies, stores and announces a complete file. */
  private async finishIncoming(
    fileIdHex: string,
    prefixFromVault: Blob | undefined
  ): Promise<{ fileRecord: FileRecord; blob: Blob } | void> {
    const incoming = this.incomingFiles.get(fileIdHex);
    if (!incoming) return;
    const { header } = incoming;
    const progress = this.activeTransfers.get(fileIdHex);

    try {
      if (progress) {
        progress.status = 'verifying';
        incoming.events?.onProgress?.({ ...progress });
      }

      // A prefix that came from the vault is read once, here.
      let prefixBytes: Uint8Array | undefined;
      let prefixBlob = prefixFromVault;
      if (!prefixBlob && incoming.storedBytes > 0) {
        try {
          const previous = await db.transfers.get(fileIdHex);
          if (previous?.blobRef) prefixBlob = previous.blobRef;
        } catch {
          /* fall through to the frames we hold */
        }
      }
      if (prefixBlob) {
        prefixBytes = new Uint8Array(await prefixBlob.slice(0, incoming.storedBytes).arrayBuffer());
      }

      // Frames are placed at their absolute offset, so the grid they arrive in
      // never has to match the grid a previous attempt used.
      const fullBytes = new Uint8Array(header.size);
      if (prefixBytes) {
        fullBytes.set(prefixBytes.subarray(0, Math.min(prefixBytes.byteLength, header.size)), 0);
      }
      let missing = 0;
      for (let index = incoming.firstNeededChunk; index < header.totalChunks; index += 1) {
        const chunk = incoming.chunks.get(index);
        if (!chunk) {
          missing += 1;
          continue;
        }
        const offset = index * header.chunkSize;
        fullBytes.set(chunk, Math.min(offset, Math.max(0, header.size - chunk.byteLength)));
      }
      if (missing > 0 || incoming.heldBytes < header.size) {
        throw new Error(`${missing} frame(s) of “${header.name}” are still missing`);
      }

      const digest = arrayBufferToHex(await sha256(fullBytes));
      if (header.hashSHA256 && digest !== header.hashSHA256) {
        // A corrupt reassembly is never stored: the sender is asked again next
        // time it announces this file.
        await db.transfers.delete(fileIdHex).catch(() => {});
        throw new Error('The file failed its integrity check');
      }

      const mime = header.mimeType || 'application/octet-stream';
      const blob = new Blob([fullBytes], { type: mime });
      const isImage = mime.startsWith('image/');
      const isAudio = mime.startsWith('audio/');
      const isVideo = mime.startsWith('video/');

      let exifData = undefined;
      let width = header.width;
      let height = header.height;
      if (isImage) {
        if (!width || !height) {
          const measured = await measureImageDimensions(blob).catch(() => undefined);
          width = measured?.width ?? width;
          height = measured?.height ?? height;
        }
        try {
          exifData = await extractImageExif(blob);
        } catch (err) {
          console.warn('Receiver EXIF extraction error:', err);
        }
      }

      if (progress) {
        progress.status = 'completed';
        progress.progressPercent = 100;
        progress.speedBps = incoming.speedBps;
        if (typeof URL !== 'undefined' && URL.createObjectURL) {
          progress.blobUrl = URL.createObjectURL(blob);
        }
        incoming.events?.onProgress?.({ ...progress });
      }

      const fileRecord: FileRecord = {
        fileId: fileIdHex,
        name: header.name,
        size: header.size,
        mimeType: mime,
        hashSHA256: digest,
        blobRef: blob,
        isImage,
        isAudio,
        isVideo,
        exifData,
        width,
        height,
        transferSpeedBps: incoming.speedBps,
      };
      await db.files.put(fileRecord);
      await db.transfers.delete(fileIdHex).catch(() => {});

      const meta: FileCompletionMeta = {
        messageId: header.messageId,
        senderDeviceId: header.senderDeviceId,
        senderDisplayName: header.senderDisplayName,
        previewUrl: header.previewUrl,
        width,
        height,
        durationMs: header.durationMs,
      };
      // Stored first, so the conversation holds the complete attachment before
      // anything else reacts to it.
      await this.completionSink?.(fileRecord, blob, meta);
      incoming.events?.onCompleted?.(fileRecord, blob, meta);
      return { fileRecord, blob };
    } catch (err: any) {
      if (progress) progress.status = 'error';
      incoming.events?.onError?.(fileIdHex, err?.message || 'Could not reassemble the file');
      console.error('File reassembly error:', err);
      return;
    } finally {
      this.cleanupTransferState(fileIdHex);
      this.activeTransfers.delete(fileIdHex);
    }
  }

  private onChunkAck(fileIdHex: string, payload: Uint8Array): void {
    const ctx = this.outgoing.get(fileIdHex);
    if (!ctx) return;
    let ack: ChunkAckPayload;
    try {
      ack = decodeChunkAckPayload(payload);
    } catch {
      return;
    }

    ctx.lastAckAt = Date.now();
    ctx.resendRounds = 0;
    if (ack.chunkIndex > ctx.highestAcked) ctx.highestAcked = ack.chunkIndex;

    // An explicit request for a frame (a gap the receiver noticed) is answered
    // at once; a cumulative ACK needs no answer at all, which is what keeps a
    // fast link free of pointless retransmissions.
    if (ack.status === AckStatus.NACK_RETRANSMIT_REQ) {
      if (ack.chunkIndex * ctx.chunkSize < ctx.bytes.byteLength) {
        this.writeChunkFrame(ctx, ack.chunkIndex).catch(() => {});
      }
    }

    if (ctx.highestAcked >= ctx.totalChunks - 1) {
      ctx.progress.progressPercent = 100;
      ctx.asyncCompletion?.resolve();
    }
  }
}

export const fileTransferManager = new FileTransferManager();
