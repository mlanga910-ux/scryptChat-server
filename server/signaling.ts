import { Router, Request, Response } from 'express';
import { randomBytes, timingSafeEqual } from 'crypto';

interface RoomPeer {
  deviceId: string;
  role: 'initiator' | 'responder';
  offer?: any;
  answer?: any;
  iceCandidates: any[];
  updatedAt: number;
}

interface SignalingRoom {
  roomId: string;
  createdAt: number;
  expiresAt: number; // 15-minute or permanent expiry
  isPermanent?: boolean;
  initiator?: RoomPeer;
  responder?: RoomPeer;
  isConfirmed?: boolean;
  confirmedAt?: number;
  confirmedBy?: string[];
  /**
   * Secret handed to the creator only. It is required to revoke or rotate a
   * permanent link, so knowing (or guessing) the code is not enough to break
   * someone else's invite.
   */
  manageToken?: string;
  /** How many peers have consumed a reusable link. */
  joinCount?: number;
}

interface EncryptedMailboxItem {
  id: string;
  senderDeviceId: string;
  recipientDeviceId: string;
  encryptedEnvelope: string; // Base64 encrypted payload
  fileMetadata?: {
    fileId: string;
    name: string;
    size: number;
    mimeType: string;
    hashSHA256: string;
  };
  fileBase64Chunk?: string; // For small offline file transfers / images
  timestamp: number;
}

const rooms = new Map<string, SignalingRoom>();
// Mailbox store: recipientDeviceId -> array of EncryptedMailboxItem
const mailboxes = new Map<string, EncryptedMailboxItem[]>();
// Device presence store: deviceId -> { lastSeen, online, displayName? }
// `online: false` is written when a device tells us it is leaving (or its push
// stream drops), so peers see "offline" immediately instead of waiting for the
// heartbeat window to lapse.
const devicePresences = new Map<
  string,
  { lastSeen: number; online?: boolean; displayName?: string }
>();
const PRESENCE_WINDOW_MS = 30000;

// Local Network (LAN) discovery registry
interface LanDeviceRecord {
  deviceId: string;
  displayName: string;
  subnetKey: string;
  isVisible: boolean; // Opt-in visibility
  lastSeen: number;
}

interface LanInviteRecord {
  inviteId: string;
  subnetKey: string;
  fromDeviceId: string;
  fromDisplayName: string;
  toDeviceId: string;
  offer: any;
  status: 'pending' | 'accepted' | 'declined';
  answer?: any;
  createdAt: number;
  expiresAt: number;
}

const lanDevices = new Map<string, LanDeviceRecord>();
const lanInvites = new Map<string, LanInviteRecord>();

function clientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  const raw =
    typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : req.socket.remoteAddress || '127.0.0.1';
  return raw.startsWith('::ffff:') ? raw.slice(7) : raw;
}

/**
 * Small sliding-window limiter, keyed by IP + bucket. The signaling relay is
 * unauthenticated by design (pairing happens before any identity exists), so
 * it is rate limited to keep one host from brute forcing codes or flooding
 * the mailbox for everyone else.
 */
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function allowRequest(req: Request, bucket: string, limit: number, windowMs: number): boolean {
  const key = `${bucket}:${clientIp(req)}`;
  const now = Date.now();
  const entry = rateBuckets.get(key);
  if (!entry || now > entry.resetAt) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  entry.count += 1;
  return entry.count <= limit;
}

/** Compares a room management token without leaking timing information. */
function tokenMatches(expected: string | undefined, provided: unknown): boolean {
  if (!expected || typeof provided !== 'string' || provided.length !== expected.length) {
    return false;
  }
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
  } catch {
    return false;
  }
}

/** Readable, unguessable room code (no 0/O/1/I confusion for typed codes). */
const ROOM_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const randomRoomCode = (length: number): string => {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += ROOM_ALPHABET[bytes[i] % ROOM_ALPHABET.length];
  }
  return out;
};

function getClientSubnetKey(req: Request): string {
  let ip = clientIp(req);
  const parts = ip.split('.');
  if (parts.length === 4) {
    return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
  }
  const v6Parts = ip.split(':');
  if (v6Parts.length >= 4) {
    const full = ip.includes('::') ? ip.replace('::', ':' + '0:'.repeat(8 - v6Parts.length + 1)) : ip;
    const expanded = full.split(':');
    if (expanded.length >= 4) {
      return `${expanded[0]}:${expanded[1]}:${expanded[2]}:${expanded[3]}::/64`;
    }
    return ip;
  }
  return ip;
}

// Server-Sent Events (SSE) active subscriber connections: deviceId -> Response
const activeSSEClients = new Map<string, Response>();

export function pushSSEEventToDevice(deviceId: string, eventType: string, data: any): boolean {
  const clientRes = activeSSEClients.get(deviceId);
  if (clientRes && !clientRes.writableEnded) {
    try {
      clientRes.write(`event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`);
      return true;
    } catch {
      activeSSEClients.delete(deviceId);
      return false;
    }
  }
  return false;
}

// Clean expired rooms and old mailbox entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [roomId, room] of rooms.entries()) {
    if (now > room.expiresAt + 60000) {
      rooms.delete(roomId);
    }
  }
  for (const [recipient, items] of mailboxes.entries()) {
    // Keep items for max 24 hours
    const filtered = items.filter((item) => now - item.timestamp < 24 * 60 * 60 * 1000);
    if (filtered.length === 0) {
      mailboxes.delete(recipient);
    } else {
      mailboxes.set(recipient, filtered);
    }
  }
  for (const [deviceId, presence] of devicePresences.entries()) {
    // Prune presences older than 10 minutes
    if (now - presence.lastSeen > 10 * 60 * 1000) {
      devicePresences.delete(deviceId);
    }
  }
  // Prune LAN devices inactive for > 30 seconds
  for (const [deviceId, lanDev] of lanDevices.entries()) {
    if (now - lanDev.lastSeen > 30 * 1000) {
      lanDevices.delete(deviceId);
    }
  }
  // Drop expired rate-limit windows so the map cannot grow forever.
  for (const [key, entry] of rateBuckets.entries()) {
    if (now > entry.resetAt) rateBuckets.delete(key);
  }
  // Prune expired LAN invites
  for (const [inviteId, invite] of lanInvites.entries()) {
    if (now > invite.expiresAt) {
      lanInvites.delete(inviteId);
    }
  }
}, 15 * 1000);

export const signalingRouter = Router();

// Ensure signaling requests are never cached by intermediate proxies or browsers
signalingRouter.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

/**
 * Real-Time Server-Sent Events (SSE) Stream for 0ms Latency Message & Call Delivery
 */
signalingRouter.get('/stream/:deviceId', (req: Request, res: Response) => {
  const { deviceId } = req.params;
  if (!deviceId) {
    res.status(400).json({ error: 'deviceId is required' });
    return;
  }

  // Set standard SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  // Register device presence & active client
  devicePresences.set(deviceId, { lastSeen: Date.now(), online: true });
  activeSSEClients.set(deviceId, res);

  // Send initial connected handshake
  res.write(`event: connected\ndata: ${JSON.stringify({ success: true, serverTime: Date.now(), deviceId })}\n\n`);

  // Check if there are any queued mailbox messages and flush immediately
  const pending = mailboxes.get(deviceId) || [];
  if (pending.length > 0) {
    for (const item of pending) {
      res.write(`event: mailbox_item\ndata: ${JSON.stringify(item)}\n\n`);
    }
    mailboxes.delete(deviceId);
  }

  // Keep-alive heartbeat ping every 15s to prevent cloud proxy timeouts
  const heartbeat = setInterval(() => {
    if (res.writableEnded) {
      clearInterval(heartbeat);
      activeSSEClients.delete(deviceId);
      return;
    }
    const previous = devicePresences.get(deviceId);
    devicePresences.set(deviceId, { ...previous, lastSeen: Date.now(), online: true });
    res.write(`: ping\n\n`);
  }, 15000);

  req.on('close', () => {
    clearInterval(heartbeat);
    activeSSEClients.delete(deviceId);
    // The page is gone (tab closed, navigation, or a dropped network): publish
    // it right away so the contact list flips to offline without a delay.
    const previous = devicePresences.get(deviceId);
    devicePresences.set(deviceId, { ...previous, lastSeen: Date.now(), online: false });
  });
});

/**
 * 0. Server Health & Relay Status
 */
signalingRouter.get(['/health', '/status', '/stats'], (req: Request, res: Response) => {
  const now = Date.now();
  let onlineCount = 0;
  for (const presence of devicePresences.values()) {
    if (now - presence.lastSeen < 30000) {
      onlineCount++;
    }
  }

  let confirmedCount = 0;
  for (const r of rooms.values()) {
    if (r.isConfirmed) confirmedCount++;
  }

  res.json({
    success: true,
    status: 'online',
    protocol: 'scryptChat/3.1',
    serverTime: now,
    uptimeSeconds: Math.floor(process.uptime()),
    activeRooms: rooms.size,
    confirmedRooms: confirmedCount,
    pendingMailboxes: mailboxes.size,
    activeOnlineDevices: onlineCount,
  });
});

/**
 * 0.1 Device Presence Ping & Batch Query
 */
signalingRouter.post('/presence', (req: Request, res: Response) => {
  const { deviceId, displayName, isOnline, lan } = req.body;
  if (!deviceId) {
    res.status(400).json({ error: 'deviceId is required' });
    return;
  }
  const previous = devicePresences.get(deviceId);
  devicePresences.set(deviceId, {
    lastSeen: Date.now(),
    online: isOnline === false ? false : true,
    displayName: displayName ?? previous?.displayName,
  });
  res.json({ success: true, timestamp: Date.now(), lan: !!lan });
});

signalingRouter.post('/presence/query', (req: Request, res: Response) => {
  const { deviceIds } = req.body;
  const now = Date.now();
  const presences: Record<string, { isOnline: boolean; lastSeen: number; displayName?: string }> = {};

  if (Array.isArray(deviceIds)) {
    for (const id of deviceIds) {
      const p = devicePresences.get(id);
      if (p) {
        // Online = the device said so and its last sign of life is recent.
        const isOnline = p.online !== false && now - p.lastSeen < PRESENCE_WINDOW_MS;
        presences[id] = {
          isOnline,
          lastSeen: p.lastSeen,
          displayName: p.displayName,
        };
      } else {
        presences[id] = {
          isOnline: false,
          lastSeen: 0,
        };
      }
    }
  }

  // `serverTime` lets clients compute the age against our clock, so a wrong
  // device clock can never keep a departed peer looking online.
  res.json({ success: true, serverTime: now, presences });
});

/**
 * 1. Create a 15-minute Rolling Dynamic Pairing Room & Token (or Permanent Link)
 */
signalingRouter.post('/room/create', (req: Request, res: Response) => {
  if (!allowRequest(req, 'room-create', 12, 60_000)) {
    res.status(429).json({ error: 'Too many pairing codes from this network. Try again in a minute.' });
    return;
  }

  const { deviceId, offer, ttlSeconds = 900, isPermanent = false } = req.body;

  // A reusable link gets a much longer code: it never expires, so guessing it
  // must be far harder than a 15-minute, single-use code.
  const codeLength = isPermanent ? 10 : 6;
  let roomId = randomRoomCode(codeLength);
  let guard = 0;
  while (rooms.has(roomId) && guard < 20) {
    roomId = randomRoomCode(codeLength);
    guard += 1;
  }

  const now = Date.now();
  const calculatedExpiry = isPermanent ? now + (365 * 24 * 3600 * 1000) : now + (ttlSeconds * 1000);
  const manageToken = randomBytes(24).toString('base64url');
  const room: SignalingRoom = {
    roomId,
    createdAt: now,
    expiresAt: calculatedExpiry,
    isPermanent: !!isPermanent,
    manageToken,
    joinCount: 0,
    initiator: {
      deviceId: deviceId || 'initiator',
      role: 'initiator',
      offer: offer || undefined,
      iceCandidates: [],
      updatedAt: now,
    },
  };

  rooms.set(roomId, room);
  res.json({
    success: true,
    roomId,
    // Returned once, to the creator. Required to revoke or rotate the link.
    manageToken,
    expiresAt: room.expiresAt,
    isPermanent: room.isPermanent,
    ttlSeconds: isPermanent ? 31536000 : ttlSeconds,
  });
});

/**
 * Rotate a permanent link's offer (a device that reloaded keeps the same code)
 * or revoke it entirely. Both require the creator's management token.
 */
signalingRouter.post('/room/:roomId/rotate', (req: Request, res: Response) => {
  const cleanId = (req.params.roomId || '').trim().toUpperCase();
  const { deviceId, manageToken, offer } = req.body;
  const room = rooms.get(cleanId);
  if (!room) {
    res.status(404).json({ error: 'This pairing link no longer exists.' });
    return;
  }
  if (!tokenMatches(room.manageToken, manageToken)) {
    res.status(403).json({ error: 'This device does not own that pairing link.' });
    return;
  }

  if (offer) {
    room.initiator = {
      deviceId: deviceId || room.initiator?.deviceId || 'initiator',
      role: 'initiator',
      offer,
      iceCandidates: [],
      updatedAt: Date.now(),
    };
    // A rotated offer invalidates the previous responder's answer.
    room.responder = undefined;
    room.isConfirmed = false;
    room.confirmedBy = [];
  }
  room.expiresAt = room.isPermanent
    ? Date.now() + 365 * 24 * 3600 * 1000
    : Math.max(room.expiresAt, Date.now() + 600_000);

  res.json({ success: true, roomId: room.roomId, expiresAt: room.expiresAt });
});

signalingRouter.post('/room/:roomId/revoke', (req: Request, res: Response) => {
  const cleanId = (req.params.roomId || '').trim().toUpperCase();
  const { manageToken } = req.body;
  const room = rooms.get(cleanId);
  if (!room) {
    res.json({ success: true, alreadyGone: true });
    return;
  }
  if (!tokenMatches(room.manageToken, manageToken)) {
    res.status(403).json({ error: 'This device does not own that pairing link.' });
    return;
  }
  rooms.delete(cleanId);
  res.json({ success: true, revoked: true });
});

/**
 * 2. Post Handshake Offer
 */
signalingRouter.post('/room/:roomId/offer', (req: Request, res: Response) => {
  const cleanId = (req.params.roomId || '').trim().toUpperCase();
  const { offer, deviceId } = req.body;
  const room = rooms.get(cleanId);

  if (!room) {
    res.status(404).json({ error: 'Pairing room expired or does not exist.' });
    return;
  }

  // Extend room expiry on activity
  room.expiresAt = Math.max(room.expiresAt, Date.now() + 600000);

  if (!room.initiator) {
    room.initiator = { deviceId, role: 'initiator', iceCandidates: [], updatedAt: Date.now() };
  }
  room.initiator.offer = offer;
  room.initiator.updatedAt = Date.now();

  res.json({ success: true, expiresAt: room.expiresAt });
});

/**
 * 3. Join Room & Fetch Offer
 */
signalingRouter.post('/room/:roomId/join', (req: Request, res: Response) => {
  // Guessing a code should not be cheap, so joins are limited per network.
  if (!allowRequest(req, 'room-join', 25, 60_000)) {
    res.status(429).json({ error: 'Too many pairing attempts from this network. Wait a minute.' });
    return;
  }

  const cleanId = (req.params.roomId || '').trim().toUpperCase();
  const { deviceId } = req.body;
  const room = rooms.get(cleanId);

  if (!room) {
    res.status(404).json({ error: 'Pairing code not found or expired.' });
    return;
  }

  if (Date.now() > room.expiresAt) {
    rooms.delete(cleanId);
    res.status(404).json({ error: 'Pairing code not found or expired.' });
    return;
  }

  const isRejoin = room.responder?.deviceId === deviceId || room.initiator?.deviceId === deviceId;
  if (!room.isPermanent && room.responder && !isRejoin) {
    res.status(409).json({ error: 'This one-time pairing code has already been used.' });
    return;
  }

  // Extend room expiry when peer joins
  room.expiresAt = Math.max(room.expiresAt, Date.now() + 600000);

  room.responder = {
    deviceId: deviceId || 'responder',
    role: 'responder',
    iceCandidates: [],
    updatedAt: Date.now(),
  };
  room.joinCount = (room.joinCount || 0) + 1;

  res.json({
    success: true,
    offer: room.initiator?.offer,
    expiresAt: room.expiresAt,
    isPermanent: !!room.isPermanent,
  });
});

/**
 * 4. Post Answer
 */
signalingRouter.post('/room/:roomId/answer', (req: Request, res: Response) => {
  const cleanId = (req.params.roomId || '').trim().toUpperCase();
  const { answer } = req.body;
  const room = rooms.get(cleanId);

  if (!room) {
    res.status(404).json({ error: 'Pairing room not found or expired.' });
    return;
  }

  if (!room.responder) {
    room.responder = { deviceId: 'unknown', role: 'responder', iceCandidates: [], updatedAt: Date.now() };
  }
  room.responder.answer = answer;
  room.responder.updatedAt = Date.now();

  res.json({ success: true });
});

/**
 * 4.1 Exchange Trickle ICE Candidates via Signaling
 */
signalingRouter.post('/room/:roomId/ice', (req: Request, res: Response) => {
  const { roomId } = req.params;
  const { deviceId, candidate } = req.body;
  const room = rooms.get(roomId.toUpperCase());

  if (!room) {
    res.status(404).json({ error: 'Room not found' });
    return;
  }

  if (room.initiator && room.initiator.deviceId === deviceId) {
    room.initiator.iceCandidates.push(candidate);
  } else if (room.responder) {
    room.responder.iceCandidates.push(candidate);
  }

  res.json({ success: true });
});

signalingRouter.get('/room/:roomId/ice/:deviceId', (req: Request, res: Response) => {
  const { roomId, deviceId } = req.params;
  const room = rooms.get(roomId.toUpperCase());

  if (!room) {
    res.status(404).json({ error: 'Room not found' });
    return;
  }

  // Return peer's candidates (if requested by initiator, return responder's, and vice versa)
  if (room.initiator?.deviceId === deviceId) {
    res.json({ success: true, candidates: room.responder?.iceCandidates || [] });
  } else {
    res.json({ success: true, candidates: room.initiator?.iceCandidates || [] });
  }
});

/**
 * 4.2 Explicit Signaling Server Handshake & Pairing Confirmation
 */
signalingRouter.post('/room/:roomId/confirm', (req: Request, res: Response) => {
  const cleanId = (req.params.roomId || '').trim().toUpperCase();
  const { deviceId } = req.body;
  const room = rooms.get(cleanId);

  if (!room) {
    res.status(404).json({ error: 'Pairing room not found or expired.' });
    return;
  }

  room.isConfirmed = true;
  room.confirmedAt = Date.now();
  if (!room.confirmedBy) room.confirmedBy = [];
  if (deviceId && !room.confirmedBy.includes(deviceId)) {
    room.confirmedBy.push(deviceId);
  }

  res.json({
    success: true,
    isConfirmed: true,
    confirmedAt: room.confirmedAt,
    confirmedBy: room.confirmedBy,
    roomId: room.roomId,
    serverMessage: 'Signaling server successfully certified and confirmed WebRTC peer match',
  });
});

/**
 * 5. Poll Room Status
 */
signalingRouter.get('/room/:roomId/status', (req: Request, res: Response) => {
  const cleanId = (req.params.roomId || '').trim().toUpperCase();
  const room = rooms.get(cleanId);

  if (!room) {
    res.status(404).json({ error: 'Room expired or closed.' });
    return;
  }

  const isExpired = Date.now() > room.expiresAt;

  res.json({
    roomId: room.roomId,
    isExpired,
    expiresAt: room.expiresAt,
    remainingSeconds: Math.max(0, Math.floor((room.expiresAt - Date.now()) / 1000)),
    hasOffer: !!room.initiator?.offer,
    offer: room.initiator?.offer,
    hasAnswer: !!room.responder?.answer,
    answer: room.responder?.answer,
    initiatorDeviceId: room.initiator?.deviceId,
    responderDeviceId: room.responder?.deviceId,
    isConfirmed: !!room.isConfirmed,
    confirmedAt: room.confirmedAt || null,
    confirmedBy: room.confirmedBy || [],
  });
});

/**
 * 6. Offline Encrypted Mailbox (Queue messages/files when recipient is offline)
 */
signalingRouter.post('/mailbox/send', (req: Request, res: Response) => {
  if (!allowRequest(req, 'mailbox-send', 240, 60_000)) {
    res.status(429).json({ error: 'Relay rate limit reached. Slow down for a moment.' });
    return;
  }

  const { senderDeviceId, recipientDeviceId, encryptedEnvelope, fileMetadata, fileBase64Chunk } = req.body;

  if (!recipientDeviceId || !encryptedEnvelope) {
    res.status(400).json({ error: 'recipientDeviceId and encryptedEnvelope are required' });
    return;
  }

  // The relay only ever stores opaque ciphertext, but it still caps how much a
  // single request can park in memory so one client cannot exhaust the server.
  const MAX_ENVELOPE_CHARS = 512 * 1024;
  const MAX_ATTACHMENT_CHARS = 24 * 1024 * 1024;
  if (typeof encryptedEnvelope !== 'string' || encryptedEnvelope.length > MAX_ENVELOPE_CHARS) {
    res.status(413).json({ error: 'Encrypted envelope is too large for the relay.' });
    return;
  }
  if (fileBase64Chunk && String(fileBase64Chunk).length > MAX_ATTACHMENT_CHARS) {
    res.status(413).json({ error: 'Attachment is too large for the relay mailbox.' });
    return;
  }

  if (senderDeviceId) {
    devicePresences.set(senderDeviceId, {
      lastSeen: Date.now(),
    });
  }

  const item: EncryptedMailboxItem = {
    id: 'mail_' + Math.random().toString(36).substring(2, 11),
    senderDeviceId,
    recipientDeviceId,
    encryptedEnvelope,
    fileMetadata,
    fileBase64Chunk,
    timestamp: Date.now(),
  };

  // Push directly to active real-time SSE stream if recipient is online
  const pushed = pushSSEEventToDevice(recipientDeviceId, 'mailbox_item', item);
  if (!pushed) {
    const queue = mailboxes.get(recipientDeviceId) || [];
    queue.push(item);
    mailboxes.set(recipientDeviceId, queue);
  }

  res.json({ success: true, messageId: item.id, deliveredRealtime: pushed });
});

signalingRouter.get('/mailbox/pull/:deviceId', (req: Request, res: Response) => {
  const { deviceId } = req.params;
  if (deviceId) {
    devicePresences.set(deviceId, {
      lastSeen: Date.now(),
    });
  }
  const items = mailboxes.get(deviceId) || [];
  // Clear after pulling
  mailboxes.delete(deviceId);
  res.json({ success: true, items });
});

/**
 * 7. Local Network (LAN) Discovery & Direct LAN Pairing Endpoints
 */

// 7.1 Announce Presence / Toggle Visibility on Local Network
signalingRouter.post('/lan/announce', (req: Request, res: Response) => {
  const { deviceId, displayName, isVisible } = req.body;
  if (!deviceId) {
    res.status(400).json({ error: 'deviceId is required' });
    return;
  }

  const subnetKey = getClientSubnetKey(req);
  const now = Date.now();

  if (isVisible === false) {
    // Device opted out of visibility / invisible stealth mode
    lanDevices.delete(deviceId);
  } else {
    lanDevices.set(deviceId, {
      deviceId,
      displayName: displayName || `Device-${deviceId.slice(-4)}`,
      subnetKey,
      isVisible: true,
      lastSeen: now,
    });
  }

  res.json({ success: true, subnetKey, isVisible: !!isVisible, timestamp: now });
});

// 7.2 Query Visible Peers on the Same Local Subnet
signalingRouter.get('/lan/peers', (req: Request, res: Response) => {
  const deviceId = req.query.deviceId as string;
  const subnetKey = getClientSubnetKey(req);
  const now = Date.now();

  const peers: Array<{ deviceId: string; displayName: string; lastSeen: number }> = [];

  for (const peer of lanDevices.values()) {
    // Same subnet, actively visible, seen in last 25 seconds, and not self
    if (
      peer.subnetKey === subnetKey &&
      peer.isVisible &&
      peer.deviceId !== deviceId &&
      now - peer.lastSeen < 25000
    ) {
      peers.push({
        deviceId: peer.deviceId,
        displayName: peer.displayName,
        lastSeen: peer.lastSeen,
      });
    }
  }

  res.json({ success: true, subnetKey, peers });
});

// 7.3 Send Direct Pairing Invite to a Discovered Peer
signalingRouter.post('/lan/invite', (req: Request, res: Response) => {
  const { fromDeviceId, fromDisplayName, toDeviceId, offer } = req.body;

  if (!fromDeviceId || !toDeviceId || !offer) {
    res.status(400).json({ error: 'fromDeviceId, toDeviceId, and offer are required' });
    return;
  }

  const subnetKey = getClientSubnetKey(req);
  const inviteId = 'lan_' + Math.random().toString(36).substring(2, 11);
  const now = Date.now();

  const invite: LanInviteRecord = {
    inviteId,
    subnetKey,
    fromDeviceId,
    fromDisplayName: fromDisplayName || 'Nearby Peer',
    toDeviceId,
    offer,
    status: 'pending',
    createdAt: now,
    expiresAt: now + 30000, // 30s TTL
  };

  lanInvites.set(inviteId, invite);
  res.json({ success: true, inviteId, expiresAt: invite.expiresAt });
});

// 7.4 Query Pending Invites for This Device
signalingRouter.get('/lan/invites', (req: Request, res: Response) => {
  const deviceId = req.query.deviceId as string;
  if (!deviceId) {
    res.status(400).json({ error: 'deviceId is required' });
    return;
  }

  const now = Date.now();
  const pending: Array<{ inviteId: string; fromDeviceId: string; fromDisplayName: string; offer: any }> = [];

  for (const inv of lanInvites.values()) {
    if (inv.toDeviceId === deviceId && inv.status === 'pending' && now <= inv.expiresAt) {
      pending.push({
        inviteId: inv.inviteId,
        fromDeviceId: inv.fromDeviceId,
        fromDisplayName: inv.fromDisplayName,
        offer: inv.offer,
      });
    }
  }

  res.json({ success: true, invites: pending });
});

// 7.5 Respond to Direct Invite (Accept or Decline)
signalingRouter.post('/lan/respond', (req: Request, res: Response) => {
  const { inviteId, accepted, answer } = req.body;

  if (!inviteId) {
    res.status(400).json({ error: 'inviteId is required' });
    return;
  }

  const invite = lanInvites.get(inviteId);
  if (!invite || Date.now() > invite.expiresAt) {
    res.status(404).json({ error: 'Invite expired or not found' });
    return;
  }

  invite.status = accepted ? 'accepted' : 'declined';
  if (accepted && answer) {
    invite.answer = answer;
  }

  res.json({ success: true, status: invite.status });
});

// 7.6 Check Status of an Outgoing Invite
signalingRouter.get('/lan/invite/:inviteId/status', (req: Request, res: Response) => {
  const { inviteId } = req.params;
  const invite = lanInvites.get(inviteId);

  if (!invite) {
    res.status(404).json({ error: 'Invite not found or expired' });
    return;
  }

  const isExpired = Date.now() > invite.expiresAt;
  res.json({
    success: true,
    inviteId: invite.inviteId,
    status: isExpired ? 'expired' : invite.status,
    answer: invite.answer,
    isExpired,
  });
});

// ==========================================
// 8. REAL-TIME ULTRA-LOW-LATENCY CALL SIGNALING RELAY
// ==========================================
interface FastCallSignal {
  id: string;
  senderDeviceId: string;
  recipientDeviceId: string;
  signal: any;
  timestamp: number;
}

const callSignalsQueue = new Map<string, FastCallSignal[]>(); // recipientDeviceId -> signals

// 8.1 Push Call Signal (Offer, Answer, ICE Candidates, Mute state, End, Reject)
signalingRouter.post('/call/signal', (req: Request, res: Response) => {
  const { senderDeviceId, recipientDeviceId, signal } = req.body;
  if (!senderDeviceId || !recipientDeviceId || !signal) {
    res.status(400).json({ error: 'senderDeviceId, recipientDeviceId, and signal are required' });
    return;
  }

  // Update presence
  devicePresences.set(senderDeviceId, { lastSeen: Date.now() });

  const signalObj: FastCallSignal = {
    id: `cs_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    senderDeviceId,
    recipientDeviceId,
    signal,
    timestamp: Date.now(),
  };

  const current = callSignalsQueue.get(recipientDeviceId) || [];
  current.push(signalObj);
  callSignalsQueue.set(recipientDeviceId, current.slice(-30)); // keep last 30 max

  // Push directly over active SSE stream for immediate zero-latency ring/signal
  const pushedRealtime = pushSSEEventToDevice(recipientDeviceId, 'call_signal', signalObj);

  res.json({ success: true, signalId: signalObj.id, deliveredRealtime: pushedRealtime });
});

// 8.2 Poll Call Signals
signalingRouter.get('/call/poll/:deviceId', (req: Request, res: Response) => {
  const { deviceId } = req.params;
  const signals = callSignalsQueue.get(deviceId) || [];
  callSignalsQueue.delete(deviceId); // dequeue
  res.json({ success: true, signals });
});

// ==========================================
// 9. GROUP RELAY DISPATCH
// ==========================================
interface GroupBroadcastPacket {
  id: string;
  groupId: string;
  senderDeviceId: string;
  recipients: string[];
  payload: any;
  timestamp: number;
}

signalingRouter.post('/group/broadcast', (req: Request, res: Response) => {
  const { groupId, senderDeviceId, recipients, payload } = req.body;
  if (!groupId || !senderDeviceId || !Array.isArray(recipients) || !payload) {
    res.status(400).json({ error: 'groupId, senderDeviceId, recipients, and payload are required' });
    return;
  }

   const now = Date.now();
   const envelope = {
     id: `grp_${now}_${Math.random().toString(36).slice(2, 7)}`,
     senderDeviceId,
     packet: payload,
     timestamp: now,
   };
   recipients.forEach((memberId: string) => {
     if (memberId !== senderDeviceId) {
       const list = mailboxes.get(memberId) || [];
       list.push({
         ...envelope,
         recipientDeviceId: memberId,
         encryptedEnvelope: JSON.stringify(payload),
       });
       mailboxes.set(memberId, list.slice(-50));
     }
   });

  // Push to active SSE streams for real-time delivery
  recipients.forEach((memberId: string) => {
    if (memberId !== senderDeviceId) {
      pushSSEEventToDevice(memberId, 'mailbox_item', envelope);
    }
  });

  res.json({ success: true, recipientCount: recipients.length });
});

