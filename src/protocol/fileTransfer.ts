import { db } from '../db/index';
import {
  AckStatus,
  FileRecord,
  FileTransferProgress,
  PacketType,
} from '../types/index';
import {
  arrayBufferToHex,
  sha256,
} from '../crypto/utils';
import {
  buildPacketHeader,
  ChunkAckPayload,
  decodeChunkAckPayload,
  decodeFileHeaderPayload,
  encodeChunkAckPayload,
  encodeFileHeaderPayload,
  FileHeaderPayload,
} from './packet';
import { CryptoSession } from '../crypto/session';
import { extractImageExif } from '../utils/exifParser';

export const CHUNK_SIZE = 512 * 1024; // Default 512 KB frames: fewer encrypt/ACK round trips
/** Biggest frame we will build, even on a very fast link. */
export const MAX_CHUNK_SIZE = 2 * 1024 * 1024;
/** Smallest frame, so a slow link still gets pipelined packets. */
export const MIN_CHUNK_SIZE = 32 * 1024;
const MAX_BUFFERED_AMOUNT = 16 * 1024 * 1024; // In-flight window for the internet path
const LAN_BUFFERED_AMOUNT = 48 * 1024 * 1024; // Deeper window when host-to-host
const CHUNK_TIMEOUT_MS = 10000; // Resend chunk if ACK not received within 10s
const ACK_WAIT_TIMEOUT_MS = 15000; // Total wait for final ACK before declaring complete
const MAX_CHUNK_RETRIES = 6; // Maximum retransmission attempts per chunk
const BACKOFF_BASE_MS = 500; // Exponential backoff base for chunk resend
/** How much of the previous reading survives each new speed sample. */
const SPEED_SMOOTHING = 0.35;

/**
 * Largest frame we will ever build, whatever the channel claims.
 *
 * Browsers disagree wildly about `maxMessageSize`: Chrome reports ~256 KB,
 * Firefox roughly a gigabyte, and some builds report 0. A frame the SCTP layer
 * refuses makes `send()` throw and kills the whole transfer, so every frame is
 * capped at the size all implementations actually accept.
 */
export const SAFE_FRAME_CEILING = 256 * 1024 - 4096;

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

interface PendingChunk {
  retryCount: number;
  timer: ReturnType<typeof setTimeout> | null;
}

/**
 * Highest chunk index with no gap below it.
 *
 * The data channel is ordered and reliable, so this is normally simply the last
 * chunk received - but computing it honestly means a missing frame can never be
 * acknowledged away by a later one.
 */
function highestContiguousChunk(chunks: Map<number, Uint8Array>): number {
  let index = -1;
  while (chunks.has(index + 1)) index += 1;
  return index;
}

export class FileTransferManager {
  /** Chunks between two acknowledgements on the receiving side. */
  private static readonly ACK_EVERY_CHUNKS = 16;
  /**
   * Never let the sender wait longer than this for a sign of life, whatever the
   * batch size: it is well under the sender's own chunk resend timeout.
   */
  private static readonly ACK_MAX_DELAY_MS = 2000;
  /**
   * Shortest gap between two progress reports. A transfer is not a stopwatch:
   * repainting the chat hundreds of times a second is work taken away from
   * moving the bytes, and on a phone it is felt as a slow transfer.
   */
  private static readonly PROGRESS_REPORT_MS = 140;

  private activeTransfers: Map<string, FileTransferProgress> = new Map();
  private incomingFiles: Map<
    string,
    {
      header: FileHeaderPayload;
      chunks: Map<number, Uint8Array>;
      receivedBytes: number;
      startTime: number;
      /** When this side last told the sender it holds chunks. */
      lastAckAt: number;
      /** Throttles progress repaints; see `PROGRESS_REPORT_MS`. */
      lastReportAt: number;
      lastReportedPercent: number;
      /** Smoothed throughput, so the reported MB/s does not jump around. */
      lastSpeedBps: number;
    }
  > = new Map();
  private outgoingAckResolvers: Map<string, Map<number, () => void>> = new Map();
  private receivedAcks: Map<string, Set<number>> = new Map();
  private isCancelled = new Set<string>();
  private pendingChunks: Map<string, Map<number, PendingChunk>> = new Map();
  /**
   * Inbound packets are handled one at a time. Chunk bookkeeping is stateful
   * (a Map, a byte count and a completion check), and two chunks finishing at
   * once used to be able to reassemble the same file twice.
   */
  private inboundQueue: Promise<unknown> = Promise.resolve();
  private transferContext: Map<
    string,
    {
      dataChannel: RTCDataChannel;
      session: CryptoSession;
      fileIdBigInt: bigint;
      fileBytes: Uint8Array;
      events?: FileTransferEvents;
      chunkSize: number;
      maxBufferedAmount: number;
      sendFrame?: SendFrameFn;
    }
  > = new Map();

  /**
   * The peer manager tells us when the current link is host-to-host. It only
   * affects tuning (frame size, in-flight window) — never the wire format — so
   * a stale hint can never break a transfer.
   */
  private lanHint = false;

  /** Registered once by the peer manager; see `AttachmentCompletionSink`. */
  private completionSink: AttachmentCompletionSink | null = null;

  public setAttachmentCompletionSink(sink: AttachmentCompletionSink | null): void {
    this.completionSink = sink;
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

  public cancelTransfer(fileId: string): void {
    this.isCancelled.add(fileId);
    this.cleanupTransferState(fileId);
    const transfer = this.activeTransfers.get(fileId);
    if (transfer) {
      transfer.status = 'error';
    }
  }

  private cleanupTransferState(fileId: string): void {
    // Cancel all pending chunk resend timers
    const pending = this.pendingChunks.get(fileId);

    if (pending) {
      for (const chunk of pending.values()) {
        if (chunk.timer) {
          clearTimeout(chunk.timer);
        }
      }
      this.pendingChunks.delete(fileId);
    }
    // Clean up ACK tracking maps
    this.outgoingAckResolvers.delete(fileId);
    this.receivedAcks.delete(fileId);
    this.transferContext.delete(fileId);
    // Free incoming chunk buffers
    this.incomingFiles.delete(fileId);
  }

  /**
   * Resolves as soon as the SCTP send buffer drains below its low watermark.
   * Uses the native `bufferedamountlow` signal so the send loop resumes on the
   * very next packet instead of after a polling tick.
   */
  private waitForDrain(dataChannel: RTCDataChannel, maxBufferedAmount = MAX_BUFFERED_AMOUNT): Promise<void> {
    return new Promise<void>((resolve) => {
      let settled = false;
      let poll: ReturnType<typeof setInterval> | undefined;
      const done = () => {
        if (settled) return;
        settled = true;
        if (poll) clearInterval(poll);
        dataChannel.removeEventListener('bufferedamountlow', done);
        resolve();
      };
      const lowWaterMark = Math.min(4 * 1024 * 1024, Math.floor(maxBufferedAmount / 2));
      dataChannel.bufferedAmountLowThreshold = lowWaterMark;
      dataChannel.addEventListener('bufferedamountlow', done);
      // Short poll as a safety net for engines that never fire the event.
      poll = setInterval(() => {
        if (dataChannel.readyState !== 'open' || dataChannel.bufferedAmount <= lowWaterMark) done();
      }, 8);
    });
  }

  /**
   * Encrypts and writes one frame, in order.
   *
   * The live link's send queue is used when the peer manager supplied one, so
   * every frame is handed to the channel in the same order its nonce counter
   * was allocated. A frame larger than the channel accepts is retried once with
   * a smaller payload rather than losing the whole transfer.
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

  /** Reads one chunk back out of the retained file bytes (never duplicated). */
  private sliceChunk(fileId: string, chunkIdx: number): Uint8Array | null {
    const ctx = this.transferContext.get(fileId);
    if (!ctx) return null;
    const start = chunkIdx * ctx.chunkSize;
    if (start >= ctx.fileBytes.byteLength) return null;
    const end = Math.min(start + ctx.chunkSize, ctx.fileBytes.byteLength);
    return ctx.fileBytes.slice(start, end);
  }

  private async sendChunkWithRetry(
    fileId: string,
    fileIdBigInt: bigint,
    chunkIdx: number,
    chunkBytes: Uint8Array,
    dataChannel: RTCDataChannel,
    session: CryptoSession
  ): Promise<void> {
    const chunkPacketHeader = buildPacketHeader(
      PacketType.FILE_CHUNK,
      session.sessionId,
      fileIdBigInt,
      chunkIdx
    );

    // Backpressure first: encrypting while the socket buffer is full would just
    // hold finished frames in memory.
    const ctxForWindow = this.transferContext.get(fileId);
    const windowLimit = ctxForWindow?.maxBufferedAmount ?? MAX_BUFFERED_AMOUNT;
    if (dataChannel.bufferedAmount > windowLimit) {
      await this.waitForDrain(dataChannel, windowLimit);
    }

    await this.writeFrame(
      dataChannel,
      session,
      chunkPacketHeader,
      chunkBytes,
      ctxForWindow?.sendFrame
    );

    // ACK timeout with retry. The chunk bytes are recovered from the retained
    // file buffer instead of being held per chunk, so a large file cannot leak
    // hundreds of megabytes while waiting for acknowledgements.
    const pending = this.pendingChunks.get(fileId);
    if (!pending) return;

    const timer = setTimeout(() => {
      const chunk = pending.get(chunkIdx);
      if (!chunk) return;

      if (chunk.retryCount >= MAX_CHUNK_RETRIES) {
        const transfer = this.activeTransfers.get(fileId);
        if (transfer) transfer.status = 'error';
        this.transferContext
          .get(fileId)
          ?.events?.onError?.(fileId, `Chunk ${chunkIdx} failed after ${MAX_CHUNK_RETRIES} retries`);
        pending.delete(chunkIdx);
        return;
      }

      chunk.retryCount += 1;
      const attempt = chunk.retryCount;
      const backoff = BACKOFF_BASE_MS * Math.pow(2, attempt - 1);

      setTimeout(() => {
        if (this.isCancelled.has(fileId)) return;
        const bytes = this.sliceChunk(fileId, chunkIdx);
        if (!bytes) return;
        this.sendChunkWithRetry(fileId, fileIdBigInt, chunkIdx, bytes, dataChannel, session)
          .catch((err) => {
            console.warn(`Chunk ${chunkIdx} resend error:`, err);
          });
      }, backoff);
    }, CHUNK_TIMEOUT_MS);

    pending.set(chunkIdx, {
      retryCount: pending.get(chunkIdx)?.retryCount || 0,
      timer,
    });
  }

  /**
   * Sender: Sends a file chunked with 128KB blocks and backpressure management.
   * Implements chunk acknowledgment with retransmission on NACK or timeout.
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

    // Frame size and in-flight window are chosen per link, not globally.
    const isLan = options?.isLan ?? this.lanHint;
    const chunkSize = pickChunkSize(dataChannel, { ...options, isLan });
    const maxBufferedAmount = isLan
      ? LAN_BUFFERED_AMOUNT
      : Math.max(MAX_BUFFERED_AMOUNT, chunkSize * 12);

    // Generate 64-bit Hex FileID (16 hex chars)
    const fileIdBigInt = BigInt(
      '0x' +
        Array.from(hashBytes.slice(0, 8))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('')
    );
    const fileId = fileIdBigInt.toString(16).padStart(16, '0').toUpperCase();

    const totalChunks = Math.ceil(fileBytes.byteLength / chunkSize);
    const mime = file.type || 'application/octet-stream';
    const isImage = mime.startsWith('image/');
    const isAudio = mime.startsWith('audio/');
    const isVideo = mime.startsWith('video/');

    let exifData = undefined;
    if (isImage) {
      try {
        exifData = await extractImageExif(file);
      } catch (err) {
        console.warn('Exif error:', err);
      }
    }

    const fileHeader: FileHeaderPayload = {
      fileId,
      name: file.name,
      size: file.size,
      mimeType: mime,
      hashSHA256: hashHex,
      totalChunks,
      chunkSize,
      ...(options?.meta || {}),
    };

    const progress: FileTransferProgress = {
      fileId,
      name: file.name,
      size: file.size,
      mimeType: mime,
      hashSHA256: hashHex,
      direction: 'OUTBOUND',
      totalChunks,
      transferredChunks: 0,
      progressPercent: 0,
      status: 'transferring',
      blobUrl: URL.createObjectURL(file),
    };

    this.activeTransfers.set(fileId, progress);
    // Re-sending the same file (a retry after a dropped link, or the relay
    // fallback) must never inherit the cancelled flag of the earlier attempt.
    this.isCancelled.delete(fileId);
    this.outgoingAckResolvers.set(fileId, new Map());
    this.receivedAcks.set(fileId, new Set());
    this.pendingChunks.set(fileId, new Map());
    this.transferContext.set(fileId, {
      dataChannel,
      session,
      fileIdBigInt,
      fileBytes,
      events,
      chunkSize,
      maxBufferedAmount,
      sendFrame: options?.sendFrame,
    });
    events?.onProgress?.({ ...progress });

    try {
      // 1. Send FILE_HEADER packet (0x20)
      const encodedHeaderPayload = encodeFileHeaderPayload(fileHeader);
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
        encodedHeaderPayload,
        options?.sendFrame
      );

      const startTime = Date.now();
      let lastReportAt = startTime;
      let smoothedSpeed = 0;

      // 2. Stream CHUNKS with backpressure and ACK tracking
      for (let chunkIdx = 0; chunkIdx < totalChunks; chunkIdx++) {
        if (this.isCancelled.has(fileId)) {
          throw new Error('File transfer cancelled by user');
        }

        const start = chunkIdx * chunkSize;
        const end = Math.min(start + chunkSize, fileBytes.byteLength);
        const chunkBytes = fileBytes.slice(start, end);

        await this.sendChunkWithRetry(
          fileId, fileIdBigInt, chunkIdx, chunkBytes, dataChannel, session
        );

        // Update progress from the real byte count (frames may vary in size).
        const transferred = chunkIdx + 1;
        const pct = Math.round((transferred / totalChunks) * 100);
        const elapsedSec = (Date.now() - startTime) / 1000;
        const sentBytes = Math.min(end, fileBytes.byteLength);
        const instantaneous = elapsedSec > 0 ? sentBytes / elapsedSec : 0;
        // Smoothing keeps the read-out readable instead of flickering between
        // "3.1 MB/s" and "9.8 MB/s" on every frame.
        smoothedSpeed = smoothedSpeed > 0
          ? smoothedSpeed * (1 - SPEED_SMOOTHING) + instantaneous * SPEED_SMOOTHING
          : instantaneous;
        const speed = smoothedSpeed;

        const lastPct = progress.progressPercent;
        progress.transferredChunks = transferred;
        progress.progressPercent = pct;
        progress.speedBps = speed;

        // Adaptive window: when the link clearly keeps up, let more data sit in
        // flight. The window only gates us, so growing it is always safe — and
        // it is what actually unlocks LAN speed (less waiting per ACK).
        const ctx = this.transferContext.get(fileId);
        if (ctx && speed > 8 * 1024 * 1024 && ctx.maxBufferedAmount < LAN_BUFFERED_AMOUNT) {
          ctx.maxBufferedAmount = Math.min(LAN_BUFFERED_AMOUNT, ctx.maxBufferedAmount * 2);
        }

        // Repainting the chat on every frame would cost more than the transfer
        // itself, so reports are throttled by time, by whole percent, and by
        // every 32 frames - with the final frame always reported.
        const nowMs = Date.now();
        if (
          transferred === totalChunks ||
          (nowMs - lastReportAt >= FileTransferManager.PROGRESS_REPORT_MS &&
            (pct !== lastPct || chunkIdx % 32 === 0))
        ) {
          lastReportAt = nowMs;
          events?.onProgress?.({ ...progress });
        }
      }

      // Wait for final chunk ACK with configurable timeout
      const lastChunkIdx = totalChunks - 1;
      const isAlreadyAcked = this.receivedAcks.get(fileId)?.has(lastChunkIdx);

      if (!isAlreadyAcked) {
        await new Promise<void>((resolve) => {
          const resolvers = this.outgoingAckResolvers.get(fileId);
          if (resolvers) {
            resolvers.set(lastChunkIdx, resolve);
          }
          setTimeout(() => resolve(), ACK_WAIT_TIMEOUT_MS);
        });
      }

      progress.status = 'completed';
      progress.progressPercent = 100;
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
        transferSpeedBps: smoothedSpeed,
      };

      await db.files.put(fileRecord);
      events?.onCompleted?.(fileRecord, file);

      return fileRecord;
    } catch (err: any) {
      const transfer = this.activeTransfers.get(fileId);
      if (transfer) {
        transfer.status = 'error';
        events?.onProgress?.({ ...transfer });
      }
      events?.onError?.(fileId, err.message);
      throw err;
    } finally {
      this.cleanupTransferState(fileId);
    }
  }

  /**
   * Receiver: Handles incoming decrypted packet.
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

    // A. 0x20: FILE_HEADER
    if (packetType === PacketType.FILE_HEADER) {
      const header = decodeFileHeaderPayload(payload);
      this.incomingFiles.set(header.fileId, {
        header,
        chunks: new Map(),
        receivedBytes: 0,
        startTime: Date.now(),
        lastAckAt: Date.now(),
        lastReportAt: 0,
        lastReportedPercent: -1,
        lastSpeedBps: 0,
      });

      const progress: FileTransferProgress = {
        fileId: header.fileId,
        name: header.name,
        size: header.size,
        mimeType: header.mimeType,
        hashSHA256: header.hashSHA256,
        direction: 'INBOUND',
        totalChunks: header.totalChunks,
        transferredChunks: 0,
        progressPercent: 0,
        status: 'transferring',
      };

      this.activeTransfers.set(header.fileId, progress);
      events?.onProgress?.({ ...progress });
      return;
    }

    // B. 0x21: FILE_CHUNK
    if (packetType === PacketType.FILE_CHUNK) {
      const incoming = this.incomingFiles.get(fileIdHex);
      if (!incoming) {
        console.warn(`Received chunk for unknown file: ${fileIdHex}`);
        return;
      }

      // Track if this is a duplicate chunk
      const isDuplicate = incoming.chunks.has(sequenceIndex);
      if (!isDuplicate) {
        incoming.chunks.set(sequenceIndex, payload);
        incoming.receivedBytes += payload.byteLength;
      }

      // Acknowledge in batches. One small encrypted ACK per frame is a lot of
      // traffic on top of the file - on a link whose frames are 64 KB it is one
      // ACK for every 64 KB - and every one of them competes with the chunks
      // themselves for the channel. A chunk is acknowledged when the batch is
      // full, when the last chunk of the file arrives (the sender is waiting for
      // exactly that one), or after a short delay so a slow link never looks
      // stalled to the sender's resend timer. A duplicate is always answered
      // immediately, which is what heals a lost ACK.
      // The index carried is the highest one this side holds (the channel is
      // ordered, so that is the highest contiguous chunk), which is what makes
      // the cumulative ACK on the sender's side correct.
      const highestHeld = Math.max(sequenceIndex, highestContiguousChunk(incoming.chunks));
      const isComplete = incoming.chunks.size >= incoming.header.totalChunks;
      const shouldAck =
        isDuplicate ||
        isComplete ||
        highestHeld % FileTransferManager.ACK_EVERY_CHUNKS === 0 ||
        Date.now() - incoming.lastAckAt >= FileTransferManager.ACK_MAX_DELAY_MS;
      if (shouldAck) {
        incoming.lastAckAt = Date.now();
        try {
          const ackPayload: ChunkAckPayload = {
            chunkIndex: highestHeld,
            status: AckStatus.OK_ACK,
          };
          const encodedAck = encodeChunkAckPayload(ackPayload);
          const ackHeader = buildPacketHeader(
            PacketType.CHUNK_ACK,
            session.sessionId,
            objectId,
            highestHeld
          );
          await this.writeFrame(dataChannel, session, ackHeader, encodedAck, sendFrame);
        } catch (err) {
          console.error('Failed to send CHUNK_ACK:', err);
        }
      }

      // Update progress, but do not repaint per chunk. Every report re-renders
      // the conversation, and on a link with small frames that was one repaint
      // per 64 KB - more work than moving the bytes. Reports are throttled by
      // time and by whole percent, and the receiver always reports completion.
      const progress = this.activeTransfers.get(fileIdHex);
      if (progress) {
        const transferred = incoming.chunks.size;
        const pct = Math.min(100, Math.round((transferred / incoming.header.totalChunks) * 100));
        const elapsed = (Date.now() - incoming.startTime) / 1000;
        const instantaneous = elapsed > 0 ? incoming.receivedBytes / elapsed : 0;
        incoming.lastSpeedBps = incoming.lastSpeedBps > 0
          ? incoming.lastSpeedBps * (1 - SPEED_SMOOTHING) + instantaneous * SPEED_SMOOTHING
          : instantaneous;

        progress.transferredChunks = transferred;
        progress.progressPercent = pct;
        progress.speedBps = incoming.lastSpeedBps;

        const nowMs = Date.now();
        const isLastChunk = transferred >= incoming.header.totalChunks;
        if (
          isLastChunk ||
          (pct !== incoming.lastReportedPercent &&
            nowMs - incoming.lastReportAt >= FileTransferManager.PROGRESS_REPORT_MS)
        ) {
          incoming.lastReportAt = nowMs;
          incoming.lastReportedPercent = pct;
          events?.onProgress?.({ ...progress });
        }
      }

      // Check if all chunks received (account for out-of-order arrival)
      if (incoming.chunks.size >= incoming.header.totalChunks) {
        if (progress) {
          progress.status = 'verifying';
          events?.onProgress?.({ ...progress });
        }

        try {
          // Verify all expected chunks are present before reassembly
          const missing: number[] = [];
          for (let i = 0; i < incoming.header.totalChunks; i++) {
            if (!incoming.chunks.has(i)) {
              missing.push(i);
            }
          }
          if (missing.length > 0) {
            throw new Error(`Missing chunks during reassembly: ${missing.join(', ')}`);
          }

          // Reassemble full byte array
          const fullBytes = new Uint8Array(incoming.header.size);
          let offset = 0;
          for (let i = 0; i < incoming.header.totalChunks; i++) {
            const ch = incoming.chunks.get(i);
            if (!ch) {
              throw new Error(`Missing chunk #${i} during reassembly`);
            }
            fullBytes.set(ch, offset);
            offset += ch.byteLength;
          }

          // Verify SHA-256 hash
          const calculatedHashBytes = await sha256(fullBytes);
          const calculatedHashHex = arrayBufferToHex(calculatedHashBytes);

          if (calculatedHashHex !== incoming.header.hashSHA256) {
            if (progress) progress.status = 'error';
            events?.onError?.(
              fileIdHex,
              `SHA-256 verification failed! Expected ${incoming.header.hashSHA256}, got ${calculatedHashHex}`
            );
            throw new Error('File integrity hash mismatch');
          }

          const mime = incoming.header.mimeType;
          const blob = new Blob([fullBytes], { type: mime });
          const blobUrl = URL.createObjectURL(blob);
          const isImage = mime.startsWith('image/');
          const isAudio = mime.startsWith('audio/');
          const isVideo = mime.startsWith('video/');

          let exifData = undefined;
          if (isImage) {
            try {
              exifData = await extractImageExif(blob);
            } catch (err) {
              console.warn('Receiver EXIF extraction error:', err);
            }
          }

          if (progress) {
            progress.status = 'completed';
            progress.progressPercent = 100;
            progress.blobUrl = blobUrl;
            events?.onProgress?.({ ...progress });
          }

          const fileRecord: FileRecord = {
            fileId: fileIdHex,
            name: incoming.header.name,
            size: incoming.header.size,
            mimeType: mime,
            hashSHA256: calculatedHashHex,
            blobRef: blob,
            isImage,
            isAudio,
            isVideo,
            exifData,
            transferSpeedBps: incoming.lastSpeedBps,
          };

          await db.files.put(fileRecord);
          const meta: FileCompletionMeta = {
            messageId: incoming.header.messageId,
            senderDeviceId: incoming.header.senderDeviceId,
            senderDisplayName: incoming.header.senderDisplayName,
            previewUrl: incoming.header.previewUrl,
          };
          // Stored first, so the conversation holds the complete attachment
          // before anything else reacts to it.
          await this.completionSink?.(fileRecord, blob, meta);
          events?.onCompleted?.(fileRecord, blob, meta);

          return { fileRecord, blob };
        } catch (reassembleErr: any) {
          if (progress) progress.status = 'error';
          events?.onError?.(fileIdHex, reassembleErr.message);
          console.error('File reassembly error:', reassembleErr);
        } finally {
          // Always clean up incoming file state to prevent memory leaks
          this.incomingFiles.delete(fileIdHex);
          this.activeTransfers.delete(fileIdHex);
        }
      }
    }

    // C. 0x22: CHUNK_ACK
    if (packetType === PacketType.CHUNK_ACK) {
      const ack = decodeChunkAckPayload(payload);

      if (!this.receivedAcks.has(fileIdHex)) {
        this.receivedAcks.set(fileIdHex, new Set());
      }
      this.receivedAcks.get(fileIdHex)!.add(ack.chunkIndex);

      // Acknowledged chunks are retired cumulatively. The channel delivers in
      // order, so an ACK for chunk N also means every chunk before N is safely
      // there: one batched ACK clears the whole batch instead of leaving the
      // fifteen resend timers of the chunks it covers running, which used to
      // turn batching into a burst of pointless retransmissions.
      const pending = this.pendingChunks.get(fileIdHex);
      if (pending) {
        for (const [index, chunk] of Array.from(pending.entries())) {
          if (index > ack.chunkIndex) continue;
          if (chunk.timer) clearTimeout(chunk.timer);
          pending.delete(index);
        }
      }

      // Explicit NACK: retransmit that chunk right away.
      if (ack.status === AckStatus.NACK_RETRANSMIT_REQ) {
        const ctx = this.transferContext.get(fileIdHex);
        const chunkBytes = this.sliceChunk(fileIdHex, ack.chunkIndex);
        if (ctx && chunkBytes) {
          const resendTimer = setTimeout(() => {
            if (this.isCancelled.has(fileIdHex)) return;
            this.sendChunkWithRetry(
              fileIdHex, ctx.fileIdBigInt, ack.chunkIndex, chunkBytes,
              ctx.dataChannel, ctx.session
            ).catch((err) => {
              console.warn(`NACK-rerequested chunk ${ack.chunkIndex} resend error:`, err);
            });
          }, BACKOFF_BASE_MS);
          if (pending) {
            pending.set(ack.chunkIndex, { retryCount: 1, timer: resendTimer });
          }
        }
      }

      const fileResolvers = this.outgoingAckResolvers.get(fileIdHex);
      if (fileResolvers) {
        const resolver = fileResolvers.get(ack.chunkIndex);
        if (resolver) {
          resolver();
          fileResolvers.delete(ack.chunkIndex);
        }
      }
    }
  }
}

export const fileTransferManager = new FileTransferManager();
