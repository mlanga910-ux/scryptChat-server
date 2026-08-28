import { Router, Request, Response } from 'express';

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
  expiresAt: number; // 60-second rolling expiry
  initiator?: RoomPeer;
  responder?: RoomPeer;
  isConfirmed?: boolean;
  confirmedAt?: number;
  confirmedBy?: string[];
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
// Device presence store: deviceId -> { lastSeen: number, displayName?: string }
const devicePresences = new Map<string, { lastSeen: number; displayName?: string }>();

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
}, 30 * 1000);

export const signalingRouter = Router();

// Ensure signaling requests are never cached by intermediate proxies or browsers
signalingRouter.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

/**
 * 0. Server Health & Relay Status
 */
signalingRouter.get(['/status', '/stats'], (req: Request, res: Response) => {
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
  const { deviceId, displayName } = req.body;
  if (!deviceId) {
    res.status(400).json({ error: 'deviceId is required' });
    return;
  }
  devicePresences.set(deviceId, {
    lastSeen: Date.now(),
    displayName,
  });
  res.json({ success: true, timestamp: Date.now() });
});

signalingRouter.post('/presence/query', (req: Request, res: Response) => {
  const { deviceIds } = req.body;
  const now = Date.now();
  const presences: Record<string, { isOnline: boolean; lastSeen: number; displayName?: string }> = {};

  if (Array.isArray(deviceIds)) {
    for (const id of deviceIds) {
      const p = devicePresences.get(id);
      if (p) {
        // Active in last 25 seconds counts as currently online on relay
        const isOnline = now - p.lastSeen < 25000;
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

  res.json({ success: true, presences });
});

/**
 * 1. Create a 60-second Rolling Dynamic Pairing Room & Token
 */
signalingRouter.post('/room/create', (req: Request, res: Response) => {
  const { deviceId, ttlSeconds = 60 } = req.body;
  
  // Generate friendly 6-character code (avoid confusing letters like 0/O, 1/I)
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let roomId = '';
  for (let i = 0; i < 6; i++) {
    roomId += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  const now = Date.now();
  const room: SignalingRoom = {
    roomId,
    createdAt: now,
    expiresAt: now + (ttlSeconds * 1000),
    initiator: {
      deviceId: deviceId || 'initiator',
      role: 'initiator',
      iceCandidates: [],
      updatedAt: now,
    },
  };

  rooms.set(roomId, room);
  res.json({
    success: true,
    roomId,
    expiresAt: room.expiresAt,
    ttlSeconds,
  });
});

/**
 * 2. Post Handshake Offer
 */
signalingRouter.post('/room/:roomId/offer', (req: Request, res: Response) => {
  const { roomId } = req.params;
  const { offer, deviceId } = req.body;
  const room = rooms.get(roomId.toUpperCase());

  if (!room) {
    res.status(404).json({ error: 'Pairing room expired or does not exist.' });
    return;
  }

  if (Date.now() > room.expiresAt) {
    rooms.delete(roomId.toUpperCase());
    res.status(410).json({ error: 'Pairing code expired (60s limit). Please generate a fresh code.' });
    return;
  }

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
  const { roomId } = req.params;
  const { deviceId } = req.body;
  const room = rooms.get(roomId.toUpperCase());

  if (!room) {
    res.status(404).json({ error: 'Pairing code not found or expired.' });
    return;
  }

  if (Date.now() > room.expiresAt) {
    rooms.delete(roomId.toUpperCase());
    res.status(410).json({ error: 'Pairing code has expired. Ask peer for a fresh 1-minute QR code.' });
    return;
  }

  room.responder = {
    deviceId: deviceId || 'responder',
    role: 'responder',
    iceCandidates: [],
    updatedAt: Date.now(),
  };

  res.json({
    success: true,
    offer: room.initiator?.offer,
    expiresAt: room.expiresAt,
  });
});

/**
 * 4. Post Answer
 */
signalingRouter.post('/room/:roomId/answer', (req: Request, res: Response) => {
  const { roomId } = req.params;
  const { answer } = req.body;
  const room = rooms.get(roomId.toUpperCase());

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
  const { roomId } = req.params;
  const { deviceId } = req.body;
  const room = rooms.get(roomId.toUpperCase());

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

  console.log(`[Signaling] Pairing room ${roomId} confirmed by device ${deviceId} (Signaling handshake certified)`);

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
  const { roomId } = req.params;
  const room = rooms.get(roomId.toUpperCase());

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
  const { senderDeviceId, recipientDeviceId, encryptedEnvelope, fileMetadata, fileBase64Chunk } = req.body;
  
  if (!recipientDeviceId || !encryptedEnvelope) {
    res.status(400).json({ error: 'recipientDeviceId and encryptedEnvelope are required' });
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

  const queue = mailboxes.get(recipientDeviceId) || [];
  queue.push(item);
  mailboxes.set(recipientDeviceId, queue);

  res.json({ success: true, messageId: item.id });
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
