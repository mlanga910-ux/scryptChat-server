import { uint64ToBigEndianBytes } from './utils';

export interface CryptoSessionConfig {
  sessionId: bigint; // 64-bit BigInt
  role: 'initiator' | 'responder'; // Initiator is A, Responder is B
  sendKey: CryptoKey;
  sendPrefix: Uint8Array; // 4 bytes
  recvKey: CryptoKey;
  recvPrefix: Uint8Array; // 4 bytes
  peerDeviceId: string;
  transcriptHash: Uint8Array;
  safetyNumber: string;
}

export class CryptoSession {
  public sessionId: bigint;
  public role: 'initiator' | 'responder';
  public peerDeviceId: string;
  public transcriptHash: Uint8Array;
  public safetyNumber: string;

  private sendKey: CryptoKey;
  private sendPrefix: Uint8Array;
  private sendCounter: bigint = 0n;

  private recvKey: CryptoKey;
  private recvPrefix: Uint8Array;
  private expectedRecvCounter: bigint = 0n;

  private isTerminated = false;

  constructor(config: CryptoSessionConfig) {
    this.sessionId = config.sessionId;
    this.role = config.role;
    this.sendKey = config.sendKey;
    this.sendPrefix = config.sendPrefix;
    this.recvKey = config.recvKey;
    this.recvPrefix = config.recvPrefix;
    this.peerDeviceId = config.peerDeviceId;
    this.transcriptHash = config.transcriptHash;
    this.safetyNumber = config.safetyNumber;
  }

  private buildNonce(prefix: Uint8Array, counter: bigint): Uint8Array {
    const nonce = new Uint8Array(12); // 96 bits
    nonce.set(prefix.slice(0, 4), 0);
    const counterBytes = uint64ToBigEndianBytes(counter);
    nonce.set(counterBytes, 4);
    return nonce;
  }

  public getNextSendCounter(): bigint {
    return this.sendCounter;
  }

  /**
   * Encrypts plaintext bytes using directional send key, current monotonic counter, and AAD header.
   * Increments the send counter.
   */
  public async encryptFrame(
    header24Bytes: Uint8Array,
    plaintextPayload: Uint8Array
  ): Promise<Uint8Array> {
    if (this.isTerminated) {
      throw new Error('Crypto session is terminated.');
    }

    if (this.sendCounter >= 0xffffffffffffffffn) {
      this.isTerminated = true;
      throw new Error('Send counter reached 2^64 - 1 limit. Session must be renegotiated.');
    }

    const currentCounter = this.sendCounter;
    this.sendCounter += 1n;

    const nonce = this.buildNonce(this.sendPrefix, currentCounter);

    // AES-256-GCM encryption with AAD binding (the 24-byte wire header)
    const ciphertext = await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: nonce,
        additionalData: header24Bytes,
        tagLength: 128,
      },
      this.sendKey,
      plaintextPayload
    );

    const ciphertextBytes = new Uint8Array(ciphertext);
    const frame = new Uint8Array(header24Bytes.length + ciphertextBytes.length);
    frame.set(header24Bytes, 0);
    frame.set(ciphertextBytes, header24Bytes.length);

    return frame;
  }

  /**
   * Decrypts an incoming frame. Verifies AAD header, nonce counter, and GCM auth tag.
   */
  public async decryptFrame(
    header24Bytes: Uint8Array,
    ciphertextWithTag: Uint8Array,
    sequenceCounter?: bigint
  ): Promise<Uint8Array> {
    if (this.isTerminated) {
      throw new Error('Crypto session is terminated.');
    }

    // Determine counter to use
    const counterToUse = sequenceCounter !== undefined ? sequenceCounter : this.expectedRecvCounter;
    const nonce = this.buildNonce(this.recvPrefix, counterToUse);

    try {
      const plaintext = await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: nonce,
          additionalData: header24Bytes,
          tagLength: 128,
        },
        this.recvKey,
        ciphertextWithTag
      );

      if (sequenceCounter === undefined || sequenceCounter >= this.expectedRecvCounter) {
        this.expectedRecvCounter = counterToUse + 1n;
      }

      return new Uint8Array(plaintext);
    } catch (err) {
      throw new Error(`AES-GCM Decryption / AAD Verification failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  public destroy(): void {
    this.isTerminated = true;
    // Overwrite prefix caches if possible
    this.sendPrefix.fill(0);
    this.recvPrefix.fill(0);
  }
}
