import { uint64ToBigEndianBytes } from './utils';

/**
 * How far around the expected nonce counter a frame may be found.
 *
 * A frame's counter is allocated the moment it is encrypted, but the bytes only
 * reach the wire after an await. A heartbeat, an ACK or a text message can
 * therefore overtake the chunk it was encrypted after, and the receiver sees a
 * counter slightly out of order. This window absorbs that reordering (and a
 * chunk that was skipped) without ever accepting an old frame: anything at or
 * below `highest - WINDOW` is refused, which keeps replay protection bounded
 * and predictable.
 */
const RECV_COUNTER_WINDOW = 32n;

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
  /** Highest counter ever accepted, which bounds the replay window. */
  private highestRecvCounter: bigint = -1n;
  /**
   * Incoming frames are authenticated one at a time.
   *
   * `onmessage` fires for every frame without waiting for the previous handler,
   * so without this queue several frames began decrypting at the same counter:
   * the first succeeded and every other frame in the burst failed its tag check
   * and was silently dropped. That is why a single-frame message always worked
   * while a multi-frame file transfer crawled and lost chunks.
   */
  private recvQueue: Promise<unknown> = Promise.resolve();

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
  public decryptFrame(
    header24Bytes: Uint8Array,
    ciphertextWithTag: Uint8Array,
    sequenceCounter?: bigint
  ): Promise<Uint8Array> {
    const run = this.recvQueue.then(() =>
      this.decryptFrameLocked(header24Bytes, ciphertextWithTag, sequenceCounter)
    );
    // One bad frame must never stall the frames behind it.
    this.recvQueue = run.catch(() => undefined);
    return run;
  }

  /** One authentication attempt with one counter. `null` means "not this one". */
  private async tryDecrypt(
    counter: bigint,
    header24Bytes: Uint8Array,
    ciphertextWithTag: Uint8Array
  ): Promise<Uint8Array | null> {
    if (counter < 0n) return null;
    try {
      const plaintext = await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: this.buildNonce(this.recvPrefix, counter),
          additionalData: header24Bytes,
          tagLength: 128,
        },
        this.recvKey,
        ciphertextWithTag
      );
      return new Uint8Array(plaintext);
    } catch {
      return null;
    }
  }

  private noteReceived(counter: bigint): void {
    if (counter > this.highestRecvCounter) this.highestRecvCounter = counter;
    this.expectedRecvCounter = this.highestRecvCounter + 1n;
  }

  private async decryptFrameLocked(
    header24Bytes: Uint8Array,
    ciphertextWithTag: Uint8Array,
    sequenceCounter?: bigint
  ): Promise<Uint8Array> {
    if (this.isTerminated) {
      throw new Error('Crypto session is terminated.');
    }

    // A caller that pinned the counter owns the ordering; just try that one.
    if (sequenceCounter !== undefined) {
      const plaintext = await this.tryDecrypt(sequenceCounter, header24Bytes, ciphertextWithTag);
      if (!plaintext) {
        throw new Error('AES-GCM Decryption / AAD Verification failed: wrong counter.');
      }
      this.noteReceived(sequenceCounter);
      return plaintext;
    }

    const expected = this.expectedRecvCounter;
    const floor = this.highestRecvCounter - RECV_COUNTER_WINDOW;
    // In-order traffic succeeds on the first attempt; the window only matters
    // for a frame that was encrypted slightly before or after its neighbours.
    for (let distance = 0n; distance <= RECV_COUNTER_WINDOW; distance += 1n) {
      const forward = expected + distance;
      const plaintext = await this.tryDecrypt(forward, header24Bytes, ciphertextWithTag);
      if (plaintext) {
        this.noteReceived(forward);
        return plaintext;
      }
      if (distance === 0n) continue;
      const backward = expected - distance;
      if (backward <= floor) continue;
      const older = await this.tryDecrypt(backward, header24Bytes, ciphertextWithTag);
      if (older) {
        this.noteReceived(backward);
        return older;
      }
    }

    throw new Error('AES-GCM Decryption / AAD Verification failed: no matching counter.');
  }

  public destroy(): void {
    this.isTerminated = true;
    this.highestRecvCounter = -1n;
    // Overwrite prefix caches if possible
    this.sendPrefix.fill(0);
    this.recvPrefix.fill(0);
  }
}
