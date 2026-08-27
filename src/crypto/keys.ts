import { db } from '../db/index';
import { IdentityRecord } from '../types/index';
import {
  arrayBufferToBase64,
  arrayBufferToHex,
  base64ToArrayBuffer,
  sha256,
} from './utils';

export async function generateDeviceId(rawPublicKey: Uint8Array): Promise<string> {
  const hash = await sha256(rawPublicKey);
  const hex = arrayBufferToHex(hash);
  // Format: DEV-XXXX-XXXX-XXXX-XXXX
  return `DEV-${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}`;
}

export async function getOrCreateIdentity(customDisplayName?: string, customAvatarColor?: string): Promise<IdentityRecord> {
  const existingList = await db.identity.toArray();
  if (existingList.length > 0) {
    const current = existingList[0];
    if (customDisplayName && !current.displayName) {
      current.displayName = customDisplayName;
      if (customAvatarColor) current.avatarColor = customAvatarColor;
      await db.identity.put(current);
    }
    return current;
  }

  // Generate new long-term ECDSA P-256 key pair (extractable: false for private key)
  const keyPair = (await crypto.subtle.generateKey(
    {
      name: 'ECDSA',
      namedCurve: 'P-256',
    },
    false, // non-extractable private key
    ['sign', 'verify']
  )) as CryptoKeyPair;

  const rawPubBuffer = await crypto.subtle.exportKey('raw', keyPair.publicKey);
  const rawPubBytes = new Uint8Array(rawPubBuffer);
  const publicKeyRaw = arrayBufferToBase64(rawPubBytes);
  const deviceId = await generateDeviceId(rawPubBytes);

  const identity: IdentityRecord = {
    deviceId,
    publicKeyECDSA: keyPair.publicKey,
    privateKeyECDSA: keyPair.privateKey,
    publicKeyRaw,
    displayName: customDisplayName || '',
    avatarColor: customAvatarColor || '#3b82f6',
    statusBio: 'E2EE Sovereign Node',
    createdAt: Date.now(),
  };

  await db.identity.put(identity);
  return identity;
}

export async function updateIdentityProfile(displayName: string, avatarColor?: string, statusBio?: string): Promise<IdentityRecord | null> {
  const list = await db.identity.toArray();
  if (list.length === 0) return null;
  const current = list[0];
  current.displayName = displayName;
  if (avatarColor) current.avatarColor = avatarColor;
  if (statusBio !== undefined) current.statusBio = statusBio;
  await db.identity.put(current);
  return current;
}

export async function importPeerECDSAKey(rawBase64: string): Promise<CryptoKey> {
  const rawBytes = base64ToArrayBuffer(rawBase64);
  return await crypto.subtle.importKey(
    'raw',
    rawBytes,
    {
      name: 'ECDSA',
      namedCurve: 'P-256',
    },
    true,
    ['verify']
  );
}

export async function generateEphemeralECDH(): Promise<{
  keyPair: CryptoKeyPair;
  rawPublicKey: Uint8Array;
  publicKeyBase64: string;
}> {
  const keyPair = (await crypto.subtle.generateKey(
    {
      name: 'ECDH',
      namedCurve: 'P-256',
    },
    true,
    ['deriveBits', 'deriveKey']
  )) as CryptoKeyPair;

  const rawPubBuffer = await crypto.subtle.exportKey('raw', keyPair.publicKey);
  const rawPubBytes = new Uint8Array(rawPubBuffer);
  return {
    keyPair,
    rawPublicKey: rawPubBytes,
    publicKeyBase64: arrayBufferToBase64(rawPubBytes),
  };
}

export async function importPeerECDHKey(rawBase64: string): Promise<CryptoKey> {
  const rawBytes = base64ToArrayBuffer(rawBase64);
  return await crypto.subtle.importKey(
    'raw',
    rawBytes,
    {
      name: 'ECDH',
      namedCurve: 'P-256',
    },
    true,
    []
  );
}
