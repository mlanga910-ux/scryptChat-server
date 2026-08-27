export interface DerivedDirectionalKeys {
  keyAES: CryptoKey;
  keyRaw: Uint8Array; // 32 bytes
  prefix: Uint8Array; // 4 bytes
}

export interface SessionKeyDerivationResult {
  keyA2B: DerivedDirectionalKeys;
  keyB2A: DerivedDirectionalKeys;
}

export async function deriveSessionKeys(
  ourEphemeralPrivateKey: CryptoKey,
  peerEphemeralPublicKey: CryptoKey,
  handshakeSalt: Uint8Array, // 32 bytes
  transcriptHash: Uint8Array // 32 bytes
): Promise<SessionKeyDerivationResult> {
  // 1. ECDH Shared Secret (256 bits = 32 bytes)
  const sharedSecretBuffer = await crypto.subtle.deriveBits(
    {
      name: 'ECDH',
      public: peerEphemeralPublicKey,
    },
    ourEphemeralPrivateKey,
    256
  );

  // 2. Import Shared Secret as HKDF base key
  const hkdfKey = await crypto.subtle.importKey(
    'raw',
    sharedSecretBuffer,
    'HKDF',
    false,
    ['deriveBits']
  );

  // 3. Build Info A2B and Info B2A
  // Info_A2B = "DevTChat/3.0/A2B/" || TranscriptHash
  // Info_B2A = "DevTChat/3.0/B2A/" || TranscriptHash
  const enc = new TextEncoder();
  const tagA2B = enc.encode('DevTChat/3.0/A2B/');
  const tagB2A = enc.encode('DevTChat/3.0/B2A/');

  const infoA2B = new Uint8Array(tagA2B.length + transcriptHash.length);
  infoA2B.set(tagA2B, 0);
  infoA2B.set(transcriptHash, tagA2B.length);

  const infoB2A = new Uint8Array(tagB2A.length + transcriptHash.length);
  infoB2A.set(tagB2A, 0);
  infoB2A.set(transcriptHash, tagB2A.length);

  // 4. HKDF-Expand 36 bytes for A2B
  const derivedA2BBuffer = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: handshakeSalt,
      info: infoA2B,
    },
    hkdfKey,
    36 * 8
  );

  const rawDerivedA2B = new Uint8Array(derivedA2BBuffer);
  const keyRawA2B = rawDerivedA2B.slice(0, 32);
  const prefixA2B = rawDerivedA2B.slice(32, 36);

  const keyA2B = await crypto.subtle.importKey(
    'raw',
    keyRawA2B,
    'AES-GCM',
    false,
    ['encrypt', 'decrypt']
  );

  // 5. HKDF-Expand 36 bytes for B2A
  const derivedB2ABuffer = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: handshakeSalt,
      info: infoB2A,
    },
    hkdfKey,
    36 * 8
  );

  const rawDerivedB2A = new Uint8Array(derivedB2ABuffer);
  const keyRawB2A = rawDerivedB2A.slice(0, 32);
  const prefixB2A = rawDerivedB2A.slice(32, 36);

  const keyB2A = await crypto.subtle.importKey(
    'raw',
    keyRawB2A,
    'AES-GCM',
    false,
    ['encrypt', 'decrypt']
  );

  return {
    keyA2B: {
      keyAES: keyA2B,
      keyRaw: keyRawA2B,
      prefix: prefixA2B,
    },
    keyB2A: {
      keyAES: keyB2A,
      keyRaw: keyRawB2A,
      prefix: prefixB2A,
    },
  };
}
