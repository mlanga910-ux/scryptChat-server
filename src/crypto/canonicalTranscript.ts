import { PROTOCOL_VERSION } from '../types/index';
import {
  arrayBufferToBase64,
  base64ToArrayBuffer,
  sha256,
} from './utils';

export interface CanonicalTranscriptParams {
  protocolVer?: number; // default 0x0301
  identityPublicKeyA: Uint8Array; // 65 bytes
  ephemeralPublicKeyA: Uint8Array; // 65 bytes
  challengeNonceA: Uint8Array; // 16 bytes
  identityPublicKeyB: Uint8Array; // 65 bytes
  ephemeralPublicKeyB: Uint8Array; // 65 bytes
  challengeNonceB: Uint8Array; // 16 bytes
  handshakeSalt: Uint8Array; // 32 bytes
  sdpFingerprintSHA256: Uint8Array; // 32 bytes
}

export function buildCanonicalTranscriptBinary(params: CanonicalTranscriptParams): Uint8Array {
  const version = params.protocolVer ?? PROTOCOL_VERSION;
  // Exact byte length: 2 (version) + 65 (pubA) + 65 (ephA) + 16 (nonceA) + 65 (pubB) + 65 (ephB) + 16 (nonceB) + 32 (salt) + 32 (sdpHash) = 358 bytes
  const totalLength = 2 + 65 + 65 + 16 + 65 + 65 + 16 + 32 + 32;
  const buffer = new Uint8Array(totalLength);
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  let offset = 0;

  // 1. ProtocolVer (2B)
  view.setUint16(offset, version, false);
  offset += 2;

  // 2. IdentityPublicKey_A (65B)
  if (params.identityPublicKeyA.length !== 65) {
    throw new Error(`IdentityPublicKey_A must be 65 bytes (got ${params.identityPublicKeyA.length})`);
  }
  buffer.set(params.identityPublicKeyA, offset);
  offset += 65;

  // 3. EphemeralPublicKey_A (65B)
  if (params.ephemeralPublicKeyA.length !== 65) {
    throw new Error(`EphemeralPublicKey_A must be 65 bytes (got ${params.ephemeralPublicKeyA.length})`);
  }
  buffer.set(params.ephemeralPublicKeyA, offset);
  offset += 65;

  // 4. ChallengeNonce_A (16B)
  if (params.challengeNonceA.length !== 16) {
    throw new Error(`ChallengeNonce_A must be 16 bytes (got ${params.challengeNonceA.length})`);
  }
  buffer.set(params.challengeNonceA, offset);
  offset += 16;

  // 5. IdentityPublicKey_B (65B)
  if (params.identityPublicKeyB.length !== 65) {
    throw new Error(`IdentityPublicKey_B must be 65 bytes (got ${params.identityPublicKeyB.length})`);
  }
  buffer.set(params.identityPublicKeyB, offset);
  offset += 65;

  // 6. EphemeralPublicKey_B (65B)
  if (params.ephemeralPublicKeyB.length !== 65) {
    throw new Error(`EphemeralPublicKey_B must be 65 bytes (got ${params.ephemeralPublicKeyB.length})`);
  }
  buffer.set(params.ephemeralPublicKeyB, offset);
  offset += 65;

  // 7. ChallengeNonce_B (16B)
  if (params.challengeNonceB.length !== 16) {
    throw new Error(`ChallengeNonce_B must be 16 bytes (got ${params.challengeNonceB.length})`);
  }
  buffer.set(params.challengeNonceB, offset);
  offset += 16;

  // 8. HandshakeSalt (32B)
  if (params.handshakeSalt.length !== 32) {
    throw new Error(`HandshakeSalt must be 32 bytes (got ${params.handshakeSalt.length})`);
  }
  buffer.set(params.handshakeSalt, offset);
  offset += 32;

  // 9. SDP Fingerprint SHA-256 (32B)
  if (params.sdpFingerprintSHA256.length !== 32) {
    throw new Error(`sdpFingerprintSHA256 must be 32 bytes (got ${params.sdpFingerprintSHA256.length})`);
  }
  buffer.set(params.sdpFingerprintSHA256, offset);
  offset += 32;

  return buffer;
}

export async function computeTranscriptHash(params: CanonicalTranscriptParams): Promise<Uint8Array> {
  const binary = buildCanonicalTranscriptBinary(params);
  return await sha256(binary);
}

export async function signTranscriptHash(
  privateKeyECDSA: CryptoKey,
  transcriptHash: Uint8Array
): Promise<string> {
  const signature = await crypto.subtle.sign(
    {
      name: 'ECDSA',
      hash: { name: 'SHA-256' },
    },
    privateKeyECDSA,
    transcriptHash
  );
  return arrayBufferToBase64(new Uint8Array(signature));
}

export async function verifyTranscriptSignature(
  publicKeyECDSA: CryptoKey,
  transcriptHash: Uint8Array,
  signatureBase64: string
): Promise<boolean> {
  const signatureBytes = base64ToArrayBuffer(signatureBase64);
  return await crypto.subtle.verify(
    {
      name: 'ECDSA',
      hash: { name: 'SHA-256' },
    },
    publicKeyECDSA,
    signatureBytes,
    transcriptHash
  );
}

export async function computeSafetyNumber(
  pubKeyA: Uint8Array,
  pubKeyB: Uint8Array
): Promise<string> {
  // Sort keys lexicographically for symmetry
  const cmp = pubKeyA.toString().localeCompare(pubKeyB.toString());
  const combined = new Uint8Array(130);
  if (cmp <= 0) {
    combined.set(pubKeyA, 0);
    combined.set(pubKeyB, 65);
  } else {
    combined.set(pubKeyB, 0);
    combined.set(pubKeyA, 65);
  }

  const hash = await sha256(combined);
  const view = new DataView(hash.buffer, hash.byteOffset, hash.byteLength);
  const num1 = (view.getUint32(0, false) % 1000).toString().padStart(3, '0');
  const num2 = (view.getUint32(4, false) % 1000).toString().padStart(3, '0');
  return `${num1} ${num2}`;
}
