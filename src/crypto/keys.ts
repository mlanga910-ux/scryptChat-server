import { db } from '../db/index';
import { IdentityRecord } from '../types/index';
import {
  arrayBufferToBase64,
  arrayBufferToHex,
  base64ToArrayBuffer,
  sha256,
} from './utils';

const STORAGE_KEY_PUB = 'scryptchat_permanent_pub_raw';
const STORAGE_KEY_PRIV_JWK = 'scryptchat_permanent_priv_jwk';
const STORAGE_KEY_DEV_ID = 'scryptchat_permanent_device_id';
const STORAGE_KEY_NAME = 'scryptchat_display_name';
const STORAGE_KEY_COLOR = 'scryptchat_avatar_color';

export async function generateDeviceId(rawPublicKey: Uint8Array): Promise<string> {
  const hash = await sha256(rawPublicKey);
  const hex = arrayBufferToHex(hash);
  // Format: DEV-XXXX-XXXX-XXXX-XXXX (Deterministic cryptographic fingerprint)
  return `DEV-${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}`;
}

export async function getOrCreateIdentity(customDisplayName?: string, customAvatarColor?: string): Promise<IdentityRecord> {
  // 1. Check IndexedDB first
  try {
    const existingList = await db.identity.toArray();
    if (existingList.length > 0) {
      const current = existingList[0];
      if (current && current.deviceId && current.publicKeyECDSA && current.privateKeyECDSA) {
        if (customDisplayName && !current.displayName) {
          current.displayName = customDisplayName;
          if (customAvatarColor) current.avatarColor = customAvatarColor;
          await db.identity.put(current);
        }
        // Sync backup to localStorage
        try {
          localStorage.setItem(STORAGE_KEY_DEV_ID, current.deviceId);
          localStorage.setItem(STORAGE_KEY_PUB, current.publicKeyRaw);
          if (current.displayName) localStorage.setItem(STORAGE_KEY_NAME, current.displayName);
          if (current.avatarColor) localStorage.setItem(STORAGE_KEY_COLOR, current.avatarColor);
        } catch {}
        return current;
      }
    }
  } catch (e) {
    console.warn('IndexedDB identity lookup warning:', e);
  }

  // 2. Check localStorage permanent backup if IndexedDB was cleared or fresh
  try {
    const savedPrivJwk = localStorage.getItem(STORAGE_KEY_PRIV_JWK);
    const savedPubRaw = localStorage.getItem(STORAGE_KEY_PUB);
    const savedDevId = localStorage.getItem(STORAGE_KEY_DEV_ID);
    const savedName = localStorage.getItem(STORAGE_KEY_NAME);
    const savedColor = localStorage.getItem(STORAGE_KEY_COLOR);

    if (savedPrivJwk && savedPubRaw && savedDevId) {
      const jwk = JSON.parse(savedPrivJwk);
      const privateKey = await crypto.subtle.importKey(
        'jwk',
        jwk,
        { name: 'ECDSA', namedCurve: 'P-256' },
        true,
        ['sign']
      );
      const rawPubBytes = base64ToArrayBuffer(savedPubRaw);
      const publicKey = await crypto.subtle.importKey(
        'raw',
        rawPubBytes,
        { name: 'ECDSA', namedCurve: 'P-256' },
        true,
        ['verify']
      );

      const identity: IdentityRecord = {
        deviceId: savedDevId,
        publicKeyECDSA: publicKey,
        privateKeyECDSA: privateKey,
        publicKeyRaw: savedPubRaw,
        displayName: customDisplayName || savedName || undefined,
        avatarColor: customAvatarColor || savedColor || undefined,
        statusBio: undefined,
        createdAt: Date.now(),
      };

      await db.identity.put(identity);
      return identity;
    }
  } catch (e) {
    console.warn('LocalStorage backup recovery warning:', e);
  }

  // 3. Generate new permanent ECDSA keypair (extractable for deterministic durability)
  const keyPair = (await crypto.subtle.generateKey(
    {
      name: 'ECDSA',
      namedCurve: 'P-256',
    },
    true,
    ['sign', 'verify']
  )) as CryptoKeyPair;

  const rawPubBuffer = await crypto.subtle.exportKey('raw', keyPair.publicKey);
  const rawPubBytes = new Uint8Array(rawPubBuffer);
  const publicKeyRaw = arrayBufferToBase64(rawPubBytes);
  const deviceId = await generateDeviceId(rawPubBytes);

  const privJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);

  const identity: IdentityRecord = {
    deviceId,
    publicKeyECDSA: keyPair.publicKey,
    privateKeyECDSA: keyPair.privateKey,
    publicKeyRaw,
    displayName: customDisplayName,
    avatarColor: customAvatarColor,
    statusBio: undefined,
    createdAt: Date.now(),
  };

  await db.identity.put(identity);

  // Permanently save to localStorage as fail-safe
  try {
    localStorage.setItem(STORAGE_KEY_DEV_ID, deviceId);
    localStorage.setItem(STORAGE_KEY_PUB, publicKeyRaw);
    localStorage.setItem(STORAGE_KEY_PRIV_JWK, JSON.stringify(privJwk));
    if (identity.displayName) localStorage.setItem(STORAGE_KEY_NAME, identity.displayName);
    if (identity.avatarColor) localStorage.setItem(STORAGE_KEY_COLOR, identity.avatarColor);
  } catch {}

  return identity;
}

export async function updateIdentityProfile(
  displayName: string,
  avatarColor?: string,
  statusBio?: string,
  options?: {
    avatarUrl?: string;
    status?: string;
    phone?: string;
    email?: string;
    socialLinks?: {
      twitter?: string;
      telegram?: string;
      github?: string;
      instagram?: string;
      website?: string;
    };
  }
): Promise<IdentityRecord | null> {
  const list = await db.identity.toArray();
  if (list.length === 0) return null;
  const current = list[0];
  current.displayName = displayName;
  if (avatarColor) current.avatarColor = avatarColor;
  if (statusBio !== undefined) current.statusBio = statusBio;
  if (options) {
    if (options.avatarUrl !== undefined) current.avatarUrl = options.avatarUrl;
    if (options.status !== undefined) current.status = options.status;
    if (options.phone !== undefined) current.phone = options.phone;
    if (options.email !== undefined) current.email = options.email;
    if (options.socialLinks !== undefined) current.socialLinks = options.socialLinks;
  }
  await db.identity.put(current);

  try {
    localStorage.setItem(STORAGE_KEY_NAME, displayName);
    if (avatarColor) localStorage.setItem(STORAGE_KEY_COLOR, avatarColor);
    if (current.avatarUrl) localStorage.setItem('scryptchat_avatar_url', current.avatarUrl);
    else localStorage.removeItem('scryptchat_avatar_url');
    if (options?.phone) localStorage.setItem('scryptchat_phone', options.phone);
    if (options?.email) localStorage.setItem('scryptchat_email', options.email);
    if (options?.socialLinks) localStorage.setItem('scryptchat_socials', JSON.stringify(options.socialLinks));
  } catch {}

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
