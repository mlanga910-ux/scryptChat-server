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

/**
 * IndexedDB can store CryptoKey objects natively, but not every browser does it
 * reliably — some browsers or private-browsing modes return a plain object
 * (e.g. the JWK representation) instead of a live CryptoKey instance.  When
 * that happens, `crypto.subtle.sign()` throws the exact "parameter 2 is not of
 * type 'CryptoKey'" error users have been seeing during pairing.
 *
 * This helper detects the problem so we can re-import from the JWK backup.
 */
function isRealCryptoKey(value: unknown): boolean {
  try {
    return value instanceof CryptoKey;
  } catch {
    // Some browsers throw when checking instanceof on cross-realm objects.
    return !!(value as any)?.type && !!(value as any)?.algorithm?.name;
  }
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

/**
 * Re-imports CryptoKey objects for an identity from the JWK stored in
 * localStorage.  This is the safety net when IndexedDB returns a plain-object
 * representation instead of a live CryptoKey.
 */
export async function reimportIdentityKeys(identity: IdentityRecord): Promise<void> {
  const savedPrivJwk = localStorage.getItem(STORAGE_KEY_PRIV_JWK);
  if (!savedPrivJwk) {
    throw new Error('No private key JWK in localStorage – cannot re-import.');
  }

  const jwk = JSON.parse(savedPrivJwk);
  identity.privateKeyECDSA = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign']
  );

  const rawPubBytes = base64ToArrayBuffer(identity.publicKeyRaw);
  identity.publicKeyECDSA = await crypto.subtle.importKey(
    'raw',
    rawPubBytes,
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['verify']
  );

  // Persist the freshly-imported keys back to IndexedDB so subsequent loads
  // work without hitting this path again.
  await persistIdentity(identity, jwk);
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

/** Everything the profile screen needs to explain the state of the local keys. */
export type KeyHealthState = 'healthy' | 'missing' | 'broken' | 'unsupported';

export interface KeyHealth {
  state: KeyHealthState;
  /** True when this device can actually take part in a pairing handshake. */
  pairingReady: boolean;
  /** One plain sentence, safe to show to the user. */
  detail: string;
}

/** Fixed challenge for the self-test; never leaves the device. */
const KEY_SELF_TEST = 'scryptchat-key-self-test';

/** Signs and verifies with the *stored* keys, healing a stubbed key on the way. */
async function workingPrivateKey(identity: IdentityRecord): Promise<CryptoKey> {
  const stored = identity.privateKeyECDSA as unknown;
  if (isRealCryptoKey(stored)) return stored as CryptoKey;
  // IndexedDB can hand back a plain object instead of a live CryptoKey. The JWK
  // backup recovers it, which is exactly what pairing needs before it starts.
  await reimportIdentityKeys(identity);
  if (!isRealCryptoKey(identity.privateKeyECDSA)) {
    throw new Error('The stored private key could not be restored.');
  }
  return identity.privateKeyECDSA as CryptoKey;
}

/**
 * Proves the local keypair works, instead of guessing from a later failure.
 *
 * A device key can be missing, stubbed by the browser's storage layer, or
 * genuinely unusable. Only the last case deserves a "your keys are corrupted"
 * warning, and the only honest way to tell them apart is to sign something and
 * verify it with the stored public key - which is what this does.
 */
export async function checkIdentityKeys(identity: IdentityRecord | null): Promise<KeyHealth> {
  if (!hasWebCrypto()) {
    return {
      state: 'unsupported',
      pairingReady: false,
      detail:
        'This browser context has no WebCrypto, so pairing cannot use a device key. Open the app over https (or localhost).',
    };
  }

  if (!identity?.deviceId || !identity.publicKeyECDSA || !identity.privateKeyECDSA) {
    return {
      state: 'missing',
      pairingReady: false,
      detail: 'No device keypair is stored on this device yet.',
    };
  }

  try {
    const payload = new TextEncoder().encode(`${KEY_SELF_TEST}:${identity.deviceId}`);
    const privateKey = await workingPrivateKey(identity);
    const signature = await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      privateKey,
      payload
    );
    const verified = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      identity.publicKeyECDSA,
      signature,
      payload
    );
    if (verified) {
      return {
        state: 'healthy',
        pairingReady: true,
        detail: 'Signing and verification both work with the keys stored here.',
      };
    }
    return {
      state: 'broken',
      pairingReady: false,
      detail: 'The stored keypair did not pass a signing check.',
    };
  } catch (err) {
    return {
      state: 'broken',
      pairingReady: false,
      detail: `The stored keypair could not be used: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Replaces this device's keypair with a brand new one.
 *
 * It has to remove the identity from the vault as well as from the localStorage
 * backup - clearing only the backup left the old, unusable identity in
 * IndexedDB, which is why the warning used to come straight back after a reload.
 * The profile itself (name, photo, bio, status) is kept: only the keys change.
 * The new keypair is verified before this resolves, so the caller can report the
 * truth instead of "try reloading".
 */
export async function regenerateIdentityKeys(): Promise<{
  identity: IdentityRecord;
  health: KeyHealth;
}> {
  let previousName: string | undefined;
  let previousColor: string | undefined;
  try {
    previousName = localStorage.getItem(STORAGE_KEY_NAME) || undefined;
    previousColor = localStorage.getItem(STORAGE_KEY_COLOR) || undefined;
  } catch {
    /* storage blocked: the vault still holds the profile */
  }

  try {
    await db.identity.clear();
  } catch (err) {
    console.warn('Identity vault clear warning:', err);
  }
  try {
    localStorage.removeItem(STORAGE_KEY_PRIV_JWK);
    localStorage.removeItem(STORAGE_KEY_PUB);
    localStorage.removeItem(STORAGE_KEY_DEV_ID);
  } catch {
    /* nothing else to clear */
  }

  resetIdentityBootstrap();
  const identity = await getOrCreateIdentity(previousName, previousColor);
  const health = await checkIdentityKeys(identity);
  return { identity, health };
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
          // Even when IndexedDB reports keys, they may not be live CryptoKey
          // instances — a known issue in some browsers / private modes. Re-import
          // them from the JWK backup stored in localStorage.
          if (cryptoReady) {
            const pubValid = isRealCryptoKey(current.publicKeyECDSA);
            const privValid = isRealCryptoKey(current.privateKeyECDSA);
            if (!pubValid || !privValid) {
              try {
                await reimportIdentityKeys(current);
              } catch (err) {
                console.warn('Key re-import warning:', err);
              }
            }
          }

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
