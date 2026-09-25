import {
  AckStatus,
  PacketType,
  PROTOCOL_VERSION,
} from '../types/index';

export interface PacketHeader {
  protocolVer: number; // 2 bytes
  packetType: PacketType; // 1 byte
  flags: number; // 1 byte
  sessionId: bigint; // 8 bytes (uint64)
  objectId: bigint; // 8 bytes (uint64)
  sequenceIndex: number; // 4 bytes (uint32)
}

export interface DecryptedPacket {
  header: PacketHeader;
  rawHeader: Uint8Array; // 24 bytes
  payload: Uint8Array;
}

export function buildPacketHeader(
  packetType: PacketType,
  sessionId: bigint,
  objectId: bigint,
  sequenceIndex: number,
  flags = 0x00,
  protocolVer: number = PROTOCOL_VERSION
): Uint8Array {
  const buffer = new Uint8Array(24);
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  // [0..1] Protocol Ver
  view.setUint16(0, protocolVer, false);
  // [2] Packet Type
  view.setUint8(2, packetType);
  // [3] Flags
  view.setUint8(3, flags);
  // [4..11] Session ID (64-bit BigInt)
  view.setBigUint64(4, sessionId, false);
  // [12..19] Object ID / Msg ID (64-bit BigInt)
  view.setBigUint64(12, objectId, false);
  // [20..23] Sequence / Chunk Index (32-bit uint)
  view.setUint32(20, sequenceIndex, false);

  return buffer;
}

import { safeDataView } from '../crypto/utils';

export function parsePacketHeader(raw24Bytes: Uint8Array): PacketHeader {
  if (raw24Bytes.byteLength < 24) {
    throw new Error(`Packet header too short: ${raw24Bytes.byteLength} bytes (expected 24)`);
  }

  const view = safeDataView(raw24Bytes, 0, 24);

  return {
    protocolVer: view.getUint16(0, false),
    packetType: view.getUint8(2) as PacketType,
    flags: view.getUint8(3),
    sessionId: view.getBigUint64(4, false),
    objectId: view.getBigUint64(12, false),
    sequenceIndex: view.getUint32(20, false),
  };
}

export interface FileHeaderPayload {
  fileId: string; // 16 hex chars
  name: string;
  size: number;
  mimeType: string;
  hashSHA256: string;
  totalChunks: number;
  chunkSize: number;
  /**
   * Conversation metadata. A file sent over the direct link must land in the
   * very same bubble the relay would have filled, so the message id (and who
   * sent it) travel with the header. Both are optional: a peer running an older
   * build simply omits them and the receiver falls back to matching by file id.
   */
  messageId?: string;
  senderDeviceId?: string;
  senderDisplayName?: string;
  /** Small inline preview (data URL) so a photo shows before its bytes land. */
  previewUrl?: string;
  /** Intrinsic pixel size of an image, so the bubble has its real shape. */
  width?: number;
  height?: number;
  durationMs?: number;
}

export function encodeFileHeaderPayload(info: FileHeaderPayload): Uint8Array {
  const jsonStr = JSON.stringify(info);
  return new TextEncoder().encode(jsonStr);
}

export function decodeFileHeaderPayload(payloadBytes: Uint8Array): FileHeaderPayload {
  const jsonStr = new TextDecoder().decode(payloadBytes);
  return JSON.parse(jsonStr) as FileHeaderPayload;
}

/**
 * "Start here": the receiver's answer to a FILE_HEADER.
 *
 * `bytes` is the length of the contiguous prefix it already holds from offset
 * zero. The sender aligns that to its own frame grid, so a resume works even
 * when the two sides ended up with different frame sizes (a LAN link resumed
 * over an internet fallback, or the other way round).
 */
export interface FileResumePayload {
  bytes: number;
  chunkSize: number;
}

export function encodeFileResumePayload(resume: FileResumePayload): Uint8Array {
  const buffer = new Uint8Array(8);
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  view.setUint32(0, Math.max(0, Math.floor(resume.bytes)) >>> 0, false);
  view.setUint32(4, Math.max(0, Math.floor(resume.chunkSize)) >>> 0, false);
  return buffer;
}

export function decodeFileResumePayload(payloadBytes: Uint8Array): FileResumePayload {
  if (payloadBytes.byteLength < 8) {
    throw new Error(`File resume payload too short: ${payloadBytes.byteLength} bytes`);
  }
  const view = safeDataView(payloadBytes, 0, 8);
  return {
    bytes: view.getUint32(0, false),
    chunkSize: view.getUint32(4, false),
  };
}

export interface ChunkAckPayload {
  chunkIndex: number; // uint32
  status: AckStatus; // 0x00 OK_ACK, 0x01 NACK
}

export function encodeChunkAckPayload(ack: ChunkAckPayload): Uint8Array {
  const buffer = new Uint8Array(5);
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  view.setUint32(0, ack.chunkIndex, false);
  view.setUint8(4, ack.status);
  return buffer;
}

export function decodeChunkAckPayload(payloadBytes: Uint8Array): ChunkAckPayload {
  if (payloadBytes.byteLength < 5) {
    throw new Error(`Chunk ACK payload too short: ${payloadBytes.byteLength} bytes`);
  }
  const view = safeDataView(payloadBytes, 0, 5);
  return {
    chunkIndex: view.getUint32(0, false),
    status: view.getUint8(4) as AckStatus,
  };
}
