/**
 * Headless check of the attachment pipeline.
 * ---------------------------------------------------------------------------
 * Two "devices" run the real protocol engine (`FileTransferManager`) and real
 * AES-GCM sessions (`CryptoSession`) against each other over an in-process data
 * channel pair. Only the transport is faked - there is no RTCPeerConnection in
 * Node - so everything measured here is the code that ships: framing, chunking,
 * acknowledgements, hashing, the completion hand-over and the conversation merge
 * that decides whether a photo ever leaves its loading placeholder.
 *
 * Run with:  bun scripts/transfer-check.ts
 */
import { CryptoSession } from '../src/crypto/session';
import { FileTransferManager, FileCompletionMeta } from '../src/protocol/fileTransfer';
import { parsePacketHeader } from '../src/protocol/packet';
import { db } from '../src/db/index';
import { PacketType, FileRecord, MessageRecord } from '../src/types/index';
import { mergeMessageRow } from '../src/utils/messageMerge';

// Node has no Blob URL registry; the engine only uses it for previews.
if (typeof (URL as any).createObjectURL !== 'function') {
  (URL as any).createObjectURL = () => 'blob:harness';
  (URL as any).revokeObjectURL = () => {};
}

/**
 * exifr expects a browser and reports its absence through a logged warning; the
 * engine already treats missing metadata as "no metadata", so nothing here has
 * to pretend otherwise. Noise is filtered when reading this output.
 */

/** Waits for a condition to hold, so a test never reads state mid-flight. */
async function waitUntil(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return predicate();
}

const CHROME_FRAME_LIMIT = 64 * 1024;
const PHOTO_BYTES = 6 * 1024 * 1024;
const MESSAGE_ID = 'msg_harness_photo_1';

let failures = 0;
let exifSkips = 0;

// The engine asks exifr for photo metadata on every image; exifr needs a browser
// FileReader, which Node does not have. The engine already treats missing
// metadata as "no metadata", so the harness counts these and reports them once
// instead of printing a stack trace per frame.
const realWarn = console.warn.bind(console);
console.warn = (...args: any[]) => {
  if (String(args[0] ?? '').includes('EXIF')) {
    exifSkips += 1;
    return;
  }
  realWarn(...args);
};

function check(label: string, condition: boolean, detail = ''): void {
  if (condition) {
    console.log(`  PASS  ${label}${detail ? ` - ${detail}` : ''}`);
    return;
  }
  failures += 1;
  console.log(`  FAIL  ${label}${detail ? ` - ${detail}` : ''}`);
}

/** One data channel's worth of transport, with the frame limit Chrome reports. */
class FakeDataChannel {
  public readyState: RTCDataChannelState = 'open';
  public bufferedAmount = 0;
  public bufferedAmountLowThreshold = 0;
  public maxMessageSize = CHROME_FRAME_LIMIT;
  public frames = 0;
  public bytes = 0;
  public onFrame: (frame: Uint8Array) => void = () => {};

  constructor(public readonly label: string) {}

  send(frame: Uint8Array): void {
    this.frames += 1;
    this.bytes += frame.byteLength;
    const copy = frame.slice();
    // A real channel hands the frame over asynchronously; doing the same keeps
    // the engine's assumptions about ordering honest.
    setTimeout(() => this.onFrame(copy), 0);
  }

  addEventListener(): void {}
  removeEventListener(): void {}
  close(): void {
    this.readyState = 'closed';
  }
}

/**
 * Frames of one direction are processed one after another, exactly like an
 * ordered SCTP stream on a real data channel.
 */
function serializer(): (task: () => Promise<void>) => void {
  let chain: Promise<void> = Promise.resolve();
  return (task) => {
    chain = chain.then(task).catch((err) => console.error('  (frame error)', err));
  };
}

async function aesKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
    'encrypt',
    'decrypt',
  ]);
}

async function sessionFor(peerDeviceId: string, key: CryptoKey): Promise<CryptoSession> {
  return new CryptoSession({
    sessionId: 0x1234n,
    role: 'initiator',
    sendKey: key,
    sendPrefix: new Uint8Array(4),
    recvKey: key,
    recvPrefix: new Uint8Array(4),
    peerDeviceId,
    transcriptHash: new Uint8Array(32),
    safetyNumber: '000000',
  });
}

function photoBytes(size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i += 1) bytes[i] = (i * 31 + (i >> 8)) & 0xff;
  return bytes;
}

interface RunResult {
  label: string;
  bytes: number;
  elapsedMs: number;
  chunkFrames: number;
  ackFrames: number;
  progressCallbacks: number;
  duplicateChunks: number;
  receivedBytes: number;
  hashMatches: boolean;
  completions: number;
  meta?: FileCompletionMeta;
  storedInVault: boolean;
  /** Throughput recorded on the sender's own record. */
  transferSpeedBps?: number;
}

/**
 * Moves one photo from device A to device B through the real engine.
 *
 * `ackEveryChunks` is the receiver's batch size: the shipped code uses 16, and
 * `1` reproduces the previous behaviour (one encrypted ACK per frame) so the two
 * can be compared on the same machine, with the same crypto and the same file.
 */
async function transferPhoto(options: {
  label: string;
  ackEveryChunks: number;
  receiverStallMs?: number;
  /** SCTP frame limit of the channel: 64 KB on an interop link, 256 KB on modern Chrome. */
  frameLimit?: number;
  /** Size of the file moved, in bytes. */
  fileBytes?: number;
  /** Per-frame cost of the link, in ms. Zero means "as fast as this CPU runs". */
  linkDelayMs?: number;
}): Promise<RunResult> {
  (FileTransferManager as any).ACK_EVERY_CHUNKS = options.ackEveryChunks;

  const sender = new FileTransferManager();
  const receiver = new FileTransferManager();
  const channelA = new FakeDataChannel('A->B');
  const channelB = new FakeDataChannel('B->A');
  if (options.frameLimit) {
    channelA.maxMessageSize = options.frameLimit;
    channelB.maxMessageSize = options.frameLimit;
  }
  const payloadBytes = options.fileBytes || PHOTO_BYTES;
  const key = await aesKey();
  const sessionA = await sessionFor('device-b', key);
  const sessionB = await sessionFor('device-a', key);

  const stats = {
    chunkFrames: 0,
    ackFrames: 0,
    progressCallbacks: 0,
    duplicateChunks: 0,
    completions: 0,
    meta: undefined as FileCompletionMeta | undefined,
  };
  let receivedBytes = 0;
  let receivedHash = '';
  let storedInVault = false;
  let stallLeft = options.receiverStallMs || 0;
  const seenChunks = new Set<number>();

  // Every stored attachment is handed over with the metadata that travelled in
  // the header, which is how the conversation finds the bubble to complete.
  receiver.setAttachmentCompletionSink(async (fileRecord, _blob, meta) => {
    stats.completions += 1;
    stats.meta = meta;
    storedInVault = !!(await db.files.get(fileRecord.fileId))?.blobRef;
  });

  const deliverToReceiver = serializer();
  channelA.onFrame = (frame) => {
    deliverToReceiver(async () => {
      const header = parsePacketHeader(frame.slice(0, 24));
      if (header.packetType === PacketType.FILE_CHUNK) {
        if (seenChunks.has(header.sequenceIndex)) stats.duplicateChunks += 1;
        seenChunks.add(header.sequenceIndex);
        stats.chunkFrames += 1;
        if (stallLeft > 0) {
          // One hiccup, like a phone that briefly loses the foreground.
          const pause = stallLeft;
          stallLeft = 0;
          await new Promise((resolve) => setTimeout(resolve, pause));
        }
      }
      if (options.linkDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, options.linkDelayMs));
      }
      const payload = await sessionB.decryptFrame(frame.slice(0, 24), frame.slice(24));
      await receiver.handleIncomingPacket(
        header.packetType,
        header.objectId,
        header.sequenceIndex,
        payload,
        channelB as unknown as RTCDataChannel,
        sessionB,
        {
          onProgress: () => {
            stats.progressCallbacks += 1;
          },
          onCompleted: (record) => {
            receivedBytes = record.size;
            receivedHash = record.hashSHA256;
          },
          onError: (_id, error) => {
            console.log(`  (receiver error) ${error}`);
          },
        }
      );
    });
  };

  const deliverToSender = serializer();
  channelB.onFrame = (frame) => {
    deliverToSender(async () => {
      const header = parsePacketHeader(frame.slice(0, 24));
      if (header.packetType === PacketType.CHUNK_ACK) stats.ackFrames += 1;
      const payload = await sessionA.decryptFrame(frame.slice(0, 24), frame.slice(24));
      await sender.handleIncomingPacket(
        header.packetType,
        header.objectId,
        header.sequenceIndex,
        payload,
        channelA as unknown as RTCDataChannel,
        sessionA
      );
    });
  };

  const bytes = photoBytes(payloadBytes);
  const file = new File([bytes], 'holiday-photo.jpg', { type: 'image/jpeg' });

  const startedAt = Date.now();
  if (process.env.HARNESS_TRACE) console.log('  [trace] setup done, sending');
  const sent: FileRecord = await sender.sendFile(
    file,
    channelA as unknown as RTCDataChannel,
    sessionA,
    {
      onProgress: () => {},
      onError: (_id, error) => {
        console.log(`  (sender error) ${error}`);
      },
    },
    {
      isLan: true,
      meta: {
        messageId: MESSAGE_ID,
        senderDeviceId: 'device-a',
        senderDisplayName: 'Harness A',
      },
    }
  );
  if (process.env.HARNESS_TRACE) console.log('  [trace] sendFile resolved');
  // The sender finishes once the last chunk is acknowledged, which happens a
  // moment before the receiver finishes verifying and storing: wait for the
  // whole pipeline, not just one side of it.
  await waitUntil(
    () => stats.completions > 0 || receivedBytes > 0,
    20_000
  );
  const elapsedMs = Date.now() - startedAt;

  return {
    label: options.label,
    elapsedMs,
    chunkFrames: stats.chunkFrames,
    ackFrames: stats.ackFrames,
    progressCallbacks: stats.progressCallbacks,
    duplicateChunks: stats.duplicateChunks,
    bytes: payloadBytes,
    receivedBytes,
    hashMatches: receivedHash === sent.hashSHA256 && receivedHash.length === 64,
    completions: stats.completions,
    meta: stats.meta,
    storedInVault,
    transferSpeedBps: sent.transferSpeedBps,
  };
}

function report(result: RunResult): void {
  const mbps = (
    ((result.bytes / 1024 / 1024) / Math.max(result.elapsedMs, 1)) *
    1000
  ).toFixed(1);
  console.log(
    `  ${result.label}: ${result.elapsedMs} ms (${mbps} MB/s in-process), ` +
      `${result.chunkFrames} chunk frames, ${result.ackFrames} ACK frames, ` +
      `${result.progressCallbacks} progress repaints, ` +
      `${result.duplicateChunks} retransmissions`
  );
}

async function main(): Promise<void> {
  console.log('\n0. A burst of frames all authenticate (the multi-frame race)');
  {
    // `onmessage` is fired for every frame without waiting for the previous
    // handler, so a batch of frames really does start decrypting at once. Each
    // one must still find its own nonce: when they all read the same counter,
    // one frame succeeds and the rest are silently dropped - which is exactly
    // what a real file transfer looked like from the user's side.
    const key = await aesKey();
    const session = await sessionFor('device-self', key);
    const FRAMES = 200;
    const text = (i: number) => `frame-${i}-${'x'.repeat(512)}`;
    const frames: Array<{ header: Uint8Array; body: Uint8Array; text: string }> = [];
    for (let i = 0; i < FRAMES; i += 1) {
      const header = new Uint8Array(24);
      header[0] = (i >> 8) & 0xff;
      header[1] = i & 0xff;
      const body = new TextEncoder().encode(text(i));
      const encrypted = await session.encryptFrame(header, body);
      frames.push({ header, body: encrypted.slice(24), text: text(i) });
    }

    const decoded = await Promise.all(
      frames.map((frame) => session.decryptFrame(frame.header, frame.body))
    );
    const allOk = decoded.every(
      (bytes, i) => new TextDecoder().decode(bytes) === frames[i].text
    );
    const delivered = decoded.filter((bytes) => bytes.byteLength > 0).length;
    check('every concurrent frame authenticates', allOk, `${delivered}/${FRAMES} frames`);

    // A frame can also overtake its neighbour (it was encrypted first, sent
    // second). A small reorder must be absorbed, not turned into a lost chunk.
    const reordered: typeof frames = [];
    for (let i = 0; i < frames.length; i += 2) {
      const a = frames[i];
      const b = frames[i + 1];
      reordered.push(b || a);
      if (b) reordered.push(a);
    }
    const session2 = await sessionFor('device-self', key);
    const swapped = await Promise.all(
      reordered.map((frame) => session2.decryptFrame(frame.header, frame.body))
    );
    const swappedOk = swapped.every((bytes, i) => {
      const expected = reordered[i];
      return expected ? new TextDecoder().decode(bytes) === expected.text : true;
    });
    check('a slightly reordered frame still authenticates', swappedOk);
  }

  console.log('\n1. A photo lands in the bubble that was already announced');
  {
    // What the sender pushes first: a thumbnail and a placeholder.
    const announced: MessageRecord = {
      messageId: MESSAGE_ID,
      chatDeviceId: 'device-a',
      direction: 'INBOUND',
      payloadText: 'holiday-photo.jpg',
      fileId: 'AAAA1111BBBB2222',
      fileRecord: {
        fileId: 'AAAA1111BBBB2222',
        name: 'holiday-photo.jpg',
        size: PHOTO_BYTES,
        mimeType: 'image/jpeg',
        hashSHA256: '',
        previewUrl: 'data:image/jpeg;base64,AA',
        isImage: true,
      },
      mediaType: 'image',
      timestamp: Date.now(),
      status: 'delivered',
      attachmentState: 'receiving',
    };
    let rows = mergeMessageRow([], announced);

    // Then the bytes arrive and the engine hands the complete record over.
    const completed: MessageRecord = {
      ...announced,
      fileRecord: { ...announced.fileRecord!, hashSHA256: 'f'.repeat(64) },
      attachmentState: 'ready',
    };
    rows = mergeMessageRow(rows, completed);

    check('exactly one bubble after the bytes land', rows.length === 1, `${rows.length} row(s)`);
    check('the bubble is complete, not still receiving', rows[0].attachmentState === 'ready');
    check(
      'the thumbnail is kept',
      rows[0].fileRecord?.previewUrl === announced.fileRecord!.previewUrl
    );

    // A relay re-delivery of the same message must not add a twin.
    rows = mergeMessageRow(rows, completed);
    check('re-delivery adds no twin', rows.length === 1, `${rows.length} row(s)`);

    rows = mergeMessageRow(rows, { ...completed, messageId: 'msg_other', id: 2 });
    check('a different message is appended', rows.length === 2, `${rows.length} row(s)`);
  }

  const median = (values: number[]): number => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  };

  console.log('\n2. Real transfer over a Chromium-sized channel (~64 KB frames)');
  const shippedRuns: RunResult[] = [];
  for (let i = 0; i < 3; i += 1) {
    shippedRuns.push(await transferPhoto({ label: `shipped run ${i + 1}`, ackEveryChunks: 16 }));
  }
  const shipped = shippedRuns[0];
  report(shipped);
  check('the file arrives complete', shipped.receivedBytes === PHOTO_BYTES);
  check('the receiver verifies the sender hash', shipped.hashMatches);
  check('the receiver stores it in the local vault', shipped.storedInVault);
  check(
    'the completion carries the sender message id',
    shipped.meta?.messageId === MESSAGE_ID,
    String(shipped.meta?.messageId)
  );
  check(
    'the stored record carries the measured throughput',
    !!shipped.transferSpeedBps && shipped.transferSpeedBps > 0,
    `${((shipped.transferSpeedBps || 0) / 1024 / 1024).toFixed(1)} MB/s`
  );
  check('one completion, one bubble', shipped.completions === 1, `${shipped.completions}`);
  check('no retransmissions', shipped.duplicateChunks === 0, `${shipped.duplicateChunks}`);

  console.log('\n3. Previous behaviour (one ACK per chunk) on the same machine');
  const legacyRuns: RunResult[] = [];
  for (let i = 0; i < 3; i += 1) {
    legacyRuns.push(await transferPhoto({ label: `legacy run ${i + 1}`, ackEveryChunks: 1 }));
  }
  const legacy = legacyRuns[0];
  report(legacy);
  check('legacy still delivers the file', legacy.receivedBytes === PHOTO_BYTES);
  const ackSaving = Math.round((1 - shipped.ackFrames / Math.max(legacy.ackFrames, 1)) * 100);
  console.log(
    `  -> ACK frames on the wire: ${legacy.ackFrames} -> ${shipped.ackFrames} ` +
      `(${ackSaving}% fewer); median time over 3 in-process runs ` +
      `${median(legacyRuns.map((r) => r.elapsedMs))} ms -> ${median(shippedRuns.map((r) => r.elapsedMs))} ms ` +
      `(same CPU, no link cost - the saving shows up as frames, not as wall clock)`
  );
  console.log(
    `  -> the receiver now reports progress ${shipped.progressCallbacks} times for ` +
      `${shipped.chunkFrames} chunk frames, where it previously reported once per frame`
  );

  console.log('\n4. A link slow enough to take seconds (8 ms per frame, like a WAN)');
  const slowLegacy = await transferPhoto({
    label: 'legacy over a slow link',
    ackEveryChunks: 1,
    linkDelayMs: 8,
  });
  const slowShipped = await transferPhoto({
    label: 'shipped over a slow link',
    ackEveryChunks: 16,
    linkDelayMs: 8,
  });
  report(slowLegacy);
  report(slowShipped);
  check('slow link still delivers the photo', slowShipped.receivedBytes === PHOTO_BYTES);
  console.log(
    `  -> over a link that takes seconds the receiver repaints ` +
      `${slowShipped.progressCallbacks} times for ${slowShipped.chunkFrames} frames ` +
      `(one per frame before), and the ACK count drops ${slowLegacy.ackFrames} -> ${slowShipped.ackFrames}`
  );

  console.log('\n4b. Modern Chrome (~256 KB frames) moving a 24 MB video');
  const video = await transferPhoto({
    label: 'shipped, 256 KB frames',
    ackEveryChunks: 16,
    frameLimit: 256 * 1024,
    fileBytes: 24 * 1024 * 1024,
  });
  report(video);
  check('the video arrives complete', video.receivedBytes === 24 * 1024 * 1024);
  check('the receiver verifies the sender hash', video.hashMatches);
  check('still exactly one completion', video.completions === 1, `${video.completions}`);
  check('still no retransmissions', video.duplicateChunks === 0, `${video.duplicateChunks}`);

  console.log('\n5. Receiver hiccups mid-photo and still finishes');
  const stalled = await transferPhoto({
    label: 'shipped with a 400 ms receiver hiccup',
    ackEveryChunks: 16,
    receiverStallMs: 400,
  });
  report(stalled);
  check('the file still arrives complete', stalled.receivedBytes === PHOTO_BYTES);
  check('still exactly one completion', stalled.completions === 1, `${stalled.completions}`);
  check('still no retransmissions', stalled.duplicateChunks === 0, `${stalled.duplicateChunks}`);
  check('the bubble still gets the sender message id', stalled.meta?.messageId === MESSAGE_ID);

  if (exifSkips > 0) {
    console.log(
      `Note: ${exifSkips} EXIF read(s) were skipped - Node has no FileReader, and the\n` +
        `engine treats missing photo metadata as "no metadata", exactly as a browser\n` +
        `does for a picture without an EXIF block.\n`
    );
  }
  console.log(failures === 0 ? `All checks passed.\n` : `${failures} check(s) failed.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

process.on('unhandledRejection', (err) => console.error('UNHANDLED REJECTION', err));
process.on('uncaughtException', (err) => console.error('UNCAUGHT', err));

main().catch((err) => {
  console.error('Harness failed:', err);
  process.exit(1);
});
