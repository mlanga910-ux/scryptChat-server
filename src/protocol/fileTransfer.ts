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

export const CHUNK_SIZE = 64 * 1024; // 64 KB
const MAX_BUFFERED_AMOUNT = 1024 * 1024; // 1 MB backpressure threshold

export interface FileTransferEvents {
  onProgress?: (progress: FileTransferProgress) => void;
  onCompleted?: (fileRecord: FileRecord, blob: Blob) => void;
  onError?: (fileId: string, error: string) => void;
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

  public getTransfer(fileId: string): FileTransferProgress | undefined {
    return this.activeTransfers.get(fileId);
  }

  public getAllTransfers(): FileTransferProgress[] {
    return Array.from(this.activeTransfers.values());
  }

  public cancelTransfer(fileId: string): void {
    this.isCancelled.add(fileId);
    const transfer = this.activeTransfers.get(fileId);
    if (transfer) {
      transfer.status = 'error';
    }
  }

  /**
   * Sender: Sends a file chunked with 64KB blocks and backpressure management.
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
    events?.onProgress?.({ ...progress });

    // 1. Send FILE_HEADER packet (0x20)
    try {
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

      // 2. Stream CHUNKS with backpressure
      for (let chunkIdx = 0; chunkIdx < totalChunks; chunkIdx++) {
        if (this.isCancelled.has(fileId)) {
          throw new Error('File transfer cancelled by user');
        }

        const start = chunkIdx * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, fileBytes.byteLength);
        const chunkBytes = fileBytes.slice(start, end);

        const chunkPacketHeader = buildPacketHeader(
          PacketType.FILE_CHUNK,
          session.sessionId,
          fileIdBigInt,
          chunkIdx
        );

        const encryptedChunkFrame = await session.encryptFrame(
          chunkPacketHeader,
          chunkBytes
        );

        // Backpressure check
        if (dataChannel.bufferedAmount > MAX_BUFFERED_AMOUNT) {
          await new Promise<void>((resolve) => {
            const checkBuffer = () => {
              if (dataChannel.bufferedAmount < MAX_BUFFERED_AMOUNT / 2) {
                resolve();
              } else {
                setTimeout(checkBuffer, 15);
              }
            };
            checkBuffer();
          });
        }

        dataChannel.send(encryptedChunkFrame);

        // Update progress
        const transferred = chunkIdx + 1;
        const pct = Math.round((transferred / totalChunks) * 100);
        const elapsed = (Date.now() - startTime) / 1000;
        const speed = elapsed > 0 ? (end / elapsed) : 0;

        progress.transferredChunks = transferred;
        progress.progressPercent = pct;
        progress.speedBps = speed;
        events?.onProgress?.({ ...progress });
      }

      // Check if last chunk was already acknowledged, or wait with a safe timeout
      const lastChunkIdx = totalChunks - 1;
      const isAlreadyAcked = this.receivedAcks.get(fileId)?.has(lastChunkIdx);

      if (!isAlreadyAcked) {
        await new Promise<void>((resolve) => {
          const resolvers = this.outgoingAckResolvers.get(fileId);
          if (resolvers) {
            resolvers.set(lastChunkIdx, resolve);
          }
          // Safe timeout: don't freeze indefinitely if peer completed silently
          setTimeout(() => resolve(), 8000);
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
      const progress = this.activeTransfers.get(fileId);
      if (progress) {
        progress.status = 'error';
        events?.onProgress?.({ ...progress });
      }
      events?.onError?.(fileId, err.message);
      throw err;
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

      incoming.chunks.set(sequenceIndex, payload);
      incoming.receivedBytes += payload.byteLength;

      // Send CHUNK_ACK (0x22)
      try {
        const ackPayload: ChunkAckPayload = {
          chunkIndex: sequenceIndex,
          status: AckStatus.OK_ACK,
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

      // Check if all chunks received
      if (incoming.chunks.size >= incoming.header.totalChunks) {
        if (progress) {
          progress.status = 'verifying';
          events?.onProgress?.({ ...progress });
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
        this.incomingFiles.delete(fileIdHex);
        events?.onCompleted?.(fileRecord, blob);

        return { fileRecord, blob };
      }
    }

    // C. 0x22: CHUNK_ACK
    if (packetType === PacketType.CHUNK_ACK) {
      const ack = decodeChunkAckPayload(payload);
      if (!this.receivedAcks.has(fileIdHex)) {
        this.receivedAcks.set(fileIdHex, new Set());
      }
      this.receivedAcks.get(fileIdHex)!.add(ack.chunkIndex);

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
