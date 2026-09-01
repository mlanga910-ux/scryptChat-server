export function arrayBufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function base64ToArrayBuffer(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function arrayBufferToHex(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

export function hexToArrayBuffer(hex: string): Uint8Array {
  const cleanHex = hex.replace(/[^0-9a-fA-F]/g, '');
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < cleanHex.length; i += 2) {
    bytes[i / 2] = parseInt(cleanHex.substr(i, 2), 16);
  }
  return bytes;
}

export function generateRandomBytes(length: number): Uint8Array {
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return array;
}

export function generateRandomHexId(bytesCount = 8): string {
  const bytes = generateRandomBytes(bytesCount);
  return arrayBufferToHex(bytes);
}

export function safeDataView(bytes: Uint8Array, offset = 0, length?: number): DataView {
  const reqLen = length !== undefined ? length : (bytes.byteLength - offset);
  if (reqLen <= 0) {
    return new DataView(new ArrayBuffer(0));
  }
  // Check if slice fits within underlying buffer bounds
  const startOffset = bytes.byteOffset + offset;
  if (startOffset >= 0 && startOffset + reqLen <= bytes.buffer.byteLength) {
    return new DataView(bytes.buffer, startOffset, reqLen);
  }
  // Fallback: Copy to a contiguous buffer
  const copy = bytes.slice(offset, offset + reqLen);
  return new DataView(copy.buffer, copy.byteOffset, copy.byteLength);
}

export function uint64ToBigEndianBytes(value: bigint): Uint8Array {
  const bytes = new Uint8Array(8);
  const view = new DataView(bytes.buffer, bytes.byteOffset, 8);
  view.setBigUint64(0, value, false);
  return bytes;
}

export function bigEndianBytesToUint64(bytes: Uint8Array, offset = 0): bigint {
  const view = safeDataView(bytes, offset, 8);
  return view.getBigUint64(0, false);
}

export async function sha256(data: ArrayBuffer | Uint8Array): Promise<Uint8Array> {
  const hash = await crypto.subtle.digest('SHA-256', data);
  return new Uint8Array(hash);
}
