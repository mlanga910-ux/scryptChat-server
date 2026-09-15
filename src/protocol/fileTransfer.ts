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

export const CHUNK_SIZE = 256 * 1024; // 256 KB frames: far less per-chunk encryption/ACK overhead
const MAX_BUFFERED_AMOUNT = 16 * 1024 * 1024; // 16 MB in-flight window keeps fast LAN links saturated
const CHUNK_TIMEOUT_MS = 10000; // Resend chunk if ACK not received within 10s
const ACK_WAIT_TIMEOUT_MS = 15000; // Total wait for final ACK before declaring complete
const MAX_CHUNK_RETRIES = 3; // Maximum retransmission attempts per chunk
const BACKOFF_BASE_MS = 500; // Exponential backoff base for chunk resend

export interface FileTransferEvents {
  onProgress?: (progress: FileTransferProgress) => void;
  onCompleted?: (fileRecord: FileRecord, blob: Blob) => void;
  onError?: (fileId: string, error: string) => void;
}

interface PendingChunk {
  chunkBytes: Uint8Array;
  retryCount: number;
  timer: ReturnType<typeof setTimeout> | null;
}

export class FileTransferManager {
  private activeTransfers: Map<string, FileTransferProgress> = new Map();
  private incomingFiles: Map<
    string,
    {
      header: FileHeaderPayload;
      chunks: Map<number, Uint8Array>;
      receivedBytes: number;
      startTime: number;
    }
  > = new Map();
  private outgoingAckResolvers: Map<string, Map<number, () => void>> = new Map();
  private receivedAcks: Map<string, Set<number>> = new Map();
  private isCancelled = new Set<string>();
  private pendingChunks: Map<string, Map<number, PendingChunk>> = new Map();
  private transferContext: Map<
    string,
    {
      dataChannel: RTCDataChannel;
      session: CryptoSession;
      fileIdBigInt: bigint;
      fileBytes: Uint8Array;
      events?: FileTransferEvents;
    }
  > = new Map();

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
  private waitForDrain(dataChannel: RTCDataChannel): Promise<void> {
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
      const lowWaterMark = Math.min(4 * 1024 * 1024, MAX_BUFFERED_AMOUNT / 2);
      dataChannel.bufferedAmountLowThreshold = lowWaterMark;
      dataChannel.addEventListener('bufferedamountlow', done);
      poll = setInterval(() => {
        if (dataChannel.readyState !== 'open' || dataChannel.bufferedAmount <= lowWaterMark) done();
      }, 20);
    });
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

    const encryptedChunkFrame = await session.encryptFrame(chunkPacketHeader, chunkBytes);

    // Backpressure: park the loop until the channel buffer drains.
    if (dataChannel.bufferedAmount > MAX_BUFFERED_AMOUNT) {
      await this.waitForDrain(dataChannel);
    }

    if (dataChannel.readyState !== 'open') {
      throw new Error('Data channel is not open, cannot send chunk');
    }

    dataChannel.send(encryptedChunkFrame);

    // Set up ACK timeout with retry
    const pending = this.pendingChunks.get(fileId);
    if (!pending) return;

    const timer = setTimeout(() => {
      const chunk = pending.get(chunkIdx);
      if (!chunk) return;

      if (chunk.retryCount >= MAX_CHUNK_RETRIES) {
        const transfer = this.activeTransfers.get(fileId);
        if (transfer) {
          transfer.status = 'error';
        }
        this.transferContext
          .get(fileId)
          ?.events?.onError?.(fileId, `Chunk ${chunkIdx} failed after ${MAX_CHUNK_RETRIES} retries`);
        pending.delete(chunkIdx);
        return;
      }

      chunk.retryCount += 1;
      const backoff = BACKOFF_BASE_MS * Math.pow(2, chunk.retryCount - 1);

      setTimeout(() => {
        if (this.isCancelled.has(fileId)) return;
        this.sendChunkWithRetry(fileId, fileIdBigInt, chunkIdx, chunkBytes, dataChannel, session)
          .catch((err) => {
            console.warn(`Chunk ${chunkIdx} resend error:`, err);
          });
      }, backoff);
    }, CHUNK_TIMEOUT_MS);

    pending.set(chunkIdx, {
      chunkBytes,
      retryCount: 0,
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
    events?: FileTransferEvents
  ): Promise<FileRecord> {
    const arrayBuf = await file.arrayBuffer();
    const fileBytes = new Uint8Array(arrayBuf);
    const hashBytes = await sha256(fileBytes);
    const hashHex = arrayBufferToHex(hashBytes);

    // Generate 64-bit Hex FileID (16 hex chars)
    const fileIdBigInt = BigInt(
      '0x' +
        Array.from(hashBytes.slice(0, 8))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('')
    );
    const fileId = fileIdBigInt.toString(16).padStart(16, '0').toUpperCase();

    const totalChunks = Math.ceil(fileBytes.byteLength / CHUNK_SIZE);
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
      chunkSize: CHUNK_SIZE,
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
    this.outgoingAckResolvers.set(fileId, new Map());
    this.receivedAcks.set(fileId, new Set());
    this.pendingChunks.set(fileId, new Map());
    this.transferContext.set(fileId, { dataChannel, session, fileIdBigInt, fileBytes, events });
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

      const encryptedHeaderFrame = await session.encryptFrame(
        headerBytes,
        encodedHeaderPayload
      );
      dataChannel.send(encryptedHeaderFrame);

      const startTime = Date.now();

      // 2. Stream CHUNKS with backpressure and ACK tracking
      for (let chunkIdx = 0; chunkIdx < totalChunks; chunkIdx++) {
        if (this.isCancelled.has(fileId)) {
          throw new Error('File transfer cancelled by user');
        }

        const start = chunkIdx * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, fileBytes.byteLength);
        const chunkBytes = fileBytes.slice(start, end);

        await this.sendChunkWithRetry(
          fileId, fileIdBigInt, chunkIdx, chunkBytes, dataChannel, session
        );

        // Update progress - use chunk size for accurate speed calculation
        const transferred = chunkIdx + 1;
        const pct = Math.round((transferred / totalChunks) * 100);
        const elapsedSec = (Date.now() - startTime) / 1000;
        const speed = elapsedSec > 0 ? (transferred * CHUNK_SIZE) / elapsedSec : 0;

        progress.transferredChunks = transferred;
        progress.progressPercent = pct;
        progress.speedBps = speed;
        events?.onProgress?.({ ...progress });
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
  public async handleIncomingPacket(
    packetType: PacketType,
    objectId: bigint,
    sequenceIndex: number,
    payload: Uint8Array,
    dataChannel: RTCDataChannel,
    session: CryptoSession,
    events?: FileTransferEvents
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

      // Send CHUNK_ACK (0x22) - always acknowledge even duplicates
      try {
        const ackPayload: ChunkAckPayload = {
          chunkIndex: sequenceIndex,
          status: isDuplicate ? AckStatus.OK_ACK : AckStatus.OK_ACK,
        };
        const encodedAck = encodeChunkAckPayload(ackPayload);
        const ackHeader = buildPacketHeader(
          PacketType.CHUNK_ACK,
          session.sessionId,
          objectId,
          sequenceIndex
        );
        const encryptedAck = await session.encryptFrame(ackHeader, encodedAck);
        if (dataChannel.readyState === 'open') {
          dataChannel.send(encryptedAck);
        }
      } catch (err) {
        console.error('Failed to send CHUNK_ACK:', err);
      }

      // Update progress
      const progress = this.activeTransfers.get(fileIdHex);
      if (progress) {
        const transferred = incoming.chunks.size;
        const pct = Math.min(100, Math.round((transferred / incoming.header.totalChunks) * 100));
        const elapsed = (Date.now() - incoming.startTime) / 1000;
        const speed = elapsed > 0 ? (incoming.receivedBytes / elapsed) : 0;

        progress.transferredChunks = transferred;
        progress.progressPercent = pct;
        progress.speedBps = speed;
        events?.onProgress?.({ ...progress });
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
          };

          await db.files.put(fileRecord);
          events?.onCompleted?.(fileRecord, blob);

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

      // Cancel the pending chunk's resend timer
      const pending = this.pendingChunks.get(fileIdHex);
      if (pending) {
        const chunk = pending.get(ack.chunkIndex);
        if (chunk && chunk.timer) {
          clearTimeout(chunk.timer);
          chunk.timer = null;
        }
        pending.delete(ack.chunkIndex);
      }

      // Check for NACK and trigger retransmission
      if (ack.status === AckStatus.NACK_RETRANSMIT_REQ) {
        const ctx = this.transferContext.get(fileIdHex);
        if (ctx) {
          const start = ack.chunkIndex * CHUNK_SIZE;
          const end = Math.min(start + CHUNK_SIZE, ctx.fileBytes.byteLength);
          if (start >= ctx.fileBytes.byteLength) return;
          const chunkBytes = ctx.fileBytes.slice(start, end);
          const resendTimer = setTimeout(() => {
            if (this.isCancelled.has(fileIdHex)) return;
            this.sendChunkWithRetry(
              fileIdHex, ctx.fileIdBigInt, ack.chunkIndex, chunkBytes,
              ctx.dataChannel, ctx.session
            ).catch((err) => {
              console.warn(`NACK-rerequested chunk ${ack.chunkIndex} resend error:`, err);
            });
          }, BACKOFF_BASE_MS * Math.pow(2, 0));
          // Store the timer reference for cleanup
          if (pending) {
            pending.set(ack.chunkIndex, {
              chunkBytes,
              retryCount: 1,
              timer: resendTimer,
            });
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
