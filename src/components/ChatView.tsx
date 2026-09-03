import React, { useState, useRef, useEffect, useCallback } from 'react';
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
  ShieldCheck,
  ShieldAlert,
  Clock,
  ArrowLeft,
  Info,
  Mic,
  Image as ImageIcon,
  FileCode,
  FileArchive,
  Film,
  Music,
  Check,
  CheckCheck,
  Lock,
  Phone,
  Video,
  Eye,
  EyeOff,
  Sliders,
  RotateCw,
  FileText,
  Code2,
  Maximize2,
  ChevronDown,
  Users,
  Copy,
  Plus,
} from 'lucide-react';
import { db } from '../db/index';
import { ImageViewerModal } from './ImageViewerModal';
import { ChatSettingsModal } from './ChatSettingsModal';
import { CodeViewerModal } from './CodeViewerModal';
import { getChatSettings, ChatCustomSettings } from '../utils/chatSettings';
import { detectCodeLanguage, parseMarkdownCodeBlock } from '../utils/codeHelper';

interface ChatViewProps {
  activeContact: ContactRecord | null;
  activeGroup?: GroupRecord | null;
  messages: MessageRecord[];
  activeTransfers: FileTransferProgress[];
  isConnected: boolean;
  latencyMs?: number;
  peerManager?: any;
  onSendMessage: (
    text: string,
    options?: { codeSnippet?: CodeSnippet; isGroup?: boolean; groupId?: string }
  ) => Promise<void>;
  onSendFile: (file: File, options?: { isGroup?: boolean; groupId?: string }) => Promise<void>;
  onStartCall?: (peerDeviceId: string, peerDisplayName: string, callType: 'audio' | 'video') => void;
  onStartGroupCall?: (group: GroupRecord, callType: 'audio' | 'video') => void;
  onBackToPeers?: () => void;
  onVerifyContact?: (contact: ContactRecord) => void;
  onOpenGroupDetails?: (group: GroupRecord) => void;
}

const SUPPORTED_LANGUAGES = [
  'typescript',
  'javascript',
  'python',
  'rust',
  'go',
  'cpp',
  'html',
  'css',
  'json',
  'sql',
  'bash',
  'text',
];

export const ChatView: React.FC<ChatViewProps> = ({
  activeContact,
  activeGroup,
  messages,
  activeTransfers,
  isConnected,
  latencyMs,
  peerManager,
  onSendMessage,
  onSendFile,
  onStartCall,
  onStartGroupCall,
  onBackToPeers,
  onVerifyContact,
  onOpenGroupDetails,
}) => {
  const [inputText, setInputText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [copiedSnippetId, setCopiedSnippetId] = useState<string | number | null>(null);

  // Staged text/code snippet attachment (like Claude.ai)
  const [stagedSnippet, setStagedSnippet] = useState<CodeSnippet | null>(null);
  const [showCodeComposer, setShowCodeComposer] = useState(false);
  const [composerCode, setComposerCode] = useState('');
  const [composerLang, setComposerLang] = useState('typescript');
  const [composerTitle, setComposerTitle] = useState('');

  // Code Viewer Modal State
  const [selectedSnippetForModal, setSelectedSnippetForModal] = useState<CodeSnippet | null>(null);
  const [isCodeModalOpen, setIsCodeModalOpen] = useState(false);

  // Scroll management: prevent unwanted jump to bottom when scrolling up
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [isUserScrolledUp, setIsUserScrolledUp] = useState(false);
  const [newMessagesWhileScrolled, setNewMessagesWhileScrolled] = useState(0);
  const isNearBottomRef = useRef(true);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // File cache for downloads & previews
  const [downloadUrls, setDownloadUrls] = useState<Map<string, string>>(new Map());
  const [fileRecordsMap, setFileRecordsMap] = useState<Map<string, FileRecord>>(new Map());

  // Fullscreen Image Viewer Modal state
  const [selectedImageFile, setSelectedImageFile] = useState<FileRecord | null>(null);
  const [selectedImageBlobUrl, setSelectedImageBlobUrl] = useState<string | undefined>(undefined);
  const [selectedImageMessage, setSelectedImageMessage] = useState<MessageRecord | null>(null);
  const [isImageViewerOpen, setIsImageViewerOpen] = useState(false);

  // Chat Settings Modal state & Per-Chat Preferences
  const [isChatSettingsOpen, setIsChatSettingsOpen] = useState(false);
  const [chatSettings, setChatSettings] = useState<ChatCustomSettings>(() =>
    activeContact ? getChatSettings(activeContact.deviceId) : ({} as any)
  );

  // Set of media IDs revealed by the user
  const [revealedMediaIds, setRevealedMediaIds] = useState<Set<string>>(new Set());

  // Voice recording
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<any>(null);
  const isRecordingCancelledRef = useRef<boolean>(false);
  const audioStreamRef = useRef<MediaStream | null>(null);

  // Reload chat settings when active contact changes
  useEffect(() => {
    if (activeContact) {
      setChatSettings(getChatSettings(activeContact.deviceId));
      setRevealedMediaIds(new Set());
    }
  }, [activeContact?.deviceId]);

  // Handle Scroll events to track if user is reading previous messages
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

  // Auto-scroll ONLY if user is already at the bottom when new message arrives
  useEffect(() => {
    if (isNearBottomRef.current) {
      scrollToBottom(false);
    } else {
      setNewMessagesWhileScrolled((prev) => prev + 1);
    }
  }, [messages.length, activeTransfers.length, scrollToBottom]);

  // Cleanup audio tracks on unmount
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

  // Load blobs and file records for files in messages (Fixed dependency loop)
  useEffect(() => {
    let isCancelled = false;
    const loadBlobs = async () => {
      for (const msg of messages) {
        if (msg.fileId && !fileRecordsMap.has(msg.fileId)) {
          const rec = await db.files.get(msg.fileId);
          if (rec && !isCancelled) {
            setFileRecordsMap((prev) => new Map(prev).set(msg.fileId!, rec));
            if (rec.blobRef) {
              const url = URL.createObjectURL(rec.blobRef);
              setDownloadUrls((prev) => new Map(prev).set(msg.fileId!, url));
            }
          }
        }
      }
    };
    loadBlobs();
    return () => {
      isCancelled = true;
    };
  }, [messages]);

  // Large Text Paste detection (Claude.ai style staged snippet)
  const handleInputPaste = (e: React.ClipboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const text = e.clipboardData.getData('text');
    if (text && text.length > 400) {
      e.preventDefault();
      const lineCount = text.split('\n').length;
      const detectedLang = detectCodeLanguage(text);
      const title = detectedLang !== 'text' ? `snippet.${detectedLang}` : `pasted_document_${Date.now().toString().slice(-4)}.txt`;

      setStagedSnippet({
        code: text,
        language: detectedLang,
        title,
        lineCount,
      });
    }
  };

  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const text = inputText.trim();
    if ((!text && !stagedSnippet) || isSending) return;

    try {
      setIsSending(true);

      const options = {
        codeSnippet: stagedSnippet || undefined,
        isGroup: !!activeGroup,
        groupId: activeGroup?.groupId,
      };

      await onSendMessage(text, options);

      setInputText('');
      setStagedSnippet(null);
      setTimeout(() => scrollToBottom(true), 50);
    } catch (err) {
      console.error('Send error:', err);
    } finally {
      setIsSending(false);
    }
  };

  const handleAttachCodeModalSave = () => {
    if (!composerCode.trim()) return;
    const lines = composerCode.split('\n').length;
    setStagedSnippet({
      code: composerCode.trim(),
      language: composerLang,
      title: composerTitle.trim() || `snippet.${composerLang}`,
      lineCount: lines,
    });
    setComposerCode('');
    setComposerTitle('');
    setShowCodeComposer(false);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      await onSendFile(file, {
        isGroup: !!activeGroup,
        groupId: activeGroup?.groupId,
      });
      setTimeout(() => scrollToBottom(true), 50);
    } catch (err) {
      console.error('File send error:', err);
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
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

      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        if (!isRecordingCancelledRef.current && audioChunksRef.current.length > 0) {
          const mimeType = mediaRecorder.mimeType || 'audio/webm';
          const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
          const audioFile = new File(
            [audioBlob],
            `voice-note-${Date.now()}.${mimeType.includes('mp4') ? 'm4a' : 'webm'}`,
            { type: mimeType }
          );
          try {
            await onSendFile(audioFile, {
              isGroup: !!activeGroup,
              groupId: activeGroup?.groupId,
            });
            setTimeout(() => scrollToBottom(true), 50);
          } catch (err) {
            console.error('Voice send error:', err);
          }
        }
        audioChunksRef.current = [];
        setRecordingDuration(0);
        if (audioStreamRef.current) {
          audioStreamRef.current.getTracks().forEach((track) => track.stop());
          audioStreamRef.current = null;
        }
      };

      mediaRecorder.start(200);
      setIsRecording(true);
      setRecordingDuration(0);

      recordingTimerRef.current = setInterval(() => {
        setRecordingDuration((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      console.error('Failed to access microphone:', err);
    }
  };

  const stopRecording = (cancel = false) => {
    isRecordingCancelledRef.current = cancel;
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
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

  const copyCodeSnippet = (snippet: CodeSnippet, messageId?: number | string) => {
    navigator.clipboard.writeText(snippet.code);
    const key = messageId || snippet.title || 'snippet';
    setCopiedSnippetId(key);
    setTimeout(() => setCopiedSnippetId(null), 2000);
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

  const handleManualSync = async () => {
    if (activeContact && peerManager) {
      await peerManager.flushOutboxForPeer(activeContact.deviceId);
    }
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
    return (
      <div className="flex-1 h-full flex flex-col items-center justify-center p-6 text-center text-[#71717a] font-sans select-none">
        <div className="w-14 h-14 rounded-2xl bg-[#18181b] border border-[#27272a] flex items-center justify-center text-white mb-3 shadow-inner">
          <Lock className="w-6 h-6 text-emerald-400" />
        </div>
        <h3 className="text-sm font-semibold text-white mb-1">Direct Encrypted Messenger</h3>
        <p className="text-xs max-w-sm text-[#71717a]">
          Select a contact or group to start chatting. All messages and transfers are directly end-to-end encrypted.
        </p>
      </div>
    );
  }

  const isGroup = !!activeGroup;
  const isVerified = activeContact?.verificationStatus === 'VERIFIED';
  const headerInitial = isGroup
    ? activeGroup!.name.charAt(0).toUpperCase()
    : (activeContact!.alias || activeContact!.deviceId.slice(4, 6)).charAt(0).toUpperCase();
  const headerAvatarColor = isGroup
    ? activeGroup!.avatarColor || '#2563eb'
    : activeContact!.avatarColor || '#2563eb';

  return (
    <div className="flex-1 h-full min-h-0 flex flex-col bg-[#09090b] text-[#fafafa] font-sans select-none overflow-hidden relative">
      {/* Top Header */}
      <div className="px-4 py-3 border-b border-[#27272a] bg-[#101014] flex items-center justify-between shrink-0 z-10">
        <div className="flex items-center gap-3 min-w-0">
          {onBackToPeers && (
            <button
              onClick={onBackToPeers}
              className="lg:hidden p-1.5 -ml-1 text-[#a1a1aa] hover:text-white rounded-lg transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          )}

          <div className="relative shrink-0">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center text-white font-bold text-sm shadow-md"
              style={{ backgroundColor: headerAvatarColor }}
            >
              {headerInitial}
            </div>
            {!isGroup && (
              <div
                className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-[#101014] ${
                  isConnected
                    ? 'bg-emerald-400'
                    : activeContact?.isOnline
                    ? 'bg-emerald-500'
                    : 'bg-[#52525b]'
                }`}
              />
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="font-semibold text-white text-sm truncate">
                {isGroup ? activeGroup!.name : activeContact!.alias || activeContact!.deviceId}
              </h2>
              {!isGroup && isVerified && (
                <span title="Cryptographically Verified" className="shrink-0 inline-flex items-center">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                </span>
              )}
            </div>

            <div className="flex items-center gap-2 text-[11px] text-[#71717a] font-mono">
              {isGroup ? (
                <button
                  onClick={() => onOpenGroupDetails?.(activeGroup!)}
                  className="hover:text-blue-400 transition-colors flex items-center gap-1"
                >
                  <Users className="w-3 h-3" />
                  <span>{activeGroup!.memberDeviceIds.length} members</span>
                </button>
              ) : (
                <>
                  <span className="truncate max-w-[140px] sm:max-w-[220px]">
                    {activeContact!.deviceId}
                  </span>
                  {latencyMs !== undefined && isConnected && (
                    <span className="text-emerald-400 font-semibold">{latencyMs}ms</span>
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
            className="p-2 text-[#a1a1aa] hover:text-white hover:bg-[#18181b] rounded-lg transition-colors cursor-pointer"
            title={isGroup ? 'Group Voice Call' : 'Encrypted Voice Call'}
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
            className="p-2 text-[#a1a1aa] hover:text-white hover:bg-[#18181b] rounded-lg transition-colors cursor-pointer"
            title={isGroup ? 'Group Video Call' : 'Encrypted Video Call'}
          >
            <Video className="w-4 h-4" />
          </button>

          {/* Group Details or Contact Verification */}
          {isGroup ? (
            <button
              onClick={() => onOpenGroupDetails?.(activeGroup!)}
              className="p-2 text-[#a1a1aa] hover:text-white hover:bg-[#18181b] rounded-lg transition-colors cursor-pointer"
              title="Group Details"
            >
              <Info className="w-4 h-4" />
            </button>
          ) : (
            <>
              {onVerifyContact && activeContact && (
                <button
                  onClick={() => onVerifyContact(activeContact)}
                  className="p-2 text-[#a1a1aa] hover:text-white hover:bg-[#18181b] rounded-lg transition-colors cursor-pointer"
                  title="Security & Safety Number"
                >
                  <ShieldCheck className="w-4 h-4" />
                </button>
              )}
              <button
                onClick={() => setIsChatSettingsOpen(true)}
                className="p-2 text-[#a1a1aa] hover:text-white hover:bg-[#18181b] rounded-lg transition-colors cursor-pointer"
                title="Chat Preferences"
              >
                <Sliders className="w-4 h-4" />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Messages Stream Body */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 py-4 space-y-4 select-text"
      >
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 text-[#71717a]">
            <div className="w-12 h-12 rounded-xl bg-[#141418] border border-[#1f1f23] flex items-center justify-center text-white mb-2">
              <Lock className="w-5 h-5 text-emerald-400" />
            </div>
            <p className="text-xs font-semibold text-white">No messages yet</p>
            <p className="text-[11px] text-[#71717a] max-w-xs mt-0.5">
              Send a message, file, photo, or code snippet to start communicating securely.
            </p>
          </div>
        ) : (
          messages.map((msg, idx) => {
            const isYou = msg.direction === 'OUTBOUND';
            const fileRec = msg.fileId ? fileRecordsMap.get(msg.fileId) || msg.fileRecord : undefined;
            const downloadUrl = msg.fileId ? downloadUrls.get(msg.fileId) : undefined;
            const isImage = fileRec?.isImage || msg.mediaType === 'image';
            const isAudio = fileRec?.isAudio || msg.mediaType === 'audio';

            // Markdown code block parsing fallback
            const parsedMdCode = !msg.fileId && !msg.codeSnippet ? parseMarkdownCodeBlock(msg.payloadText) : null;
            const codeSnippet = msg.codeSnippet || (parsedMdCode ? {
              code: parsedMdCode.code,
              language: parsedMdCode.language,
              title: parsedMdCode.title,
              lineCount: parsedMdCode.code.split('\n').length,
            } : null);

            const isCode = msg.mediaType === 'code' || !!codeSnippet;

            const timeStr = new Date(msg.timestamp).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            });

            return (
              <div
                key={msg.id || idx}
                className={`flex flex-col ${isYou ? 'items-end' : 'items-start'} space-y-1`}
              >
                {/* Group Sender Tag */}
                {isGroup && !isYou && msg.senderDisplayName && (
                  <span className="text-[11px] font-semibold text-blue-400 px-1">
                    {msg.senderDisplayName}
                  </span>
                )}

                <div
                  className={`max-w-[85%] sm:max-w-[70%] rounded-2xl overflow-hidden shadow-sm transition-all ${
                    isYou
                      ? 'bg-white text-black rounded-tr-sm'
                      : 'bg-[#18181b] border border-[#27272a] text-white rounded-tl-sm'
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
                      ) : (
                        <div className="w-64 h-48 bg-[#18181b] flex items-center justify-center text-xs text-[#71717a]">
                          Decrypting photo...
                        </div>
                      )}
                      <div className="p-2.5 flex items-center justify-between gap-2 border-t border-black/10 dark:border-white/10 text-xs">
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
                      <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${isYou ? 'bg-black/10 text-black' : 'bg-[#27272a] text-white'}`}>
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

                  {/* Code Snippet Card */}
                  {isCode && codeSnippet && (
                    <div className="w-full min-w-[240px] sm:min-w-[320px] bg-[#070709] border border-[#1f1f23] rounded-2xl overflow-hidden font-mono text-xs">
                      {/* Code Header */}
                      <div className="px-3.5 py-2 bg-[#0d0d10] border-b border-[#1f1f23] flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <FileCode className="w-4 h-4 text-emerald-400 shrink-0" />
                          <span className="text-white font-semibold truncate text-[11px]">
                            {codeSnippet.title || 'Code Snippet'}
                          </span>
                          <span className="px-1.5 py-0.2 rounded text-[10px] uppercase bg-[#18181b] text-emerald-400 border border-[#27272a]">
                            {codeSnippet.language}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => copyCodeSnippet(codeSnippet, msg.id || idx)}
                            className="p-1 rounded text-[#a1a1aa] hover:text-white transition-colors"
                            title="Copy code"
                          >
                            {copiedSnippetId === (msg.id || idx) ? (
                              <Check className="w-3.5 h-3.5 text-emerald-400" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                          </button>
                          <button
                            onClick={() => openCodeModal(codeSnippet)}
                            className="p-1 rounded text-[#a1a1aa] hover:text-white transition-colors"
                            title="Expand code viewer"
                          >
                            <Maximize2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Code Preview Content (first 5 lines) */}
                      <div
                        onClick={() => openCodeModal(codeSnippet)}
                        className="p-3 bg-[#070709] text-[#d4d4d8] text-[11px] leading-relaxed overflow-x-auto cursor-pointer hover:bg-[#0c0c10] transition-colors"
                      >
                        <pre className="whitespace-pre">
                          {codeSnippet.code.split('\n').slice(0, 5).join('\n')}
                        </pre>
                        {codeSnippet.lineCount > 5 && (
                          <div className="mt-2 pt-1.5 border-t border-[#1f1f23] flex items-center justify-between text-[10px] text-[#71717a]">
                            <span>+{codeSnippet.lineCount - 5} more lines</span>
                            <span className="text-emerald-400 font-semibold hover:underline">Click to view full code →</span>
                          </div>
                        )}
                      </div>

                      {/* Accompanying text message if any */}
                      {msg.payloadText && msg.payloadText !== codeSnippet.code && !parsedMdCode && (
                        <div className="p-3 border-t border-[#1f1f23] text-white font-sans text-xs bg-[#0c0c0e]">
                          {msg.payloadText}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Standard File Attachment Card */}
                  {msg.fileId && !isImage && !isAudio && !isCode && (
                    <div className="p-3 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className={`p-2 rounded-xl shrink-0 ${isYou ? 'bg-black/10' : 'bg-[#27272a]'}`}>
                          {getFileIcon(fileRec?.mimeType, fileRec?.name)}
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium text-xs truncate max-w-[160px]">
                            {fileRec?.name || msg.payloadText}
                          </p>
                          <p className="text-[11px] opacity-70 font-mono">
                            {fileRec ? `${(fileRec.size / 1024).toFixed(1)} KB` : 'File'}
                          </p>
                        </div>
                      </div>
                      {downloadUrl && (
                        <a
                          href={downloadUrl}
                          download={fileRec?.name || 'file.bin'}
                          className={`p-2 rounded-xl transition-colors shrink-0 ${
                            isYou ? 'bg-black/10 hover:bg-black/20 text-black' : 'bg-[#27272a] hover:bg-[#3f3f46] text-white'
                          }`}
                          title="Download File"
                        >
                          <Download className="w-4 h-4" />
                        </a>
                      )}
                    </div>
                  )}

                  {/* Standard Text Message Content */}
                  {!msg.fileId && !isCode && (
                    <div className="px-4 py-2.5 text-xs whitespace-pre-wrap break-words leading-relaxed">
                      {msg.payloadText}
                    </div>
                  )}
                </div>

                {/* Status Timestamp & Delivery Checkmarks */}
                <div
                  className={`flex items-center gap-1 text-[10px] text-[#71717a] font-mono px-1 select-none ${
                    isYou ? 'justify-end' : 'justify-start'
                  }`}
                >
                  <span>{timeStr}</span>
                  {isYou && (
                    <>
                      {msg.status === 'delivered' && (
                        <span title="Delivered via P2P" className="flex items-center text-emerald-400">
                          <CheckCheck className="w-3 h-3" />
                        </span>
                      )}
                      {msg.status === 'queued' && (
                        <span title="Queued in Outbox" className="flex items-center gap-0.5 text-amber-400">
                          <Clock className="w-3 h-3" />
                          <span className="text-[9px] font-sans">Queued</span>
                        </span>
                      )}
                      {msg.status === 'sending' && (
                        <span title="Sending" className="flex items-center text-[#71717a]">
                          <Check className="w-3 h-3" />
                        </span>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Floating Jump to Bottom Button when Scrolled Up */}
      {isUserScrolledUp && (
        <button
          onClick={() => scrollToBottom(true)}
          className="absolute right-6 bottom-24 sm:bottom-28 z-20 flex items-center gap-1.5 px-3 py-1.5 bg-[#18181b] hover:bg-[#27272a] border border-[#27272a] text-white rounded-full text-xs font-medium shadow-xl transition-all animate-in fade-in cursor-pointer"
        >
          <ChevronDown className="w-3.5 h-3.5" />
          <span>Latest</span>
          {newMessagesWhileScrolled > 0 && (
            <span className="px-1.5 py-0.2 bg-blue-600 rounded-full text-[10px] font-bold">
              {newMessagesWhileScrolled}
            </span>
          )}
        </button>
      )}

      {/* Elevated Bottom Composer Dock with Generous Reserve */}
      <div className="shrink-0 bg-[#0e0e12] border-t border-[#27272a] px-3 sm:px-6 pt-3 pb-6 sm:pb-8 space-y-2.5">
        {/* Staged Large Text / Code Snippet Attachment Pill (Claude style) */}
        {stagedSnippet && (
          <div className="p-2.5 bg-[#141418] border border-[#27272a] rounded-xl flex items-center justify-between gap-3 text-xs shadow-sm">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="p-1.5 rounded-lg bg-emerald-950/80 border border-emerald-800/60 text-emerald-400 shrink-0">
                <FileCode className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <p className="font-semibold text-white truncate text-xs">
                  {stagedSnippet.title || 'Pasted Document.txt'}
                </p>
                <p className="text-[10px] text-[#71717a] font-mono">
                  {stagedSnippet.lineCount} lines • {stagedSnippet.code.length} chars • {stagedSnippet.language}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => openCodeModal(stagedSnippet)}
                className="px-2.5 py-1 bg-[#1f1f23] hover:bg-[#27272a] text-white rounded-lg text-[11px] font-medium transition-colors"
              >
                Preview
              </button>
              <button
                type="button"
                onClick={() => setStagedSnippet(null)}
                className="p-1 text-[#71717a] hover:text-white rounded-lg transition-colors"
                title="Remove attachment"
              >
                <ArrowLeft className="w-3.5 h-3.5 rotate-45" />
              </button>
            </div>
          </div>
        )}

        {/* Inline Code Composer Dropdown */}
        {showCodeComposer && (
          <div className="p-3 bg-[#141418] border border-[#27272a] rounded-xl space-y-2 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Code2 className="w-4 h-4 text-emerald-400" />
                <span className="font-semibold text-xs text-white">Insert Code Block</span>
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={composerLang}
                  onChange={(e) => setComposerLang(e.target.value)}
                  className="px-2 py-1 bg-[#1f1f23] border border-[#27272a] rounded-lg text-xs text-white uppercase focus:outline-none"
                >
                  {SUPPORTED_LANGUAGES.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setShowCodeComposer(false)}
                  className="p-1 text-[#71717a] hover:text-white rounded-lg"
                >
                  ✕
                </button>
              </div>
            </div>
            <input
              type="text"
              value={composerTitle}
              onChange={(e) => setComposerTitle(e.target.value)}
              placeholder="Filename / Title (optional, e.g. server.ts)"
              className="w-full px-3 py-1.5 bg-[#09090b] border border-[#27272a] rounded-lg text-xs text-white focus:outline-none"
            />
            <textarea
              value={composerCode}
              onChange={(e) => setComposerCode(e.target.value)}
              placeholder="Paste or write code here..."
              rows={4}
              className="w-full px-3 py-2 bg-[#09090b] border border-[#27272a] rounded-lg font-mono text-xs text-white focus:outline-none"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowCodeComposer(false)}
                className="px-3 py-1 bg-[#1f1f23] text-[#a1a1aa] rounded-lg text-xs hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAttachCodeModalSave}
                className="px-3 py-1 bg-white text-black font-semibold rounded-lg text-xs hover:bg-neutral-200"
              >
                Attach Code Snippet
              </button>
            </div>
          </div>
        )}

        {/* Voice Recording Overlay Bar */}
        {isRecording && (
          <div className="px-4 py-2.5 bg-red-950/40 border border-red-800/60 rounded-xl flex items-center justify-between gap-3 text-xs shadow-sm">
            <div className="flex items-center gap-2 text-red-400">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-ping" />
              <span className="font-semibold">Recording Voice:</span>
              <span className="font-mono text-white">{formatDuration(recordingDuration)}</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => stopRecording(true)}
                className="px-3 py-1 bg-[#27272a] hover:bg-[#3f3f46] text-white rounded-lg transition-colors font-medium text-[11px]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => stopRecording(false)}
                className="px-3 py-1 bg-red-600 hover:bg-red-500 text-white rounded-lg transition-colors font-medium text-[11px] flex items-center gap-1"
              >
                <Send className="w-3 h-3" />
                <span>Send</span>
              </button>
            </div>
          </div>
        )}

        {/* Modern Elevated Message Composer Bar */}
        <form
          onSubmit={handleSend}
          className="flex items-center gap-2 bg-[#141418] border border-[#27272a] focus-within:border-[#3f3f46] rounded-2xl p-1.5 sm:p-2 transition-all shadow-md"
        >
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            className="hidden"
          />

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="p-2 text-[#a1a1aa] hover:text-white hover:bg-[#1f1f23] rounded-xl transition-colors cursor-pointer shrink-0"
            title="Attach File or Image"
          >
            <Paperclip className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => setShowCodeComposer(!showCodeComposer)}
            className={`p-2 rounded-xl transition-colors cursor-pointer shrink-0 ${
              showCodeComposer
                ? 'bg-emerald-600 text-white'
                : 'text-[#a1a1aa] hover:text-white hover:bg-[#1f1f23]'
            }`}
            title="Insert Code Snippet"
          >
            <Code2 className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={isRecording ? () => stopRecording(false) : startRecording}
            className={`p-2 rounded-xl transition-colors shrink-0 cursor-pointer ${
              isRecording
                ? 'bg-red-600 text-white'
                : 'text-[#a1a1aa] hover:text-white hover:bg-[#1f1f23]'
            }`}
            title={isRecording ? 'Stop Recording' : 'Record Voice Note'}
          >
            <Mic className="w-4 h-4" />
          </button>

          <input
            type="text"
            value={inputText}
            onPaste={handleInputPaste}
            onChange={(e) => setInputText(e.target.value)}
            placeholder={
              stagedSnippet
                ? 'Add an optional message with your attachment...'
                : 'Write message (paste long text or code for auto-snippet)...'
            }
            className="flex-1 bg-transparent border-0 px-2.5 py-1.5 text-xs sm:text-sm text-white placeholder-[#52525b] focus:outline-none"
          />

          <button
            type="submit"
            disabled={(!inputText.trim() && !stagedSnippet) || isSending}
            className="p-2.5 bg-white text-black hover:bg-neutral-200 disabled:opacity-20 disabled:hover:bg-white rounded-xl transition-all shrink-0 cursor-pointer shadow-sm active:scale-95"
            title="Send Message"
          >
            <Send className="w-4 h-4" />
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

      {/* Per-Chat Extended Settings Modal */}
      {isChatSettingsOpen && activeContact && (
        <ChatSettingsModal
          isOpen={isChatSettingsOpen}
          contact={activeContact}
          onClose={() => setIsChatSettingsOpen(false)}
          onSettingsChanged={(updated) => setChatSettings(updated)}
        />
      )}
    </div>
  );
};
