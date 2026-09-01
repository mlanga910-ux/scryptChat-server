import React, { useState, useRef, useEffect } from 'react';
import {
  ContactRecord,
  FileRecord,
  FileTransferProgress,
  MessageRecord,
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
} from 'lucide-react';
import { db } from '../db/index';
import { ImageExifModal } from './ImageExifModal';
import { ChatSettingsModal } from './ChatSettingsModal';
import { getChatSettings, ChatCustomSettings } from '../utils/chatSettings';

interface ChatViewProps {
  activeContact: ContactRecord | null;
  messages: MessageRecord[];
  activeTransfers: FileTransferProgress[];
  isConnected: boolean;
  latencyMs?: number;
  peerManager?: any;
  onSendMessage: (text: string) => Promise<void>;
  onSendFile: (file: File) => Promise<void>;
  onStartCall?: (peerDeviceId: string, peerDisplayName: string, callType: 'audio' | 'video') => void;
  onBackToPeers?: () => void;
  onVerifyContact?: (contact: ContactRecord) => void;
}

export const ChatView: React.FC<ChatViewProps> = ({
  activeContact,
  messages,
  activeTransfers,
  isConnected,
  latencyMs,
  peerManager,
  onSendMessage,
  onSendFile,
  onStartCall,
  onBackToPeers,
  onVerifyContact,
}) => {
  const [inputText, setInputText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // File cache for downloads & previews
  const [downloadUrls, setDownloadUrls] = useState<Map<string, string>>(new Map());
  const [fileRecordsMap, setFileRecordsMap] = useState<Map<string, FileRecord>>(new Map());

  // EXIF Inspector Modal state
  const [selectedExifFile, setSelectedExifFile] = useState<FileRecord | null>(null);
  const [isExifModalOpen, setIsExifModalOpen] = useState(false);

  // Chat Settings Modal state & Per-Chat Preferences
  const [isChatSettingsOpen, setIsChatSettingsOpen] = useState(false);
  const [chatSettings, setChatSettings] = useState<ChatCustomSettings>(() =>
    activeContact ? getChatSettings(activeContact.deviceId) : ({} as any)
  );

  // Set of media IDs revealed by the user
  const [revealedMediaIds, setRevealedMediaIds] = useState<Set<string>>(new Set());

  // Reload chat settings when active contact changes
  useEffect(() => {
    if (activeContact) {
      setChatSettings(getChatSettings(activeContact.deviceId));
      setRevealedMediaIds(new Set());
    }
  }, [activeContact?.deviceId]);

  // Voice recording
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<any>(null);
  const isRecordingCancelledRef = useRef<boolean>(false);
  const audioStreamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, activeTransfers]);

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

  // Load blobs and file records for files in messages
  useEffect(() => {
    const loadBlobs = async () => {
      for (const msg of messages) {
        if (msg.fileId && !downloadUrls.has(msg.fileId)) {
          const rec = await db.files.get(msg.fileId);
          if (rec) {
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
  }, [messages, downloadUrls]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = inputText.trim();
    if (!text || isSending) return;

    try {
      setIsSending(true);
      await onSendMessage(text);
      setInputText('');
    } catch (err) {
      console.error('Send error:', err);
    } finally {
      setIsSending(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      await onSendFile(file);
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
            await onSendFile(audioFile);
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

  const openExifModal = (fileRec: FileRecord) => {
    setSelectedExifFile(fileRec);
    setIsExifModalOpen(true);
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

  if (!activeContact) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-[#71717a] font-sans">
        <div className="w-14 h-14 rounded-2xl bg-[#18181b] border border-[#27272a] flex items-center justify-center text-white mb-3 shadow-inner">
          <Lock className="w-6 h-6" />
        </div>
        <h2 className="text-sm font-semibold text-white mb-1">
          No Contact Selected
        </h2>
        <p className="text-xs max-w-sm text-[#a1a1aa] leading-relaxed">
          Select an encrypted contact from the left list or pair a new device using Safety Numbers.
        </p>
      </div>
    );
  }

  const peerInitial = (activeContact.alias || 'P').charAt(0).toUpperCase();

  return (
    <div className="flex-1 flex flex-col bg-[#09090b] h-full overflow-hidden font-sans select-none">
      {/* Chat Header */}
      <div className="border-b border-[#27272a] bg-[#18181b]/50 px-4 sm:px-6 py-3 flex items-center justify-between gap-3 z-10">
        <div className="flex items-center gap-3 min-w-0">
          {onBackToPeers && (
            <button
              onClick={onBackToPeers}
              className="md:hidden p-1.5 -ml-1.5 text-[#a1a1aa] hover:text-white rounded-lg transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          )}

          {/* Contact Avatar */}
          <div className="relative flex-shrink-0">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center text-white font-medium text-xs shadow-sm"
              style={{ backgroundColor: activeContact.avatarColor || '#2563eb' }}
            >
              {peerInitial}
            </div>
            <span
              className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ring-2 ring-[#18181b] ${
                isConnected || activeContact.isOnline ? 'bg-emerald-400' : 'bg-zinc-600'
              }`}
            />
          </div>

          {/* Peer Name & Online Status */}
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-xs font-semibold text-white truncate">
                {activeContact.alias || `Peer-${activeContact.deviceId.slice(4, 8)}`}
              </h2>
            </div>
            <p className="text-[11px] flex items-center gap-1.5">
              {isConnected ? (
                <span className="text-emerald-400 font-medium flex items-center gap-1">
                  Direct P2P
                  {latencyMs !== undefined && (
                    <span className="text-[#71717a] font-mono text-[10px]">
                      ({latencyMs}ms)
                    </span>
                  )}
                </span>
              ) : activeContact.isOnline ? (
                <span className="text-emerald-400 font-medium">Online via Relay</span>
              ) : (
                <span className="text-[#71717a]">Offline • Outbox Queueing</span>
              )}
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-1 sm:gap-2">
          {/* Voice Call Button */}
          <button
            onClick={() => onStartCall?.(activeContact.deviceId, activeContact.alias, 'audio')}
            className="p-2 text-[#a1a1aa] hover:text-emerald-400 hover:bg-[#27272a] rounded-xl transition-colors cursor-pointer"
            title="Start P2P Voice Call (Ultra-HD Audio)"
          >
            <Phone className="w-4 h-4" />
          </button>

          {/* Video Call Button */}
          <button
            onClick={() => onStartCall?.(activeContact.deviceId, activeContact.alias, 'video')}
            className="p-2 text-[#a1a1aa] hover:text-emerald-400 hover:bg-[#27272a] rounded-xl transition-colors cursor-pointer"
            title="Start P2P Video Call (1080p Ultra-HD)"
          >
            <Video className="w-4 h-4" />
          </button>

          {/* Per-Chat Advanced Settings */}
          <button
            id="chat-settings-btn"
            onClick={() => setIsChatSettingsOpen(true)}
            className="p-2 text-[#a1a1aa] hover:text-white hover:bg-[#27272a] rounded-xl transition-colors cursor-pointer"
            title="Chat Preferences (Blur media, mute, notes)"
          >
            <Sliders className="w-4 h-4" />
          </button>

          {activeContact.verificationStatus === 'VERIFIED' ? (
            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-950/30 border border-emerald-800 text-emerald-400 rounded-xl text-xs">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span className="hidden sm:inline font-medium">Verified</span>
            </div>
          ) : (
            <button
              id="verify-contact-btn"
              onClick={() => onVerifyContact?.(activeContact)}
              className="flex items-center gap-1.5 px-2.5 py-1 bg-[#18181b] hover:bg-[#27272a] border border-[#27272a] text-[#a1a1aa] hover:text-white rounded-xl transition-colors text-xs"
              title="Inspect Safety Number"
            >
              <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
              <span className="hidden sm:inline">Safety:</span>
              <span className="font-mono text-white">{activeContact.safetyNumber}</span>
            </button>
          )}
        </div>
      </div>

      {/* Disconnection / Outbox Banner */}
      {!isConnected && (
        <div className="bg-[#18181b] border-b border-[#27272a] px-4 py-2 text-[#a1a1aa] flex items-center justify-between text-xs">
          <span className="flex items-center gap-2">
            <Clock className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
            <span>Contact is offline. Messages and files are saved in your local outbox and delivered upon reconnection.</span>
          </span>
          {messages.some((m) => m.status === 'queued') && (
            <button
              onClick={handleManualSync}
              className="px-2 py-1 bg-[#27272a] hover:bg-[#3f3f46] text-white rounded-lg text-[11px] font-medium flex items-center gap-1 transition-colors flex-shrink-0 ml-2"
            >
              <RotateCw className="w-3 h-3" />
              <span>Sync Now</span>
            </button>
          )}
        </div>
      )}

      {/* Active Chunked File Transfers Progress Bar */}
      {activeTransfers.length > 0 && (
        <div className="px-4 py-2 bg-[#18181b] border-b border-[#27272a] space-y-1.5">
          {activeTransfers.map((t) => (
            <div
              key={t.fileId}
              id={`transfer-card-${t.fileId}`}
              className="p-2 bg-[#09090b] border border-[#27272a] rounded-xl flex flex-col gap-1 text-xs"
            >
              <div className="flex items-center justify-between text-white">
                <span className="truncate max-w-xs font-medium">{t.name}</span>
                <span className="text-[#71717a] text-[11px]">
                  {(t.size / (1024 * 1024)).toFixed(2)} MB • {t.progressPercent}%
                </span>
              </div>
              <div className="w-full h-1 bg-[#27272a] rounded-full overflow-hidden">
                <div
                  className="h-full bg-white rounded-full transition-all duration-150"
                  style={{ width: `${t.progressPercent}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Message Stream */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-3">
        {messages.length === 0 ? (
          <div className="h-48 flex flex-col items-center justify-center text-[#71717a] text-center space-y-1">
            <Lock className="w-6 h-6 text-[#3f3f46]" />
            <p className="text-xs font-medium text-white">Encrypted Direct Session</p>
            <p className="text-[11px] text-[#71717a]">
              Messages and files sent here are end-to-end encrypted with zero intermediary storage.
            </p>
          </div>
        ) : (
          messages.map((msg, idx) => {
            const isYou = msg.direction === 'OUTBOUND';
            const timeStr = new Date(msg.timestamp).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            });
            const fileRec = msg.fileId ? fileRecordsMap.get(msg.fileId) || msg.fileRecord : undefined;
            const downloadUrl = msg.fileId ? downloadUrls.get(msg.fileId) : undefined;
            const isImage = fileRec?.isImage || (fileRec?.mimeType && fileRec.mimeType.startsWith('image/'));
            const isAudio = fileRec?.isAudio || (fileRec?.mimeType && fileRec.mimeType.startsWith('audio/'));

            // Check if media should be blurred (if chatSettings.blurMedia is active, not sent by you, and not revealed)
            const isMediaBlurred = Boolean(
              isImage &&
                chatSettings.blurMedia &&
                !isYou &&
                msg.fileId &&
                !revealedMediaIds.has(msg.fileId)
            );

            return (
              <div
                key={msg.id || idx}
                id={`message-row-${msg.id || idx}`}
                className={`flex flex-col gap-1 ${isYou ? 'items-end' : 'items-start'}`}
              >
                {/* Message Bubble */}
                <div
                  className={`rounded-2xl max-w-[85%] sm:max-w-md transition-all ${
                    isYou
                      ? 'bg-white text-black rounded-tr-sm'
                      : 'bg-[#18181b] border border-[#27272a] text-[#f4f4f5] rounded-tl-sm'
                  }`}
                >
                  {/* Photo Card Preview */}
                  {isImage && (
                    <div className="p-1.5 space-y-1.5">
                      <div className="relative rounded-xl overflow-hidden bg-black/60 group">
                        {downloadUrl ? (
                          <div className="relative overflow-hidden">
                            <img
                              src={downloadUrl}
                              alt={fileRec?.name || 'Image'}
                              className={`max-h-72 w-full object-contain rounded-lg transition-all duration-300 ${
                                isMediaBlurred
                                  ? 'filter blur-xl scale-110 select-none pointer-events-none'
                                  : 'cursor-pointer hover:opacity-95'
                              }`}
                              onClick={() => !isMediaBlurred && fileRec && openExifModal(fileRec)}
                              referrerPolicy="no-referrer"
                            />

                            {/* Blurred Image Overlay */}
                            {isMediaBlurred && (
                              <div className="absolute inset-0 bg-black/60 backdrop-blur-md flex flex-col items-center justify-center p-4 text-center z-10">
                                <div className="w-10 h-10 rounded-full bg-[#27272a] border border-[#3f3f46] flex items-center justify-center text-amber-400 mb-2 shadow-lg">
                                  <EyeOff className="w-5 h-5" />
                                </div>
                                <span className="font-semibold text-white text-xs mb-0.5">
                                  Photo Hidden
                                </span>
                                <span className="text-[10.5px] text-[#a1a1aa] mb-3">
                                  Blurred by your chat privacy setting
                                </span>
                                <button
                                  type="button"
                                  onClick={() => msg.fileId && toggleRevealMedia(msg.fileId)}
                                  className="px-3.5 py-1.5 bg-white hover:bg-neutral-200 text-black font-medium rounded-xl text-xs transition-colors flex items-center gap-1.5 shadow-md"
                                >
                                  <Eye className="w-3.5 h-3.5" />
                                  <span>Reveal Photo</span>
                                </button>
                              </div>
                            )}

                            {/* Re-blur option when revealed */}
                            {!isMediaBlurred && chatSettings.blurMedia && !isYou && msg.fileId && (
                              <button
                                type="button"
                                onClick={() => toggleRevealMedia(msg.fileId!)}
                                className="absolute top-2 left-2 px-2 py-1 bg-black/70 hover:bg-black text-[#a1a1aa] hover:text-white rounded-lg text-[10px] flex items-center gap-1 transition-all shadow-sm font-sans"
                                title="Re-blur photo"
                              >
                                <EyeOff className="w-3 h-3 text-amber-400" />
                                <span>Blur</span>
                              </button>
                            )}
                          </div>
                        ) : (
                          <div className="p-8 text-center text-xs text-[#71717a]">
                            Loading image...
                          </div>
                        )}

                        {/* Hover Overlay Button to open EXIF */}
                        {!isMediaBlurred && fileRec && (
                          <button
                            onClick={() => openExifModal(fileRec)}
                            className="absolute top-2 right-2 px-2 py-1 bg-black/70 hover:bg-black text-white rounded-lg text-[11px] flex items-center gap-1 transition-opacity opacity-90 group-hover:opacity-100 shadow-sm font-sans"
                            title="Inspect EXIF Metadata"
                          >
                            <Info className="w-3.5 h-3.5 text-white" />
                            <span>EXIF</span>
                          </button>
                        )}
                      </div>

                      {/* Photo Bottom Bar: Name, Size & Actions */}
                      <div className="px-2 py-1 flex items-center justify-between gap-2 text-xs">
                        <div className="truncate text-[11px] opacity-80">
                          {fileRec?.name}
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          {fileRec && !isMediaBlurred && (
                            <button
                              onClick={() => openExifModal(fileRec)}
                              className={`px-2 py-0.5 rounded-lg text-[11px] font-medium flex items-center gap-1 transition-colors ${
                                isYou ? 'bg-black/10 hover:bg-black/20 text-black' : 'bg-[#27272a] hover:bg-[#3f3f46] text-white'
                              }`}
                            >
                              <Info className="w-3 h-3" />
                              <span>Details</span>
                            </button>
                          )}
                          {downloadUrl && (
                            <a
                              href={downloadUrl}
                              download={fileRec?.name || 'photo.png'}
                              className={`p-1.5 rounded-lg transition-colors ${
                                isYou ? 'bg-black/10 hover:bg-black/20 text-black' : 'bg-[#27272a] hover:bg-[#3f3f46] text-white'
                              }`}
                              title="Download Photo"
                            >
                              <Download className="w-3.5 h-3.5" />
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Audio Message Player */}
                  {isAudio && (
                    <div className="p-3 flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${isYou ? 'bg-black/10 text-black' : 'bg-[#27272a] text-white'}`}>
                        <Music className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium">Voice Message</div>
                        {downloadUrl && (
                          <audio
                            controls
                            src={downloadUrl}
                            className="mt-1 w-full h-8 max-w-[200px]"
                          />
                        )}
                      </div>
                    </div>
                  )}

                  {/* Generic File Attachment Card */}
                  {msg.fileId && !isImage && !isAudio && (
                    <div className="p-3 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className={`p-2 rounded-xl flex-shrink-0 ${isYou ? 'bg-black/10' : 'bg-[#27272a]'}`}>
                          {getFileIcon(fileRec?.mimeType, fileRec?.name)}
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium text-xs truncate max-w-[160px]">
                            {fileRec?.name || msg.payloadText}
                          </p>
                          <p className="text-[11px] opacity-70">
                            {fileRec ? `${(fileRec.size / 1024).toFixed(1)} KB` : 'Encrypted File'}
                          </p>
                        </div>
                      </div>
                      {downloadUrl && (
                        <a
                          href={downloadUrl}
                          download={fileRec?.name || 'file.bin'}
                          className={`p-2 rounded-xl transition-colors flex-shrink-0 ${
                            isYou ? 'bg-black/10 hover:bg-black/20 text-black' : 'bg-[#27272a] hover:bg-[#3f3f46] text-white'
                          }`}
                          title="Download File"
                        >
                          <Download className="w-4 h-4" />
                        </a>
                      )}
                    </div>
                  )}

                  {/* Text Message Content */}
                  {!msg.fileId && (
                    <div className="px-4 py-2.5 text-xs whitespace-pre-wrap break-words leading-relaxed">
                      {msg.payloadText}
                    </div>
                  )}
                </div>

                {/* Status Timestamp & Delivery Check */}
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
                        <span title="Queued in Outbox • Will deliver on P2P reconnect" className="flex items-center gap-0.5 text-amber-400">
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

      {/* Recording Overlay Bar */}
      {isRecording && (
        <div className="px-4 py-2.5 bg-red-950/40 border-t border-red-800/60 flex items-center justify-between gap-3 text-xs">
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

      {/* Input Message Form Bar */}
      <form
        onSubmit={handleSend}
        className="p-3 sm:p-4 bg-[#18181b]/60 border-t border-[#27272a] flex items-center gap-2"
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
          className="p-2.5 text-[#a1a1aa] hover:text-white hover:bg-[#27272a] rounded-xl transition-colors cursor-pointer flex-shrink-0"
          title="Attach File or Image"
        >
          <Paperclip className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={isRecording ? () => stopRecording(false) : startRecording}
          className={`p-2.5 rounded-xl transition-colors flex-shrink-0 cursor-pointer ${
            isRecording
              ? 'bg-red-600 text-white'
              : 'text-[#a1a1aa] hover:text-white hover:bg-[#27272a]'
          }`}
          title={isRecording ? 'Stop Recording' : 'Record Voice Note'}
        >
          <Mic className="w-4 h-4" />
        </button>

        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder={
            isConnected
              ? 'Write encrypted message...'
              : 'Write message (queued for auto-delivery on reconnect)...'
          }
          className="flex-1 bg-[#09090b] border border-[#27272a] rounded-xl px-4 py-2.5 text-xs text-white placeholder-[#52525b] focus:outline-none focus:border-white transition-colors"
        />

        <button
          type="submit"
          disabled={!inputText.trim() || isSending}
          className="p-2.5 bg-white text-black hover:bg-neutral-200 disabled:opacity-30 disabled:hover:bg-white rounded-xl transition-colors flex-shrink-0 cursor-pointer shadow-sm"
          title="Send Message"
        >
          <Send className="w-4 h-4" />
        </button>
      </form>

      {/* EXIF Details Modal */}
      {isExifModalOpen && selectedExifFile && (
        <ImageExifModal
          isOpen={isExifModalOpen}
          fileRecord={selectedExifFile}
          onClose={() => {
            setIsExifModalOpen(false);
            setSelectedExifFile(null);
          }}
        />
      )}

      {/* Per-Chat Extended Settings Modal */}
      {isChatSettingsOpen && (
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
