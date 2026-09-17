import { db } from '../db/index';
import { setProfileCache } from '../db/storage';
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

/**
 * True when WebCrypto is usable. Browsers only expose `crypto.subtle` in a
 * secure context (https, localhost, some packaged apps), so an http:// origin
 * or an embedded frame can legitimately lack it.
 */
export function hasWebCrypto(): boolean {
  try {
    return (
      typeof crypto !== 'undefined' &&
      !!crypto.subtle &&
      typeof crypto.subtle.generateKey === 'function'
    );
  } catch {
    return false;
  }
}

/** Strong random bytes where available, `Math.random` as an absolute fallback. */
export function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      crypto.getRandomValues(bytes);
      return bytes;
    }
  } catch {
    /* fall through */
  }
  for (let i = 0; i < length; i += 1) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

function formatDeviceId(hex: string): string {
  return `DEV-${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}`.toUpperCase();
}

export async function generateDeviceId(rawPublicKey: Uint8Array): Promise<string> {
  if (!hasWebCrypto()) {
    return formatDeviceId(bytesToHex(randomBytes(8)));
  }
  const hash = await sha256(rawPublicKey);
  const hex = arrayBufferToHex(hash);
  // Format: DEV-XXXX-XXXX-XXXX-XXXX (Deterministic cryptographic fingerprint)
  return formatDeviceId(hex);
}

/** Writes the identity to the vault and to the localStorage backup. Never throws. */
async function persistIdentity(identity: IdentityRecord, privateJwk?: JsonWebKey): Promise<void> {
  try {
    await db.identity.put(identity);
  } catch (err) {
    console.warn('Identity vault write warning:', err);
  }
  try {
    localStorage.setItem(STORAGE_KEY_DEV_ID, identity.deviceId);
    localStorage.setItem(STORAGE_KEY_PUB, identity.publicKeyRaw);
    if (privateJwk) localStorage.setItem(STORAGE_KEY_PRIV_JWK, JSON.stringify(privateJwk));
    if (identity.displayName) localStorage.setItem(STORAGE_KEY_NAME, identity.displayName);
    if (identity.avatarColor) localStorage.setItem(STORAGE_KEY_COLOR, identity.avatarColor);
  } catch {
    /* storage blocked - the vault above is the source of truth */
  }
}

/** Identity for browsers without WebCrypto: everything local works, pairing needs https. */
function buildKeylessIdentity(
  customDisplayName?: string,
  customAvatarColor?: string,
  deviceId?: string
): IdentityRecord {
  const raw = randomBytes(32);
  return {
    deviceId: deviceId || formatDeviceId(bytesToHex(raw)),
    publicKeyECDSA: null,
    privateKeyECDSA: null,
    publicKeyRaw: arrayBufferToBase64(raw),
    displayName: customDisplayName,
    avatarColor: customAvatarColor,
    statusBio: undefined,
    createdAt: Date.now(),
  };
}

export async function getOrCreateIdentity(customDisplayName?: string, customAvatarColor?: string): Promise<IdentityRecord> {
  // Single-flight guard: React strict mode mounts twice in development and a
  // concurrent second call must never mint a second device identity.
  if (!identityBootstrap) {
    identityBootstrap = bootstrapIdentity(customDisplayName, customAvatarColor).catch((err) => {
      identityBootstrap = null;
      throw err;
    });
  }
  return identityBootstrap;
}

let identityBootstrap: Promise<IdentityRecord> | null = null;

/** Drops the cached bootstrap promise after a local vault wipe. */
export function resetIdentityBootstrap(): void {
  identityBootstrap = null;
}

async function bootstrapIdentity(customDisplayName?: string, customAvatarColor?: string): Promise<IdentityRecord> {
  const cryptoReady = hasWebCrypto();

  // 1. Check the local vault first. A missing keypair only matters when the
  //    browser could actually give us one.
  try {
    const existingList = await db.identity.toArray();
    if (existingList.length > 0) {
      const current = existingList[0];
      if (current && current.deviceId) {
        const hasKeys = !!current.publicKeyECDSA && !!current.privateKeyECDSA;

        if (!hasKeys && cryptoReady) {
          // The device was first opened in a context without WebCrypto.
          // Upgrade it with real keys, keeping the same device id.
          try {
            const keyPair = (await crypto.subtle.generateKey(
              { name: 'ECDSA', namedCurve: 'P-256' },
              true,
              ['sign', 'verify']
            )) as CryptoKeyPair;
            const rawPubBytes = new Uint8Array(await crypto.subtle.exportKey('raw', keyPair.publicKey));
            current.publicKeyECDSA = keyPair.publicKey;
            current.privateKeyECDSA = keyPair.privateKey;
            current.publicKeyRaw = arrayBufferToBase64(rawPubBytes);
            const privJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);
            await persistIdentity(current, privJwk);
          } catch (err) {
            console.warn('Identity key upgrade warning:', err);
          }
          return current;
        }

        if (hasKeys || !cryptoReady) {
          if (customDisplayName && !current.displayName) {
            current.displayName = customDisplayName;
            if (customAvatarColor) current.avatarColor = customAvatarColor;
            await persistIdentity(current);
          }
          return current;
        }
      }
    }
  } catch (e) {
    console.warn('Identity vault lookup warning:', e);
  }

  // 2. Check the localStorage backup if the vault was cleared or is fresh
  try {
    const savedPrivJwk = cryptoReady ? localStorage.getItem(STORAGE_KEY_PRIV_JWK) : null;
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

      await persistIdentity(identity, jwk);
      return identity;
    }
  } catch (e) {
    console.warn('LocalStorage backup recovery warning:', e);
  }

  // 3. No WebCrypto: create a keyless device so the app is still usable.
  if (!cryptoReady) {
    const identity = buildKeylessIdentity(customDisplayName, customAvatarColor);
    await persistIdentity(identity);
    return identity;
  }

  // 4. Generate new permanent ECDSA keypair (extractable for deterministic durability)
  try {
    return await generateFreshIdentity(customDisplayName, customAvatarColor);
  } catch (err) {
    console.warn('ECDSA generation failed, falling back to a keyless device:', err);
    const identity = buildKeylessIdentity(customDisplayName, customAvatarColor);
    await persistIdentity(identity);
    return identity;
  }
}

async function generateFreshIdentity(
  customDisplayName?: string,
  customAvatarColor?: string
): Promise<IdentityRecord> {
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

  await persistIdentity(identity, privJwk);

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
  let list = await db.identity.toArray();
  if (list.length === 0) {
    // The vault was cleared while the app was open: rebuild the identity first
    // so saving a profile always succeeds.
    await getOrCreateIdentity(displayName, avatarColor);
    list = await db.identity.toArray();
    if (list.length === 0) return null;
  }
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

  // Propagate the new profile look to every contact-shaped view immediately.
  updateProfileCache(current);

  return current;
}

function updateProfileCache(current: IdentityRecord) {
  setProfileCache(current.deviceId, {
    avatarUrl: current.avatarUrl,
    avatarColor: current.avatarColor,
  });
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
