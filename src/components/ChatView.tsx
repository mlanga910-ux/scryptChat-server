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
import { CodeBlockCard } from './CodeBlockCard';
import { Avatar } from './Avatar';
import { getChatSettings, ChatCustomSettings } from '../utils/chatSettings';
import { detectCodeLanguage, parseMessageContent, parseMarkdownCodeBlock } from '../utils/codeHelper';

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

  const [stagedSnippet, setStagedSnippet] = useState<CodeSnippet | null>(null);
  const [showCodeComposer, setShowCodeComposer] = useState(false);
  const [composerCode, setComposerCode] = useState('');
  const [composerLang, setComposerLang] = useState('typescript');
  const [composerTitle, setComposerTitle] = useState('');

  const [selectedSnippetForModal, setSelectedSnippetForModal] = useState<CodeSnippet | null>(null);
  const [isCodeModalOpen, setIsCodeModalOpen] = useState(false);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [isUserScrolledUp, setIsUserScrolledUp] = useState(false);
  const [newMessagesWhileScrolled, setNewMessagesWhileScrolled] = useState(0);
  const isNearBottomRef = useRef(true);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const [downloadUrls, setDownloadUrls] = useState<Map<string, string>>(new Map());
  const [fileRecordsMap, setFileRecordsMap] = useState<Map<string, FileRecord>>(new Map());

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

  useEffect(() => {
    if (activeContact) {
      setChatSettings(getChatSettings(activeContact.deviceId));
      setRevealedMediaIds(new Set());
    }
  }, [activeContact?.deviceId]);

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
      <div className="flex-1 h-full bg-zinc-950 flex flex-col items-center justify-center text-center px-6">
        <div className="space-y-3 max-w-sm">
          <h2 className="text-base font-medium text-white">Direct encrypted messenger</h2>
          <p className="text-sm text-zinc-500 leading-relaxed">
            Select a contact or group to start chatting. Or scan a QR code to pair a new device.
          </p>
        </div>
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
    <div className="flex-1 h-full min-h-0 flex flex-col bg-zinc-950 text-zinc-50 font-sans select-none overflow-hidden relative">
      {/* Top Header */}
      <div className="shrink-0 mx-2 sm:mx-4 mt-1 mb-2 px-2.5 sm:px-3 py-2 rounded-2xl border border-zinc-800 bg-zinc-900 flex items-center justify-between gap-2 z-10">
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
              {!isGroup && isVerified && (
                <span title="Cryptographically Verified" className="shrink-0 inline-flex items-center">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                </span>
              )}
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
                  {isConnected || activeContact!.isOnline ? (
                    <span className="flex items-center gap-1.5 text-[var(--sc-e400)]">
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--sc-e400)]" />
                      <span>Active now</span>
                    </span>
                  ) : (
                    <span className="truncate max-w-[160px] sm:max-w-[240px] text-zinc-500">
                      {activeContact!.deviceId}
                    </span>
                  )}
                  {latencyMs !== undefined && isConnected && (
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

          {/* Group Details or Contact Verification */}
          {isGroup ? (
            <button
              onClick={() => onOpenGroupDetails?.(activeGroup!)}
              className="p-2 rounded-full text-zinc-500 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer"
              title="Group details"
              aria-label="Group Details"
            >
              <Info className="w-4 h-4" />
            </button>
          ) : (
            <>
              {onVerifyContact && activeContact && (
                <button
                  onClick={() => onVerifyContact(activeContact)}
                  className="p-2 rounded-full text-zinc-500 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer"
                  title="Safety number"
                  aria-label="Security"
                >
                  <ShieldCheck className="w-4 h-4" />
                </button>
              )}
              <button
                onClick={() => setIsChatSettingsOpen(true)}
                className="p-2 rounded-full text-zinc-500 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer"
                title="Chat preferences"
                aria-label="Chat Preferences"
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
        {messages.length === 0 ? null : (
          messages.map((msg, idx) => {
            const isYou = msg.direction === 'OUTBOUND';
            const fileRec = msg.fileId ? fileRecordsMap.get(msg.fileId) || msg.fileRecord : undefined;
            const downloadUrl = msg.fileId ? downloadUrls.get(msg.fileId) : undefined;
            const isImage = fileRec?.isImage || msg.mediaType === 'image';
            const isAudio = fileRec?.isAudio || msg.mediaType === 'audio';

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
              <div
                key={msg.id || idx}
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
                      ) : (
                        <div className="w-64 h-48 bg-zinc-900 flex items-center justify-center text-xs text-zinc-500">
                          Decrypting photo...
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
                  {msg.fileId && !isImage && !isAudio && !isCode && (
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
                            {fileRec ? `${(fileRec.size / 1024).toFixed(1)} KB` : 'File'}
                          </p>
                        </div>
                      </div>
                      {downloadUrl && (
                        <a
                          href={downloadUrl}
                          download={fileRec?.name || 'file.bin'}
                          className={`p-2 rounded-xl transition-colors shrink-0 ${
                            isYou ? 'bg-black/10 hover:bg-black/20 text-black' : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200'
                          }`}
                          title="Download File"
                          aria-label="Download File"
                        >
                          <Download className="w-4 h-4" />
                        </a>
                      )}
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
                      {msg.status === 'delivered' && (
                        <CheckCheck className="w-3 h-3 text-emerald-400" />
                      )}
                      {msg.status === 'queued' && (
                        <Clock className="w-3 h-3 text-amber-400" />
                      )}
                      {msg.status === 'sending' && (
                        <Check className="w-3 h-3 text-zinc-500" />
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

      {/* Staged Large Text / Code Snippet Attachment Pill */}
      {stagedSnippet && (
        <div className="px-4 pb-3 shrink-0">
          <div className="p-3 bg-zinc-900 border border-zinc-800 rounded-xl flex items-center justify-between gap-3 text-xs shadow-sm">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="p-1.5 rounded-lg bg-emerald-950/40 border border-emerald-800/60 text-emerald-400 shrink-0">
                <FileCode className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <p className="font-semibold text-white truncate text-xs">
                  {stagedSnippet.title || 'Pasted Document.txt'}
                </p>
                <p className="text-[10px] text-zinc-500 font-mono">
                  {stagedSnippet.lineCount} lines • {stagedSnippet.code.length} chars • {stagedSnippet.language}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => openCodeModal(stagedSnippet)}
                className="px-3 py-1 bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg text-[11px] font-medium transition-colors"
                aria-label="Preview snippet"
              >
                Preview
              </button>
              <button
                type="button"
                onClick={() => setStagedSnippet(null)}
                className="p-1 text-zinc-500 hover:text-white rounded-lg transition-colors"
                title="Remove attachment"
                aria-label="Remove attachment"
              >
                <ArrowLeft className="w-3.5 h-3.5 rotate-45" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Inline Code Composer Dropdown */}
      {showCodeComposer && (
        <div className="px-4 pb-3 shrink-0">
          <div className="p-3 bg-zinc-900 border border-zinc-800 rounded-xl space-y-2 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Code2 className="w-4 h-4 text-emerald-400" />
                <span className="font-semibold text-xs text-white">Insert Code Block</span>
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={composerLang}
                  onChange={(e) => setComposerLang(e.target.value)}
                  className="px-2 py-1 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-white uppercase"
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
                  className="p-1 text-zinc-500 hover:text-white rounded-lg"
                  aria-label="Close code composer"
                >
                  x
                </button>
              </div>
            </div>
            <input
              type="text"
              value={composerTitle}
              onChange={(e) => setComposerTitle(e.target.value)}
              placeholder="Filename / Title (e.g. server.ts)"
              className="w-full px-3 py-1.5 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-white placeholder-zinc-500 input-base"
            />
            <textarea
              value={composerCode}
              onChange={(e) => setComposerCode(e.target.value)}
              placeholder="Paste or write code here..."
              rows={4}
              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg font-mono text-xs text-white placeholder-zinc-500 input-base"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowCodeComposer(false)}
                className="px-3 py-1 bg-zinc-800 text-zinc-400 rounded-lg text-xs hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAttachCodeModalSave}
                className="px-3 py-1 btn-primary text-xs"
              >
                Attach Code Snippet
              </button>
            </div>
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

      {/* Modern Message Composer Bar */}
      <div className="shrink-0 px-3 sm:px-6 pt-3 pb-4 sm:pb-6 space-y-2">
        <form
          onSubmit={handleSend}
          className="flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900 px-2 py-1.5 sm:px-2.5 sm:py-2 shadow-lg transition-colors focus-within:border-zinc-700"
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
            className="p-2 rounded-full text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer shrink-0"
            title="Attach file or photo"
            aria-label="Attach file"
          >
            <Paperclip className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => setShowCodeComposer(!showCodeComposer)}
            className={`p-2 rounded-full transition-colors cursor-pointer shrink-0 ${
              showCodeComposer
                ? 'bg-emerald-400 text-zinc-950'
                : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
            }`}
            title="Insert Code Snippet"
            aria-label="Insert code snippet"
            aria-pressed={showCodeComposer}
          >
            <Code2 className="w-4 h-4" />
          </button>

          <input
            type="text"
            value={inputText}
            onPaste={handleInputPaste}
            onChange={(e) => setInputText(e.target.value)}
            placeholder={
              stagedSnippet
                ? 'Add an optional message...'
                : 'Message...'
            }
            className="flex-1 bg-transparent border-0 px-2.5 py-1.5 text-xs sm:text-sm text-white placeholder-zinc-500 focus:outline-none"
            aria-label="Message input"
          />

          <button
            type="button"
            onClick={isRecording ? () => stopRecording(false) : startRecording}
            className={`p-2 rounded-full transition-colors shrink-0 cursor-pointer ${
              isRecording
                ? 'bg-rose-600 text-white'
                : 'text-zinc-400 hover:text-white hover:bg-zinc-800'
            }`}
            title={isRecording ? 'Stop recording' : 'Record voice note'}
            aria-label={isRecording ? 'Stop recording' : 'Record voice note'}
            aria-pressed={isRecording}
          >
            <Mic className="w-4 h-4" />
          </button>

          <button
            type="submit"
            disabled={(!inputText.trim() && !stagedSnippet) || isSending}
            className="p-2.5 btn-primary disabled:opacity-30 disabled:cursor-not-allowed shadow-sm active:scale-95"
            title="Send Message"
            aria-label="Send message"
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