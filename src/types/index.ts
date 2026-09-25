export type ProtocolVersion = 0x0301;
export const PROTOCOL_VERSION: ProtocolVersion = 0x0301;

export type VerificationStatus = 'UNVERIFIED' | 'TOFU' | 'VERIFIED';
export type MessageDirection = 'INBOUND' | 'OUTBOUND';
export type MessageStatus =
  | 'queued'
  | 'sending'
  | 'sent'
  | 'delivered'
  | 'read'
  | 'failed'
  | 'verified'
  /** Inbound attachment whose bytes are still on the way. */
  | 'receiving';
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
  /**
   * Receiver → sender, in answer to a FILE_HEADER: "I already hold this many
   * bytes of this file". It is what turns a dropped link, a closed tab or a
   * reload into a resume instead of a retry from byte zero.
   */
  FILE_RESUME = 0x23,
  HEARTBEAT_PING_PONG = 0x30,
  TYPING_INDICATOR = 0x35,
  READ_RECEIPT = 0x36,
  PROFILE_INFO = 0x37,
  DELIVERY_ACK = 0x38,
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
  // Keyless devices are possible: browsers without WebCrypto (an insecure
  // context) can still run the workspace, but cannot pair securely.
  publicKeyECDSA: CryptoKey | null;
  privateKeyECDSA: CryptoKey | null;
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
  /** The contact's chosen presence status (Online, Busy, Away, …). */
  status?: string;
  identityPublicKeyPEM: string;
  publicKeyRaw: string;
  verificationStatus: VerificationStatus;
  safetyNumber: string; // 6-digit out-of-band string
  addedAt: number;
  lastSeenAt: number;
  isOnline?: boolean;
  unreadCount?: number;
  /** True when the live link with this contact runs entirely over the local network. */
  isLan?: boolean;
  /** Wall-clock time of the last profile refresh received from the contact. */
  profileSyncedAt?: number;
}

/** Profile fields exchanged between paired devices. */
export interface ProfileSyncPayload {
  deviceId: string;
  displayName?: string;
  avatarUrl?: string;
  avatarColor?: string;
  statusBio?: string;
  status?: string;
  /** Sender clock at the moment the profile was edited (ordering guard). */
  updatedAt?: number;
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
  /**
   * Intrinsic pixel size of an image, measured once and stored with it.
   *
   * It travels with the file's metadata (header, preview and relay notice) so a
   * conversation can lay the photo out at its real proportions before a single
   * byte of the picture has arrived: the bubble never resizes when it lands.
   */
  width?: number;
  height?: number;
  /** Length of a video/audio attachment in milliseconds, when known. */
  durationMs?: number;
  /**
   * Throughput the attachment actually moved at, in bytes per second. Kept on
   * the record so the conversation can show "12.4 MB/s" next to a file long
   * after the transfer finished - including after a page reload.
   */
  transferSpeedBps?: number;
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
  /** Delivery bookkeeping used by the outbox retry loop. */
  deliveryAttempts?: number;
  nextAttemptAt?: number;
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
  /**
   * Where an attachment stands on this device: `receiving` while its bytes are
   * still travelling, `ready` once they are in the local vault, `failed` when
   * the transfer gave up. Absent for text messages.
   */
  attachmentState?: 'queued' | 'sending' | 'receiving' | 'ready' | 'failed';
  /**
   * Throughput this attachment moved at, in bytes per second. Written once the
   * transfer settles so the conversation can show it next to the file - and,
   * because it is part of the stored row, still show it after a reload.
   */
  transferSpeedBps?: number;
  offlineEnvelope?: boolean;
  /**
   * Secret of the relay transfer that carries this attachment's bytes. Persisted
   * so a reload resumes the same upload instead of being refused as a stranger.
   */
  transferToken?: string;
}

export interface TransferStateRecord {
  /** Either the fileId or `out:<messageId>` for bytes this device is sending. */
  transferId: string;
  direction: MessageDirection;
  fileId: string;
  messageId?: string;
  name: string;
  size: number;
  mimeType: string;
  hashSHA256: string;
  /** Frame size this side streamed with; the peer aligns its offset to it. */
  chunkSize: number;
  totalChunks: number;
  /**
   * Bytes of the prefix that are already safely stored: on the receiving side
   * the contiguous part it holds, on the sending side how far the peer got.
   */
  receivedBytes: number;
  /**
   * The prefix itself while a transfer is in flight - kept so a reload, a lost
   * link or a closed tab resumes where it stopped instead of starting over.
   */
  blobRef?: Blob;
  /** Metadata that must survive a reload (sender, preview, image size). */
  meta?: Record<string, unknown>;
  width?: number;
  height?: number;
  updatedAt: number;
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

export type CallState = 'IDLE' | 'CALLING' | 'INCOMING' | 'CONNECTED' | 'RECONNECTING' | 'ENDED';
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
  isLocalVideoEnabled?: boolean;
}

export interface CallSignalPayload {
  action: 'CALL_OFFER' | 'CALL_ANSWER' | 'CALL_REJECT' | 'CALL_END' | 'CALL_MUTE_STATE' | 'CALL_ICE' | 'CALL_RESTART';
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
  isLocalVideoEnabled?: boolean;
}
