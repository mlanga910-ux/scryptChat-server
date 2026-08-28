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

function getClientSubnetKey(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  let ip = typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : req.socket.remoteAddress || '127.0.0.1';
  if (ip.startsWith('::ffff:')) {
    ip = ip.slice(7);
  }
  const parts = ip.split('.');
  if (parts.length === 4) {
    return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
  }
  const v6Parts = ip.split(':');
  if (v6Parts.length >= 4) {
    return `${v6Parts[0]}:${v6Parts[1]}:${v6Parts[2]}:${v6Parts[3]}::/64`;
  }
  return ip;
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
 * 1. Create a 5-minute Rolling Dynamic Pairing Room & Token
 */
signalingRouter.post('/room/create', (req: Request, res: Response) => {
  const { deviceId, offer, ttlSeconds = 300 } = req.body;
  
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
      offer: offer || undefined,
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
  const cleanId = (req.params.roomId || '').trim().toUpperCase();
  const { offer, deviceId } = req.body;
  const room = rooms.get(cleanId);

  if (!room) {
    res.status(404).json({ error: 'Pairing room expired or does not exist.' });
    return;
  }

  if (Date.now() > room.expiresAt) {
    rooms.delete(cleanId);
    res.status(410).json({ error: 'Pairing code expired. Please generate a fresh code.' });
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
  const cleanId = (req.params.roomId || '').trim().toUpperCase();
  const { deviceId } = req.body;
  const room = rooms.get(cleanId);

  if (!room) {
    res.status(404).json({ error: 'Pairing code not found or expired.' });
    return;
  }

  if (Date.now() > room.expiresAt) {
    rooms.delete(cleanId);
    res.status(410).json({ error: 'Pairing code has expired. Please generate a fresh code.' });
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

