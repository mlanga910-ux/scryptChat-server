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
  FileText,
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
  Search,
  MoreVertical,
  Wifi,
} from 'lucide-react';
import { db } from '../db/index';
import { ImageExifModal } from './ImageExifModal';

interface ChatViewProps {
  activeContact: ContactRecord | null;
  messages: MessageRecord[];
  activeTransfers: FileTransferProgress[];
  isConnected: boolean;
  latencyMs?: number;
  onSendMessage: (text: string) => Promise<void>;
  onSendFile: (file: File) => Promise<void>;
  onBackToPeers?: () => void;
  onVerifyContact?: (contact: ContactRecord) => void;
}

export const ChatView: React.FC<ChatViewProps> = ({
  activeContact,
  messages,
  activeTransfers,
  isConnected,
  latencyMs,
  onSendMessage,
  onSendFile,
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

  // Audio Recording State
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<any>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, activeTransfers]);

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

  // Voice recording
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const audioFile = new File([audioBlob], `voice_${Date.now()}.webm`, { type: 'audio/webm' });
        try {
          await onSendFile(audioFile);
        } catch (err) {
          console.error('Audio message send error:', err);
        }
        stream.getTracks().forEach((track) => track.stop());
      };

      mediaRecorder.start(200);
      setIsRecording(true);
      setRecordingDuration(0);

      recordingTimerRef.current = setInterval(() => {
        setRecordingDuration((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      console.error('Audio recording failed:', err);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
    }
  };

  const cancelRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      audioChunksRef.current = [];
      setIsRecording(false);
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
    }
  };

  const openExifModal = (rec: FileRecord) => {
    setSelectedExifFile(rec);
    setIsExifModalOpen(true);
  };

  const getFileIcon = (mime: string = '', name: string = '') => {
    if (mime.startsWith('image/')) return <ImageIcon className="w-5 h-5 text-white" />;
    if (mime.startsWith('audio/')) return <Music className="w-5 h-5 text-[#a1a1aa]" />;
    if (mime.startsWith('video/')) return <Film className="w-5 h-5 text-[#a1a1aa]" />;
    if (mime.includes('zip') || mime.includes('tar') || mime.includes('rar') || name.endsWith('.zip') || name.endsWith('.tar.gz')) {
      return <FileArchive className="w-5 h-5 text-[#a1a1aa]" />;
    }
    if (mime.includes('json') || mime.includes('javascript') || mime.includes('typescript') || name.endsWith('.ts') || name.endsWith('.py')) {
      return <FileCode className="w-5 h-5 text-[#a1a1aa]" />;
    }
    return <FileText className="w-5 h-5 text-[#a1a1aa]" />;
  };

  if (!activeContact) {
    return (
      <main className="flex-1 h-full flex flex-col items-center justify-center p-6 bg-[#09090b] text-center select-none font-sans">
        <div className="max-w-xs flex flex-col items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-[#18181b] border border-[#27272a] flex items-center justify-center text-white">
            <Lock className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-white">
              No chat selected
            </h2>
            <p className="text-xs text-[#71717a] mt-1">
              Select a conversation or start a new chat.
            </p>
          </div>
        </div>
      </main>
    );
  }

  const avatarBg = activeContact.avatarColor || '#3b82f6';
  const initial = (activeContact.alias || activeContact.deviceId.slice(4, 6)).charAt(0).toUpperCase();

  return (
    <main className="flex-1 h-full flex flex-col bg-[#09090b] font-sans text-xs overflow-hidden">
      {/* Top Header Bar */}
      <div className="px-4 sm:px-6 py-3 border-b border-[#27272a] bg-[#09090b] flex items-center justify-between gap-3 select-none">
        <div className="flex items-center gap-3 min-w-0">
          {onBackToPeers && (
            <button
              id="chat-back-to-peers-btn"
              onClick={onBackToPeers}
              className="md:hidden p-1.5 text-[#a1a1aa] hover:text-white rounded-lg transition-colors"
              title="Back to chats"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          )}

          {/* Peer Avatar & Status */}
          <div className="relative flex-shrink-0">
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center text-white font-medium text-xs shadow-sm"
              style={{ backgroundColor: avatarBg }}
            >
              {initial}
            </div>
            <div
              className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-[#09090b] ${
                isConnected ? 'bg-emerald-400' : 'bg-[#52525b]'
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
                  Online
                  {latencyMs !== undefined && (
                    <span className="text-[#71717a] font-mono text-[10px]">
                      ({latencyMs}ms)
                    </span>
                  )}
                </span>
              ) : (
                <span className="text-[#71717a]">Offline • Mailbox</span>
              )}
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-1 sm:gap-2">
          {activeContact.verificationStatus === 'VERIFIED' ? (
            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-950/30 border border-emerald-800 text-emerald-400 rounded-lg text-xs">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span className="hidden sm:inline font-medium">Verified</span>
            </div>
          ) : (
            <button
              id="verify-contact-btn"
              onClick={() => onVerifyContact?.(activeContact)}
              className="flex items-center gap-1.5 px-2.5 py-1 bg-[#18181b] hover:bg-[#27272a] border border-[#27272a] text-[#a1a1aa] hover:text-white rounded-lg transition-colors text-xs"
              title="Inspect Safety Number"
            >
              <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
              <span className="hidden sm:inline">Safety:</span>
              <span className="font-mono text-white">{activeContact.safetyNumber}</span>
            </button>
          )}

          <button
            onClick={() => onVerifyContact?.(activeContact)}
            className="p-1.5 text-[#a1a1aa] hover:text-white hover:bg-[#18181b] rounded-lg transition-colors"
            title="Details & Security"
          >
            <MoreVertical className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Disconnection Warning */}
      {!isConnected && (
        <div className="bg-[#18181b] border-b border-[#27272a] px-4 py-1.5 text-[#a1a1aa] flex items-center justify-between text-xs">
          <span className="flex items-center gap-2">
            <Clock className="w-3.5 h-3.5 text-amber-400" />
            <span>Contact is offline. Messages are queued and delivered when they reconnect.</span>
          </span>
        </div>
      )}

      {/* Active Chunked File Transfers Progress Bar */}
      {activeTransfers.length > 0 && (
        <div className="px-4 py-2 bg-[#18181b] border-b border-[#27272a] space-y-1.5">
          {activeTransfers.map((t) => (
            <div
              key={t.fileId}
              id={`transfer-card-${t.fileId}`}
              className="p-2 bg-[#09090b] border border-[#27272a] rounded-lg flex flex-col gap-1 text-xs"
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
            <p className="text-xs font-medium text-[#a1a1aa]">No messages yet</p>
            <p className="text-[11px] text-[#71717a]">
              Send a message to start chatting.
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
                      <div className="relative rounded-xl overflow-hidden bg-black/50 group">
                        {downloadUrl ? (
                          <img
                            src={downloadUrl}
                            alt={fileRec?.name || 'Image'}
                            className="max-h-72 w-full object-contain rounded-lg cursor-pointer hover:opacity-95 transition-opacity"
                            onClick={() => fileRec && openExifModal(fileRec)}
                            referrerPolicy="no-referrer"
                          />
                        ) : (
                          <div className="p-8 text-center text-xs text-[#71717a]">
                            Loading image...
                          </div>
                        )}

                        {/* Hover Overlay Button to open EXIF */}
                        {fileRec && (
                          <button
                            onClick={() => openExifModal(fileRec)}
                            className="absolute top-2 right-2 px-2 py-1 bg-black/70 hover:bg-black text-white rounded-md text-[11px] flex items-center gap-1 transition-opacity opacity-90 group-hover:opacity-100 shadow-sm font-sans"
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
                          {fileRec && (
                            <button
                              onClick={() => openExifModal(fileRec)}
                              className={`px-2 py-0.5 rounded text-[11px] font-medium flex items-center gap-1 transition-colors ${
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
                              className={`p-1 rounded transition-colors ${
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
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${isYou ? 'bg-black/10 text-black' : 'bg-[#27272a] text-white'}`}>
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
                        <div className={`p-2 rounded-lg flex-shrink-0 ${isYou ? 'bg-black/10' : 'bg-[#27272a]'}`}>
                          {getFileIcon(fileRec?.mimeType, fileRec?.name)}
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium text-xs truncate max-w-[160px]">
                            {fileRec?.name || msg.payloadText}
                          </p>
                          <p className="text-[11px] opacity-70">
                            {fileRec ? `${(fileRec.size / (1024 * 1024)).toFixed(2)} MB` : 'File'}
                          </p>
                        </div>
                      </div>

                      {downloadUrl && (
                        <a
                          href={downloadUrl}
                          download={fileRec?.name || 'file'}
                          className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-colors shadow-sm ${
                            isYou ? 'bg-black text-white hover:bg-neutral-800' : 'bg-white text-black hover:bg-neutral-200'
                          }`}
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>Save</span>
                        </a>
                      )}
                    </div>
                  )}

                  {/* Text content */}
                  {(!msg.fileId || (msg.payloadText && !isImage && !isAudio && msg.payloadText !== fileRec?.name)) && (
                    <div className="px-3.5 py-2 text-[13px] leading-relaxed break-words">
                      {msg.payloadText}
                    </div>
                  )}

                  {/* Bubble Footer: Timestamp & Checkmarks */}
                  <div className={`px-3 pb-1.5 flex items-center justify-end gap-1 text-[10px] select-none ${isYou ? 'text-black/60' : 'text-[#71717a]'}`}>
                    <span>{timeStr}</span>
                    {isYou && (
                      <span className="ml-0.5">
                        {msg.status === 'delivered' ? (
                          <CheckCheck className="w-3 h-3 text-black" />
                        ) : msg.status === 'queued' ? (
                          <Clock className="w-3 h-3 text-amber-700" />
                        ) : (
                          <Check className="w-3 h-3 text-black/70" />
                        )}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Voice Recording Active Bar */}
      {isRecording && (
        <div className="px-4 py-2.5 bg-[#18181b] border-t border-[#27272a] flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 text-xs text-red-400 font-mono">
            <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <span>Recording: {recordingDuration}s</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={cancelRecording}
              className="px-3 py-1 bg-[#27272a] hover:bg-[#3f3f46] text-[#a1a1aa] rounded-lg text-xs font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={stopRecording}
              className="flex items-center gap-1.5 px-3.5 py-1 bg-white hover:bg-neutral-200 text-black rounded-lg text-xs font-semibold transition-colors shadow-sm"
            >
              <span>Send</span>
              <Send className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Input Bar */}
      {!isRecording && (
        <form
          onSubmit={handleSend}
          className="p-3 border-t border-[#27272a] bg-[#09090b] flex items-center gap-2"
        >
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            className="hidden"
          />

          <button
            id="attach-file-btn"
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="p-2 text-[#71717a] hover:text-white hover:bg-[#18181b] rounded-lg transition-colors"
            title="Attach file"
          >
            <Paperclip className="w-4 h-4" />
          </button>

          <button
            id="voice-record-btn"
            type="button"
            onClick={startRecording}
            className="p-2 text-[#71717a] hover:text-white hover:bg-[#18181b] rounded-lg transition-colors"
            title="Record voice"
          >
            <Mic className="w-4 h-4" />
          </button>

          <input
            id="chat-message-input"
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder={
              isConnected
                ? 'Type a message...'
                : 'Type a message (queued in mailbox)...'
            }
            disabled={isSending}
            className="flex-1 bg-[#18181b] border border-[#27272a] focus:border-white rounded-lg px-3.5 py-2 text-white placeholder-[#71717a] focus:outline-none transition-colors text-xs"
          />

          <button
            id="chat-send-btn"
            type="submit"
            disabled={!inputText.trim() || isSending}
            className="w-8 h-8 rounded-full bg-white hover:bg-neutral-200 disabled:opacity-30 disabled:hover:bg-white text-black flex items-center justify-center transition-all shadow-sm active:scale-95 flex-shrink-0 font-medium"
          >
            <Send className="w-3.5 h-3.5 ml-0.5" />
          </button>
        </form>
      )}

      {/* EXIF Metadata Inspector Modal */}
      <ImageExifModal
        isOpen={isExifModalOpen}
        fileRecord={selectedExifFile}
        blobUrl={selectedExifFile ? downloadUrls.get(selectedExifFile.fileId) : undefined}
        onClose={() => {
          setIsExifModalOpen(false);
          setSelectedExifFile(null);
        }}
      />
    </main>
  );
};


