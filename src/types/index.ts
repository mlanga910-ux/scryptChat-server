export type ProtocolVersion = 0x0301;
export const PROTOCOL_VERSION: ProtocolVersion = 0x0301;

export type VerificationStatus = 'UNVERIFIED' | 'TOFU' | 'VERIFIED';
export type MessageDirection = 'INBOUND' | 'OUTBOUND';
export type MessageStatus = 'queued' | 'sending' | 'delivered' | 'read' | 'failed' | 'verified';
export type RelayStatus = 'ONLINE' | 'OFFLINE' | 'CONNECTING' | 'RESTARTING';

export interface RelayServerStats {
  status: 'online' | 'offline';
  serverTime?: number;
  uptimeSeconds?: number;
  activeRooms?: number;
  confirmedRooms?: number;
  pendingMailboxes?: number;
  activeOnlineDevices?: number;
}

export enum PacketType {
  TEXT_MESSAGE = 0x10,
  FILE_HEADER = 0x20,
  FILE_CHUNK = 0x21,
  CHUNK_ACK = 0x22,
  HEARTBEAT_PING_PONG = 0x30,
  TYPING_INDICATOR = 0x35,
  READ_RECEIPT = 0x36,
  MEDIA_SIGNAL = 0x40,
}

export enum AckStatus {
  OK_ACK = 0x00,
  NACK_RETRANSMIT_REQ = 0x01,
}

export interface SocialLinks {
  twitter?: string;
  telegram?: string;
  github?: string;
  instagram?: string;
  website?: string;
}

export interface UserProfile {
  deviceId: string;
  displayName: string;
  avatarColor: string;
  avatarUrl?: string;
  statusBio: string;
  status?: string;
  phone?: string;
  email?: string;
  socialLinks?: SocialLinks;
  joinedAt: number;
}

export interface IdentityRecord {
  deviceId: string; // DEV-XXXX-XXXX-XXXX-XXXX
  publicKeyECDSA: CryptoKey;
  privateKeyECDSA: CryptoKey;
  publicKeyRaw: string; // Base64 uncompressed 65 bytes
  displayName?: string;
  avatarColor?: string;
  avatarUrl?: string;
  statusBio?: string;
  status?: string;
  phone?: string;
  email?: string;
  socialLinks?: SocialLinks;
  createdAt: number;
}

export interface ContactRecord {
  deviceId: string;
  alias: string;
  avatarColor?: string;
  avatarUrl?: string;
  statusBio?: string;
  identityPublicKeyPEM: string;
  publicKeyRaw: string;
  verificationStatus: VerificationStatus;
  safetyNumber: string; // 6-digit out-of-band string
  addedAt: number;
  lastSeenAt: number;
  isOnline?: boolean;
  unreadCount?: number;
}

export interface ImageExifData {
  make?: string;
  model?: string;
  lensModel?: string;
  dateTimeOriginal?: string;
  exposureTime?: string | number;
  fNumber?: number;
  iso?: number;
  focalLength?: number;
  imageWidth?: number;
  imageHeight?: number;
  colorSpace?: string;
  flash?: string | number;
  software?: string;
  latitude?: number;
  longitude?: number;
  altitude?: number;
  gpsFormatted?: string;
  rawTags?: Record<string, any>;
}

export interface FileRecord {
  fileId: string; // 16 Hex characters (64-bit ID)
  name: string;
  size: number;
  mimeType: string;
  hashSHA256: string;
  blobRef?: Blob;
  previewUrl?: string;
  isImage?: boolean;
  isAudio?: boolean;
  isVideo?: boolean;
  audioDuration?: number;
  exifData?: ImageExifData;
}

export interface CodeSnippet {
  code: string;
  language: string;
  title?: string;
  lineCount: number;
}

export interface GroupRecord {
  groupId: string; // group_xxx
  name: string;
  description?: string;
  avatarColor: string;
  avatarUrl?: string;
  adminDeviceId: string;
  memberDeviceIds: string[];
  createdAt: number;
  lastActivityAt: number;
  unreadCount?: number;
}

export interface MessageRecord {
  id?: number;
  messageId?: string;
  chatDeviceId: string; // Peer deviceId OR groupId
  isGroup?: boolean;
  groupId?: string;
  senderDeviceId?: string;
  senderDisplayName?: string;
  senderAvatarColor?: string;
  senderAvatarUrl?: string;
  direction: MessageDirection;
  payloadText: string;
  fileId?: string;
  fileRecord?: FileRecord;
  mediaType?: 'text' | 'image' | 'audio' | 'video' | 'file' | 'code' | 'snippet';
  codeSnippet?: CodeSnippet;
  timestamp: number;
  status?: MessageStatus;
  offlineEnvelope?: boolean;
}

export interface FileTransferProgress {
  fileId: string;
  name: string;
  size: number;
  mimeType: string;
  hashSHA256: string;
  direction: MessageDirection;
  totalChunks: number;
  transferredChunks: number;
  progressPercent: number;
  status: 'transferring' | 'completed' | 'error' | 'verifying';
  speedBps?: number;
  blobUrl?: string;
}

export interface HandshakeOfferData {
  protocolVer: number;
  role: 'initiator' | 'responder';
  deviceId: string;
  displayName?: string;
  identityPublicKeyRaw: string; // Base64 65 bytes
  ephemeralPublicKeyRaw: string; // Base64 65 bytes
  challengeNonce: string; // Base64 16 bytes
  handshakeSalt: string; // Base64 32 bytes (only for initiator)
  sdp: RTCSessionDescriptionInit;
}

export interface HandshakeAnswerData {
  protocolVer: number;
  role: 'responder';
  deviceId: string;
  displayName?: string;
  identityPublicKeyRaw: string; // Base64 65 bytes
  ephemeralPublicKeyRaw: string; // Base64 65 bytes
  challengeNonce: string; // Base64 16 bytes
  sdp: RTCSessionDescriptionInit;
  signature: string; // Base64 ECDSA signature over CanonicalTranscriptHash
}

export interface HandshakeFinalizeData {
  protocolVer: number;
  role: 'initiator';
  signature: string; // Base64 ECDSA signature over CanonicalTranscriptHash
}

export type CallState = 'IDLE' | 'CALLING' | 'INCOMING' | 'CONNECTED' | 'ENDED';
export type CallType = 'audio' | 'video';

export interface CallSessionInfo {
  callId: string;
  peerDeviceId: string;
  peerDisplayName: string;
  peerAvatarUrl?: string;
  peerAvatarColor?: string;
  callType: CallType;
  direction: 'OUTBOUND' | 'INBOUND';
  state: CallState;
  startTime?: number;
  durationSeconds: number;
  isAudioMuted: boolean;
  isVideoMuted: boolean;
  isScreenSharing: boolean;
  isRemoteAudioMuted: boolean;
  isRemoteVideoMuted: boolean;
  safetyNumber?: string;
  isGroupCall?: boolean;
  groupId?: string;
  groupName?: string;
  groupMembers?: string[];
}

export interface CallSignalPayload {
  action: 'CALL_OFFER' | 'CALL_ANSWER' | 'CALL_REJECT' | 'CALL_END' | 'CALL_MUTE_STATE' | 'CALL_ICE';
  callId: string;
  callType?: CallType;
  callerDeviceId?: string;
  callerDisplayName?: string;
  callerAvatarUrl?: string;
  callerAvatarColor?: string;
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
  reason?: string;
  isAudioMuted?: boolean;
  isVideoMuted?: boolean;
}

