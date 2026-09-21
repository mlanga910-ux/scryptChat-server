import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  ContactRecord,
  FileRecord,
  FileTransferProgress,
  GroupRecord,
  MessageRecord,
  CodeSnippet,
} from '../types/index';
import {
  Send,
  Paperclip,
  Download,
  Clock,
  ArrowLeft,
  Info,
  Mic,
  Eye,
  Image as ImageIcon,
  FileCode,
  FileArchive,
  Film,
  Music,
  Check,
  CheckCheck,
  CircleAlert,
  Phone,
  Video,
  Sliders,
  FileText,
  ChevronDown,
  Users,
  Plus,
  Wifi,
  UploadCloud,
  ArrowUpFromLine,
  Loader2,
  RotateCcw,
} from 'lucide-react';
import { db } from '../db/index';
import { onVaultChange } from '../utils/vaultEvents';
import { ImageViewerModal } from './ImageViewerModal';
import { ChatSettingsModal } from './ChatSettingsModal';
import { FilePreviewModal } from './FilePreviewModal';
import { CodeViewerModal } from './CodeViewerModal';
import { CodeBlockCard } from './CodeBlockCard';
import { Avatar } from './Avatar';
import { getChatSettings, ChatCustomSettings } from '../utils/chatSettings';
import { parseMessageContent } from '../utils/codeHelper';
import { describePresence, statusColor } from '../utils/presence';

const startOfDay = (timestamp: number) => {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
};

/** "Today", "Yesterday" or a short absolute date for older messages. */
const formatDayLabel = (timestamp: number) => {
  const today = startOfDay(Date.now());
  const day = startOfDay(timestamp);
  const oneDay = 86400000;
  if (day === today) return 'Today';
  if (day === today - oneDay) return 'Yesterday';
  const date = new Date(timestamp);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString([], {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: sameYear ? undefined : 'numeric',
  });
};

interface ChatViewProps {
  activeContact: ContactRecord | null;
  activeGroup?: GroupRecord | null;
  messages: MessageRecord[];
  activeTransfers: FileTransferProgress[];
  isConnected: boolean;
  /** True when the live link to this contact stays inside the local network. */
  isLanLink?: boolean;
  latencyMs?: number;
  /** True while the peer is composing a message. */
  isPeerTyping?: boolean;
  /** Re-sends a message whose delivery failed. */
  onRetryMessage?: (messageId: string) => void;
  /** Asks the sender for an attachment whose bytes never arrived. */
  onRetryAttachment?: (message: MessageRecord) => void;
  peerManager?: any;
  onSendMessage: (
    text: string,
    options?: { isGroup?: boolean; groupId?: string }
  ) => Promise<void>;
  onSendFile: (file: File, options?: { isGroup?: boolean; groupId?: string }) => Promise<void>;
  onStartCall?: (peerDeviceId: string, peerDisplayName: string, callType: 'audio' | 'video') => void;
  onStartGroupCall?: (group: GroupRecord, callType: 'audio' | 'video') => void;
  onBackToPeers?: () => void;
  /** Clears every stored message and file of this conversation. */
  onClearHistory?: (deviceId: string) => void | Promise<void>;
  /** Removes the contact (and its history) from this device. */
  onDeleteContact?: (deviceId: string) => void | Promise<void>;
  onOpenGroupDetails?: (group: GroupRecord) => void;
}

export const ChatView: React.FC<ChatViewProps> = ({
  activeContact,
  activeGroup,
  messages,
  activeTransfers,
  isConnected,
  isLanLink,
  latencyMs,
  isPeerTyping,
  onRetryMessage,
  onRetryAttachment,
  peerManager,
  onSendMessage,
  onSendFile,
  onStartCall,
  onStartGroupCall,
  onBackToPeers,
  onClearHistory,
  onDeleteContact,
  onOpenGroupDetails,
}) => {
  const [inputText, setInputText] = useState('');
  const [isSending, setIsSending] = useState(false);

  const mediaInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);
  // Transfers still moving. Completed ones are dropped so the strip disappears
  // by itself instead of leaving a finished bar on screen.
  const liveTransfers = useMemo(
    () => activeTransfers.filter((transfer) => transfer.status === 'transferring'),
    [activeTransfers]
  );

  const [selectedSnippetForModal, setSelectedSnippetForModal] = useState<CodeSnippet | null>(null);
  const [isCodeModalOpen, setIsCodeModalOpen] = useState(false);
  const [previewFile, setPreviewFile] = useState<FileRecord | null>(null);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [isUserScrolledUp, setIsUserScrolledUp] = useState(false);
  const [newMessagesWhileScrolled, setNewMessagesWhileScrolled] = useState(0);
  const isNearBottomRef = useRef(true);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const [downloadUrls, setDownloadUrls] = useState<Map<string, string>>(new Map());
  const [fileRecordsMap, setFileRecordsMap] = useState<Map<string, FileRecord>>(new Map());
  /**
   * Bumped whenever bytes land in the local vault. Attachment resolution is
   * driven by it, so a photo sharpens the instant its file is stored - however
   * it arrived, and without waiting for another message to trigger a repaint.
   */
  const [vaultVersion, setVaultVersion] = useState(0);

  useEffect(() => onVaultChange(() => setVaultVersion((v) => v + 1)), []);

  const [selectedImageFile, setSelectedImageFile] = useState<FileRecord | null>(null);
  const [selectedImageBlobUrl, setSelectedImageBlobUrl] = useState<string | undefined>(undefined);
  const [selectedImageMessage, setSelectedImageMessage] = useState<MessageRecord | null>(null);
  const [isImageViewerOpen, setIsImageViewerOpen] = useState(false);

  const [isChatSettingsOpen, setIsChatSettingsOpen] = useState(false);
  const [chatSettings, setChatSettings] = useState<ChatCustomSettings>(() =>
    activeContact ? getChatSettings(activeContact.deviceId) : ({} as any)
  );

  const [revealedMediaIds, setRevealedMediaIds] = useState<Set<string>>(new Set());

  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<any>(null);
  const isRecordingCancelledRef = useRef<boolean>(false);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const recordingActiveRef = useRef<boolean>(false);

  useEffect(() => {
    if (activeContact) {
      setChatSettings(getChatSettings(activeContact.deviceId));
      setRevealedMediaIds(new Set());
    }
    setAttachError(null);
  }, [activeContact?.deviceId, activeGroup?.groupId]);

  const handleScroll = () => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const nearBottom = distanceToBottom < 100;
    isNearBottomRef.current = nearBottom;
    if (nearBottom) {
      setIsUserScrolledUp(false);
      setNewMessagesWhileScrolled(0);
    } else {
      setIsUserScrolledUp(true);
    }
  };

  const scrollToBottom = useCallback((smooth = true) => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto' });
      setIsUserScrolledUp(false);
      setNewMessagesWhileScrolled(0);
    }
  }, []);

  useEffect(() => {
    if (isNearBottomRef.current) {
      scrollToBottom(false);
    } else {
      setNewMessagesWhileScrolled((prev) => prev + 1);
    }
  }, [messages.length, activeTransfers.length, scrollToBottom]);

  useEffect(() => {
    return () => {
      if (audioStreamRef.current) {
        audioStreamRef.current.getTracks().forEach((t) => {
          try {
            t.stop();
          } catch {}
        });
        audioStreamRef.current = null;
      }
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    let isCancelled = false;
    const loadBlobs = async () => {
      for (const msg of messages) {
        if (!msg.fileId) continue;
        if (fileRecordsMap.has(msg.fileId) && downloadUrls.has(msg.fileId)) continue;
        // The record carried by the message row is authoritative and needs no
        // database round trip, so a photo appears the moment it is sent and a
        // received one appears as soon as its bytes are stored.
        const inline = msg.fileRecord;
        const rec = inline?.blobRef ? inline : await db.files.get(msg.fileId) || inline;
        if (!rec || isCancelled) continue;
        // Always keep the freshest record: the message row may carry metadata
        // only, while db.files holds the bytes that arrived a moment later.
        setFileRecordsMap((prev) => {
          const current = prev.get(rec.fileId!);
          if (current && current.blobRef === rec.blobRef && current.previewUrl === rec.previewUrl) {
            return prev;
          }
          return new Map(prev).set(rec.fileId!, rec);
        });
        if (rec.blobRef && !downloadUrls.has(rec.fileId)) {
          const url = URL.createObjectURL(rec.blobRef);
          setDownloadUrls((prev) =>
            prev.has(rec.fileId) ? prev : new Map(prev).set(rec.fileId!, url)
          );
        }
      }
    };
    loadBlobs();
    return () => {
      isCancelled = true;
    };
    // Re-runs when a freshly stored file record appears, so an attachment is
    // rendered the moment it lands instead of waiting for a new message.
  }, [messages, fileRecordsMap, vaultVersion]);

  // Attachments are handed out as object URLs; releasing them when the
  // conversation closes keeps a long session from leaking memory.
  const downloadUrlsRef = useRef(downloadUrls);
  downloadUrlsRef.current = downloadUrls;
  useEffect(
    () => () => {
      downloadUrlsRef.current.forEach((url) => {
        try {
          URL.revokeObjectURL(url);
        } catch {}
      });
    },
    []
  );

  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const text = inputText.trim();
    if (!text || isSending) return;

    try {
      setIsSending(true);
      await onSendMessage(text, {
        isGroup: !!activeGroup,
        groupId: activeGroup?.groupId,
      });
      setInputText('');
      peerManager?.setTypingState?.(false);
      setTimeout(() => scrollToBottom(true), 50);
    } catch (err) {
      console.error('Send error:', err);
    } finally {
      setIsSending(false);
    }
  };

  /**
   * One picker for everything: photos, videos, documents, archives, audio.
   * Each selected file is sent as its own message so nothing is batched away.
   */
  const sendFiles = async (files: File[]) => {
    if (files.length === 0) return;
    setAttachError(null);
    for (const file of files) {
      try {
        await onSendFile(file, {
          isGroup: !!activeGroup,
          groupId: activeGroup?.groupId,
        });
      } catch (err: any) {
        setAttachError(err?.message || `Could not send ${file.name}`);
      }
    }
    setTimeout(() => scrollToBottom(true), 50);
  };

  const handleFilesSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files || []);
    if (mediaInputRef.current) mediaInputRef.current.value = '';
    if (imageInputRef.current) imageInputRef.current.value = '';
    await sendFiles(picked);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingFiles(false);
    const dropped = Array.from(e.dataTransfer?.files || []);
    await sendFiles(dropped);
  };

  const startRecording = async () => {
    try {
      isRecordingCancelledRef.current = false;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      audioStreamRef.current = stream;

      try {
        mediaRecorderRef.current = new MediaRecorder(stream, {
          mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : undefined,
        });
      } catch {
        mediaRecorderRef.current = new MediaRecorder(stream);
      }
      const recorder = mediaRecorderRef.current;
      audioChunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        recordingActiveRef.current = false;
        if (isRecordingCancelledRef.current || audioChunksRef.current.length === 0) {
          audioChunksRef.current = [];
          setRecordingDuration(0);
          cleanupRecordingStream();
          return;
        }

        const mimeType = recorder.mimeType || 'audio/webm';
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
        const audioFile = new File([
          audioBlob,
        ], `voice-note-${Date.now()}.${mimeType.includes('mp4') ? 'm4a' : 'webm'}` as any, {
          type: mimeType,
          lastModified: Date.now(),
        });

        try {
          await onSendFile(audioFile, {
            isGroup: !!activeGroup,
            groupId: activeGroup?.groupId,
          });
          setTimeout(scrollToBottom, 50);
        } catch (err) {
          console.error('Voice send error:', err);
        }

        audioChunksRef.current = [];
        setRecordingDuration(0);
        cleanupRecordingStream();
      };

      recordingActiveRef.current = true;
      try {
        recorder.start(200);
      } catch (err) {
        console.error('MediaRecorder start failed:', err);
        cleanupRecordingStream();
        return;
      }
      setIsRecording(true);
      setRecordingDuration(0);

      recordingTimerRef.current = setInterval(() => {
        setRecordingDuration((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      console.error('Failed to access microphone:', err);
    }
  };

  const cleanupRecordingStream = () => {
    if (audioStreamRef.current) {
      audioStreamRef.current.getTracks().forEach((track) => track.stop());
      audioStreamRef.current = null;
    }
  };

  const stopRecording = (cancel = false) => {
    isRecordingCancelledRef.current = cancel;
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      try {
        recorder.stop();
        setIsRecording(false);
      } catch {
        setIsRecording(false);
        cleanupRecordingStream();
      }
    } else {
      setIsRecording(false);
      cleanupRecordingStream();
    }
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const openImageViewer = (fileRec: FileRecord, blobUrl?: string, msg?: MessageRecord) => {
    setSelectedImageFile(fileRec);
    setSelectedImageBlobUrl(blobUrl);
    setSelectedImageMessage(msg || null);
    setIsImageViewerOpen(true);
  };

  const openCodeModal = (snippet: CodeSnippet) => {
    setSelectedSnippetForModal(snippet);
    setIsCodeModalOpen(true);
  };

  const toggleRevealMedia = (fileId: string) => {
    setRevealedMediaIds((prev) => {
      const next = new Set(prev);
      if (next.has(fileId)) {
        next.delete(fileId);
      } else {
        next.add(fileId);
      }
      return next;
    });
  };

  const getFileIcon = (mimeType?: string, fileName?: string) => {
    if (mimeType?.startsWith('image/')) return <ImageIcon className="w-4 h-4 text-white" />;
    if (mimeType?.startsWith('audio/')) return <Music className="w-4 h-4 text-white" />;
    if (mimeType?.startsWith('video/')) return <Film className="w-4 h-4 text-white" />;
    if (
      fileName?.endsWith('.zip') ||
      fileName?.endsWith('.tar') ||
      fileName?.endsWith('.gz') ||
      fileName?.endsWith('.7z')
    ) {
      return <FileArchive className="w-4 h-4 text-white" />;
    }
    if (
      fileName?.endsWith('.ts') ||
      fileName?.endsWith('.js') ||
      fileName?.endsWith('.json') ||
      fileName?.endsWith('.html') ||
      fileName?.endsWith('.css')
    ) {
      return <FileCode className="w-4 h-4 text-white" />;
    }
    return <FileText className="w-4 h-4 text-white" />;
  };

  if (!activeContact && !activeGroup) {
    // No conversation open: keep the pane empty instead of showing placeholder copy.
    return <div className="flex-1 h-full canvas-surface" />;
  }

  const isGroup = !!activeGroup;
  const presence = describePresence(
    activeContact ? { ...activeContact, isLan: isLanLink || activeContact.isLan } : null,
    isConnected
  );
  const headerInitial = isGroup
    ? activeGroup!.name.charAt(0).toUpperCase()
    : (activeContact!.alias || activeContact!.deviceId.slice(4, 6)).charAt(0).toUpperCase();
  const headerAvatarColor = isGroup
    ? activeGroup!.avatarColor || '#2563eb'
    : activeContact!.avatarColor || '#2563eb';

  // Presence wording: LAN means the two devices talk directly on the same
  // network, “Online” that the relay can still reach the device.
  const peerOnline = presence.isOnline;
  const presenceLabel =
    presence.state === 'lan' ? 'Online · LAN' : presence.label;

  return (
    <div
      onDragOver={(e) => {
        if (e.dataTransfer?.types?.includes('Files')) {
          e.preventDefault();
          setIsDraggingFiles(true);
        }
      }}
      onDragLeave={() => setIsDraggingFiles(false)}
      onDrop={handleDrop}
      className="flex-1 h-full min-h-0 flex flex-col canvas-surface text-zinc-50 font-sans select-none overflow-hidden relative"
    >
      {/* Top Header */}
      <div className="shrink-0 mx-2 sm:mx-4 mt-1 mb-2 px-2 sm:px-3 py-1.5 sm:py-2 rounded-2xl border border-zinc-800 panel-surface shadow-[var(--sc-shadow-sm)] flex items-center justify-between gap-2 z-10">
        <div className="flex items-center gap-3 min-w-0">
          {onBackToPeers && (
            <button
              onClick={onBackToPeers}
              className="lg:hidden p-1.5 -ml-1 text-zinc-400 hover:text-white rounded-lg transition-colors"
              aria-label="Back to contacts"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          )}

          <div className="relative shrink-0">
            <Avatar
              name={isGroup ? activeGroup!.name : activeContact!.alias || activeContact!.deviceId}
              avatarUrl={isGroup ? activeGroup?.avatarUrl : activeContact?.avatarUrl}
              avatarColor={headerAvatarColor}
              size="md"
              isOnline={!isGroup ? (isConnected || activeContact?.isOnline) : undefined}
              showBadge={!isGroup}
            />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="font-semibold text-white text-sm truncate">
                {isGroup ? activeGroup!.name : activeContact!.alias || activeContact!.deviceId}
              </h2>
            </div>

            <div className="flex items-center gap-1.5 text-[11px]">
              {isGroup ? (
                <button
                  onClick={() => onOpenGroupDetails?.(activeGroup!)}
                  className="hover:text-blue-400 transition-colors flex items-center gap-1"
                  aria-label="Group details"
                >
                  <Users className="w-3 h-3" />
                  <span>{activeGroup!.memberDeviceIds.length} members</span>
                </button>
              ) : (
                <>
                  <span
                    className={`flex items-center gap-1.5 ${
                      peerOnline ? 'text-[var(--sc-e400)]' : 'text-zinc-500'
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        isPeerTyping
                          ? 'sc-typing-dot'
                          : peerOnline
                          ? 'bg-[var(--sc-e400)]'
                          : 'bg-zinc-600'
                      }`}
                    />
                    <span className={`truncate ${isPeerTyping ? 'text-[var(--sc-e400)]' : ''}`}>
                      {isPeerTyping ? 'typing…' : presenceLabel}
                    </span>
                  </span>
                  {isLanLink && (
                    <span
                      className="inline-flex items-center gap-1 rounded-full border border-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500"
                      title="Direct local network link — messages and files never leave your network"
                    >
                      <Wifi className="w-2.5 h-2.5" />
                      Direct
                    </span>
                  )}
                  {activeContact?.status && (
                    <span
                      className="hidden xs:inline-flex items-center gap-1 rounded-full border border-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400 max-w-[110px]"
                      title={`Status: ${activeContact.status}`}
                    >
                      <span
                        className="w-1.5 h-1.5 rounded-full shrink-0"
                        style={{ backgroundColor: statusColor(activeContact.status) }}
                      />
                      <span className="truncate">{activeContact.status}</span>
                    </span>
                  )}
                  {latencyMs !== undefined && peerOnline && (
                    <span className="text-zinc-500">{latencyMs}ms</span>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        {/* Header Action Buttons */}
        <div className="flex items-center gap-1 shrink-0">
          {/* Audio Call */}
          <button
            onClick={() => {
              if (isGroup) {
                onStartGroupCall?.(activeGroup!, 'audio');
              } else if (activeContact) {
                onStartCall?.(activeContact.deviceId, activeContact.alias || activeContact.deviceId, 'audio');
              }
            }}
            className="p-2 rounded-full text-zinc-500 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer"
            title={isGroup ? 'Group voice call' : 'Voice call'}
            aria-label="Voice Call"
          >
            <Phone className="w-4 h-4" />
          </button>

          {/* Video Call */}
          <button
            onClick={() => {
              if (isGroup) {
                onStartGroupCall?.(activeGroup!, 'video');
              } else if (activeContact) {
                onStartCall?.(activeContact.deviceId, activeContact.alias || activeContact.deviceId, 'video');
              }
            }}
            className="p-2 rounded-full text-zinc-500 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer"
            title={isGroup ? 'Group video call' : 'Video call'}
            aria-label="Video Call"
          >
            <Video className="w-4 h-4" />
          </button>

          {/* Secondary actions. On phones they collapse into one menu so the
              header never pushes controls off screen. */}
          {isGroup ? (
            <button
              onClick={() => onOpenGroupDetails?.(activeGroup!)}
              className="grid place-items-center h-9 w-9 rounded-full text-zinc-500 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer"
              title="Group details"
              aria-label="Group details"
            >
              <Info className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={() => setIsChatSettingsOpen(true)}
              className="grid place-items-center h-9 w-9 rounded-full text-zinc-500 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer"
              title="Chat settings"
              aria-label="Chat settings"
            >
              <Sliders className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Messages Stream Body */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 sm:px-6 py-3 sm:py-4 space-y-3 sm:space-y-4 select-text"
      >
        {messages.length === 0 ? null : (
          messages.map((msg, idx) => {
            const isYou = msg.direction === 'OUTBOUND';
            const previous = idx > 0 ? messages[idx - 1] : undefined;
            const startsNewDay =
              !previous || startOfDay(previous.timestamp) !== startOfDay(msg.timestamp);
            const fileRec = msg.fileId ? fileRecordsMap.get(msg.fileId) || msg.fileRecord : undefined;
            const downloadUrl = msg.fileId ? downloadUrls.get(msg.fileId) : undefined;
            const isImage = fileRec?.isImage || msg.mediaType === 'image';
            const isAudio = fileRec?.isAudio || msg.mediaType === 'audio';
            const isVideo = fileRec?.isVideo || msg.mediaType === 'video';

            // An attachment sent to us can be announced before its bytes land.
            // These three flags decide what the bubble shows meanwhile, and
            // whether it offers to fetch the file again.
            const isInboundAttachment = !isYou && !!msg.fileId;
            const attachmentFailed =
              isInboundAttachment && msg.attachmentState === 'failed';
            const attachmentStalled =
              isInboundAttachment && !attachmentFailed && Date.now() - msg.timestamp > 45000;

            const parsedParts = (!msg.fileId && !msg.codeSnippet && msg.payloadText)
              ? parseMessageContent(msg.payloadText)
              : [];

            const hasCodeSnippet = !!msg.codeSnippet;
            const hasParsedCode = parsedParts.some((p) => p.type === 'code');
            const isCode = msg.mediaType === 'code' || hasCodeSnippet || hasParsedCode;

            const timeStr = new Date(msg.timestamp).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            });

            return (
              <React.Fragment key={msg.id || idx}>
              {startsNewDay && (
                <div className="flex items-center gap-3 py-1 select-none">
                  <span className="h-px flex-1 bg-zinc-800/70" />
                  <span className="text-[10px] uppercase tracking-wider text-zinc-500">
                    {formatDayLabel(msg.timestamp)}
                  </span>
                  <span className="h-px flex-1 bg-zinc-800/70" />
                </div>
              )}
              <div
                className={`flex flex-col ${isYou ? 'items-end' : 'items-start'} space-y-1 w-full max-w-full`}
              >
                {/* Group Sender Tag */}
                {isGroup && !isYou && msg.senderDisplayName && (
                  <span className="text-[11px] font-semibold text-blue-400 px-1">
                    {msg.senderDisplayName}
                  </span>
                )}

                <div
                  className={`w-fit max-w-[92%] sm:max-w-[80%] md:max-w-[72%] rounded-[20px] overflow-hidden shadow-sm transition-all ${
                    isYou ? 'bubble-out' : 'bubble-in'
                  }`}
                >
                  {/* Photo / Image View */}
                  {isImage && (
                    <div className="relative group">
                      {downloadUrl ? (
                        <img
                          src={downloadUrl}
                          alt={fileRec?.name || 'Encrypted Photo'}
                          className="max-h-72 w-auto object-cover cursor-pointer hover:opacity-95 transition-opacity"
                          onClick={() => fileRec && openImageViewer(fileRec, downloadUrl, msg)}
                        />
                      ) : fileRec?.previewUrl ? (
                        <div className="relative">
                          <img
                            src={fileRec.previewUrl}
                            alt={fileRec?.name || 'Photo'}
                            className="max-h-72 w-auto object-cover blur-[2px] transition-all"
                          />
                          <div className="absolute inset-0 grid place-items-center bg-black/35">
                            <span className="inline-flex items-center gap-2 rounded-full bg-black/60 px-3 py-1.5 text-[11px] font-medium text-white">
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              Receiving…
                            </span>
                          </div>
                        </div>
                      ) : attachmentFailed || attachmentStalled ? (
                        <button
                          type="button"
                          onClick={() => onRetryAttachment?.(msg)}
                          className="w-64 h-48 bg-zinc-900 flex flex-col items-center justify-center gap-2 text-xs text-zinc-400 hover:text-white transition-colors cursor-pointer"
                        >
                          <RotateCcw className="w-5 h-5" />
                          <span>The photo has not arrived yet</span>
                          <span className="text-[10px] text-zinc-500">Tap to fetch it again</span>
                        </button>
                      ) : (
                        <div className="w-64 h-48 bg-zinc-900 flex flex-col items-center justify-center gap-2 text-xs text-zinc-500">
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span>Receiving…</span>
                        </div>
                      )}
                      <div className="p-2.5 flex items-center justify-between gap-2 border-t border-black/10">
                        <span
                          className="truncate max-w-[150px] font-medium opacity-80 cursor-pointer hover:underline"
                          onClick={() => fileRec && openImageViewer(fileRec, downloadUrl, msg)}
                        >
                          {fileRec?.name || 'Photo'}
                        </span>
                        {downloadUrl && (
                          <a
                            href={downloadUrl}
                            download={fileRec?.name || 'photo.png'}
                            className="p-1.5 rounded-lg bg-black/10 hover:bg-black/20 text-current transition-colors cursor-pointer"
                            title="Download Photo"
                            aria-label="Download Photo"
                          >
                            <Download className="w-3.5 h-3.5" />
                          </a>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Audio Voice Note Player */}
                  {isAudio && (
                    <div className="p-3 flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${isYou ? 'bg-black/10 text-black' : 'bg-zinc-800 text-zinc-200'}`}>
                        <Music className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium">Voice Note</div>
                        {downloadUrl && (
                          <audio controls src={downloadUrl} className="mt-1 w-full h-8 max-w-[200px]" />
                        )}
                      </div>
                    </div>
                  )}

                  {/* Video attachment plays right in the conversation */}
                  {isVideo && (
                    <div className="relative">
                      {downloadUrl ? (
                        <video
                          controls
                          playsInline
                          preload="metadata"
                          src={downloadUrl}
                          className="max-h-72 w-full max-w-md bg-black"
                        />
                      ) : attachmentFailed || attachmentStalled ? (
                        <button
                          type="button"
                          onClick={() => onRetryAttachment?.(msg)}
                          className="w-64 h-40 bg-zinc-900 grid place-items-center text-xs text-zinc-400 hover:text-white transition-colors cursor-pointer"
                        >
                          <span className="inline-flex items-center gap-2">
                            <RotateCcw className="w-4 h-4" />
                            Tap to fetch the video again
                          </span>
                        </button>
                      ) : (
                        <div className="w-64 h-40 bg-zinc-900 flex flex-col items-center justify-center gap-2 text-xs text-zinc-500">
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span>Receiving video…</span>
                        </div>
                      )}
                      <div className="p-2.5 flex items-center justify-between gap-2 border-t border-black/10">
                        <span className="truncate max-w-[150px] font-medium opacity-80 text-xs">
                          {fileRec?.name || 'Video'}
                        </span>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {fileRec && (fileRec.blobRef || downloadUrl) && (
                            <button
                              type="button"
                              onClick={() => setPreviewFile(fileRec)}
                              className="p-1.5 rounded-lg bg-black/10 hover:bg-black/20 text-current transition-colors cursor-pointer"
                              title="Open viewer"
                              aria-label="Open video viewer"
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {downloadUrl && (
                            <a
                              href={downloadUrl}
                              download={fileRec?.name || 'video.mp4'}
                              className="p-1.5 rounded-lg bg-black/10 hover:bg-black/20 text-current transition-colors cursor-pointer"
                              title="Download video"
                              aria-label="Download video"
                            >
                              <Download className="w-3.5 h-3.5" />
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Explicit Staged Code Snippet Card */}
                  {msg.codeSnippet && (
                    <div className="p-1.5">
                      <CodeBlockCard
                        code={msg.codeSnippet.code}
                        language={msg.codeSnippet.language}
                        title={msg.codeSnippet.title}
                        lineCount={msg.codeSnippet.lineCount}
                        onOpenModal={openCodeModal}
                      />
                      {msg.payloadText && msg.payloadText !== msg.codeSnippet.code && (
                        <div className={`px-3 py-2 text-xs font-sans whitespace-pre-wrap break-words ${isYou ? 'text-black' : 'text-zinc-50'}`}>
                          {msg.payloadText}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Parsed Message Parts (Auto-detected Code Blocks or Markdown Blocks) */}
                  {!msg.fileId && !msg.codeSnippet && parsedParts.length > 0 && (
                    <div className="p-2 space-y-1.5">
                      {parsedParts.map((part, pIdx) => {
                        if (part.type === 'code') {
                          return (
                            <CodeBlockCard
                              key={pIdx}
                              code={part.content}
                              language={part.language}
                              title={part.title}
                              lineCount={part.lineCount}
                              onOpenModal={openCodeModal}
                            />
                          );
                        }
                        return (
                          <div
                            key={pIdx}
                            className={`px-2 py-1 text-xs whitespace-pre-wrap break-words leading-relaxed font-sans ${
                              isYou ? 'text-black' : 'text-zinc-50'
                            }`}
                          >
                            {part.content}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Standard File Attachment Card */}
                  {msg.fileId && !isImage && !isAudio && !isVideo && !isCode && (
                    <div className="p-3 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className={`p-2 rounded-xl shrink-0 ${isYou ? 'bg-black/10' : 'bg-zinc-800'}`}>
                          {getFileIcon(fileRec?.mimeType, fileRec?.name)}
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium text-xs truncate max-w-[160px]">
                            {fileRec?.name || msg.payloadText}
                          </p>
                          <p className="text-[11px] opacity-70 font-mono">
                            {!downloadUrl && isInboundAttachment
                              ? attachmentFailed || attachmentStalled
                                ? 'Not received yet'
                                : 'Receiving…'
                              : fileRec
                              ? `${(fileRec.size / 1024).toFixed(1)} KB`
                              : 'File'}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {!downloadUrl && isInboundAttachment && (attachmentFailed || attachmentStalled) && (
                          <button
                            type="button"
                            onClick={() => onRetryAttachment?.(msg)}
                            className={`p-2 rounded-xl transition-colors cursor-pointer ${
                              isYou
                                ? 'bg-black/10 hover:bg-black/20 text-black'
                                : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200'
                            }`}
                            title="Fetch this file again"
                            aria-label="Fetch this file again"
                          >
                            <RotateCcw className="w-4 h-4" />
                          </button>
                        )}
                        {fileRec &&
                          (fileRec.blobRef || downloadUrl) && (
                            <button
                              type="button"
                              onClick={() => setPreviewFile(fileRec)}
                              className={`p-2 rounded-xl transition-colors cursor-pointer ${
                                isYou
                                  ? 'bg-black/10 hover:bg-black/20 text-black'
                                  : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200'
                              }`}
                              title="Preview without downloading"
                              aria-label="Preview file"
                            >
                              <Eye className="w-4 h-4" />
                            </button>
                          )}
                        {downloadUrl && (
                          <a
                            href={downloadUrl}
                            download={fileRec?.name || 'file.bin'}
                            className={`p-2 rounded-xl transition-colors cursor-pointer ${
                              isYou ? 'bg-black/10 hover:bg-black/20 text-black' : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200'
                            }`}
                            title="Download File"
                            aria-label="Download File"
                          >
                            <Download className="w-4 h-4" />
                          </a>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Fallback Standard Text Message Content if not parsed */}
                  {!msg.fileId && !msg.codeSnippet && parsedParts.length === 0 && (
                    <div className="px-4 py-2.5 text-xs whitespace-pre-wrap break-words leading-relaxed">
                      {msg.payloadText}
                    </div>
                  )}
                </div>

                {/* Status Timestamp & Delivery Checkmarks */}
                <div
                  className={`flex items-center gap-1 text-[10px] text-zinc-500 font-mono px-1 select-none ${
                    isYou ? 'justify-end' : 'justify-start'
                  }`}
                >
                  <span>{timeStr}</span>
                  {isYou && (
                    <>
                      {(!msg.status || msg.status === 'sending' || msg.status === 'queued') && (
                        <Clock className="w-3 h-3 text-zinc-500" aria-label="Sending" />
                      )}
                      {msg.status === 'sent' && (
                        <Check className="w-3 h-3 text-zinc-400" aria-label="Sent" />
                      )}
                      {msg.status === 'delivered' && (
                        <CheckCheck className="w-3 h-3 text-zinc-400" aria-label="Delivered" />
                      )}
                      {msg.status === 'read' && (
                        <CheckCheck
                          className="w-3 h-3 text-[var(--sc-e400)]"
                          aria-label="Read"
                        />
                      )}
                      {msg.status === 'failed' && (
                        <button
                          type="button"
                          onClick={() => msg.messageId && onRetryMessage?.(msg.messageId)}
                          className="inline-flex items-center gap-1 text-rose-400 hover:text-rose-300 transition-colors cursor-pointer font-medium"
                          title="Delivery failed — tap to send again"
                        >
                          <CircleAlert className="w-3 h-3" />
                          <span>Retry</span>
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
              </React.Fragment>
            );
          })
        )}
        {isPeerTyping && !isGroup && (
          <div className="flex items-start w-full sc-fade-in">
            <div className="rounded-[20px] bubble-in px-4 py-3 flex items-center gap-1.5">
              <span className="sc-typing-dot h-1.5 w-1.5" />
              <span className="sc-typing-dot h-1.5 w-1.5" style={{ animationDelay: '0.15s' }} />
              <span className="sc-typing-dot h-1.5 w-1.5" style={{ animationDelay: '0.3s' }} />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Drag & drop target for files and photos */}
      {isDraggingFiles && (
        <div className="pointer-events-none absolute inset-0 z-30 flex flex-col items-center justify-center gap-2 bg-zinc-950/75 backdrop-blur-sm text-zinc-200">
          <UploadCloud className="h-8 w-8" />
          <p className="text-sm font-medium">Drop to send</p>
        </div>
      )}

      {/* Floating Jump to Bottom Button when Scrolled Up */}
      {isUserScrolledUp && (
        <button
          onClick={() => scrollToBottom(true)}
          className="absolute right-6 bottom-24 sm:bottom-28 z-20 flex items-center gap-1.5 px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-white rounded-full text-xs font-medium shadow-xl transition-all animate-in animate-slide-up cursor-pointer"
          aria-label="Jump to bottom"
        >
          <ChevronDown className="w-3.5 h-3.5" />
          <span>Latest</span>
          {newMessagesWhileScrolled > 0 && (
            <span className="px-1.5 py-0.2 bg-emerald-400 text-zinc-950 rounded-full text-[10px] font-bold">
              {newMessagesWhileScrolled}
            </span>
          )}
        </button>
      )}

      {/* Live transfers: an honest progress line instead of a silent wait */}
      {liveTransfers.length > 0 && (
        <div className="px-3 sm:px-6 pb-2 shrink-0 space-y-1.5">
          {liveTransfers.map((transfer) => (
            <div
              key={`${transfer.direction}-${transfer.fileId}`}
              className="flex items-center gap-2.5 rounded-2xl border border-zinc-800 bg-zinc-900/70 px-3 py-2 text-[11px] text-zinc-300"
            >
              <ArrowUpFromLine
                className={`h-3.5 w-3.5 shrink-0 ${
                  transfer.direction === 'OUTBOUND' ? 'text-emerald-400' : 'text-sky-400'
                } ${transfer.direction === 'INBOUND' ? 'rotate-180' : ''}`}
              />
              <span className="truncate max-w-[38%] font-medium">
                {transfer.direction === 'OUTBOUND' ? 'Sending' : 'Receiving'} {transfer.name}
              </span>
              <div className="flex-1 h-1 rounded-full bg-zinc-800 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-sky-400 transition-[width] duration-300"
                  style={{ width: `${Math.max(4, Math.min(100, transfer.progressPercent || 0))}%` }}
                />
              </div>
              <span className="tabular-nums text-zinc-500 shrink-0">
                {Math.round(transfer.progressPercent || 0)}%
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Attachment error (e.g. size limits on the relay path) */}
      {attachError && (
        <div className="px-3 sm:px-6 pb-2 shrink-0">
          <div className="flex items-start gap-2 rounded-2xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-500">
            <span className="flex-1 min-w-0">{attachError}</span>
            <button
              type="button"
              onClick={() => setAttachError(null)}
              className="font-semibold hover:opacity-70 cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Voice Recording Overlay */}
      {isRecording && (
        <div className="px-4 pb-3 shrink-0">
          <div className="px-4 py-2.5 bg-rose-950/30 border border-rose-800/50 rounded-xl flex items-center justify-between gap-3 text-xs shadow-sm">
            <div className="flex items-center gap-2 text-rose-400">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse" />
              <span className="font-semibold">Recording Voice:</span>
              <span className="font-mono text-white">{formatDuration(recordingDuration)}</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => stopRecording(true)}
                className="px-3 py-1 bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg transition-colors font-medium text-[11px]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => stopRecording(false)}
                className="px-3 py-1 bg-rose-600 hover:bg-rose-500 text-white rounded-lg transition-colors font-medium text-[11px] flex items-center gap-1"
              >
                <Send className="w-3 h-3" />
                <span>Send</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Message Composer Bar */}
      <div className="shrink-0 px-2.5 sm:px-6 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:pb-6">
        <form
          onSubmit={handleSend}
          className="flex items-end gap-1 rounded-[26px] border border-zinc-800 panel-surface px-1.5 py-1.5 sm:px-2.5 sm:py-2 shadow-lg transition-colors focus-within:border-zinc-700"
        >
          {/* Universal attachment picker: photos, videos, documents, archives… */}
          <input
            type="file"
            ref={mediaInputRef}
            onChange={handleFilesSelected}
            multiple
            className="hidden"
            aria-hidden="true"
            tabIndex={-1}
          />
          <input
            type="file"
            ref={imageInputRef}
            onChange={handleFilesSelected}
            accept="image/*,video/*"
            multiple
            className="hidden"
            aria-hidden="true"
            tabIndex={-1}
          />

          <button
            type="button"
            onClick={() => mediaInputRef.current?.click()}
            className="grid place-items-center h-9 w-9 rounded-full text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer shrink-0"
            title="Attach any file"
            aria-label="Attach any file"
          >
            <Paperclip className="h-[18px] w-[18px]" />
          </button>

          <button
            type="button"
            onClick={() => imageInputRef.current?.click()}
            className="grid place-items-center h-9 w-9 rounded-full text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer shrink-0"
            title="Send photos or videos"
            aria-label="Send photos or videos"
          >
            <ImageIcon className="h-[18px] w-[18px]" />
          </button>

          <input
            type="text"
            value={inputText}
            onChange={(e) => {
              setInputText(e.target.value);
              // Throttled inside the manager, so typing never floods the link.
              peerManager?.setTypingState?.(e.target.value.length > 0);
            }}
            placeholder="Message"
            enterKeyHint="send"
            className="flex-1 min-w-0 bg-transparent border-0 px-1.5 py-2 text-[15px] sm:text-sm text-white placeholder-zinc-500 focus:outline-none"
            aria-label="Message input"
          />

          <button
            type="button"
            onClick={isRecording ? () => stopRecording(false) : startRecording}
            className={`grid place-items-center h-9 w-9 rounded-full transition-colors shrink-0 cursor-pointer ${
              isRecording
                ? 'bg-rose-600 text-white'
                : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
            }`}
            title={isRecording ? 'Stop recording' : 'Record voice note'}
            aria-label={isRecording ? 'Stop recording' : 'Record voice note'}
            aria-pressed={isRecording}
          >
            <Mic className="h-[18px] w-[18px]" />
          </button>

          <button
            type="submit"
            disabled={!inputText.trim() || isSending}
            className="grid place-items-center h-10 w-10 btn-primary disabled:opacity-30 disabled:cursor-not-allowed shadow-sm active:scale-95 shrink-0"
            title="Send message"
            aria-label="Send message"
          >
            <Send className="h-[18px] w-[18px]" />
          </button>
        </form>
      </div>

      {/* Code Viewer Modal */}
      {isCodeModalOpen && selectedSnippetForModal && (
        <CodeViewerModal
          isOpen={isCodeModalOpen}
          snippet={selectedSnippetForModal}
          onClose={() => {
            setIsCodeModalOpen(false);
            setSelectedSnippetForModal(null);
          }}
        />
      )}

      {/* Fullscreen Image Viewer Modal */}
      {isImageViewerOpen && selectedImageFile && (
        <ImageViewerModal
          isOpen={isImageViewerOpen}
          fileRecord={selectedImageFile}
          blobUrl={selectedImageBlobUrl}
          message={selectedImageMessage}
          onClose={() => {
            setIsImageViewerOpen(false);
            setSelectedImageFile(null);
            setSelectedImageBlobUrl(undefined);
            setSelectedImageMessage(null);
          }}
        />
      )}

      {/* File viewer (text, code, PDF, DOCX, archives, media) — read only */}
      {previewFile && (
        <FilePreviewModal
          isOpen={!!previewFile}
          file={previewFile}
          blobUrl={downloadUrls.get(previewFile.fileId)}
          onClose={() => setPreviewFile(null)}
        />
      )}

      {/* Per-Chat Extended Settings Modal */}
      {isChatSettingsOpen && activeContact && (
        <ChatSettingsModal
          isOpen={isChatSettingsOpen}
          contact={activeContact}
          onClose={() => setIsChatSettingsOpen(false)}
          onSettingsChanged={(updated) => setChatSettings(updated)}
          onClearHistory={onClearHistory}
          onDeleteContact={onDeleteContact}
        />
      )}
    </div>
  );
};