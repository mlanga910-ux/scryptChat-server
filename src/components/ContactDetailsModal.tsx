import React, { useState, useRef } from 'react';
import { ContactRecord } from '../types/index';
import {
  X,
  MessageSquare,
  Phone,
  Video,
  ShieldCheck,
  Copy,
  Check,
  Trash2,
  Edit2,
  CheckCircle,
  UserX,
  Key,
  Calendar,
  Camera,
  Upload,
} from 'lucide-react';
import { fileToAvatarDataUrl } from '../utils/imageHelper';

interface ContactDetailsModalProps {
  isOpen: boolean;
  contact: ContactRecord | null;
  isConnected: boolean;
  onClose: () => void;
  onStartChat: (contact: ContactRecord) => void;
  onDeleteContact: (deviceId: string) => void;
  onClearHistory: (deviceId: string) => void;
  onUpdateAlias: (deviceId: string, newAlias: string) => void;
  onUpdateAvatar?: (deviceId: string, avatarUrl?: string) => void;
  onToggleVerify: (deviceId: string, verified: boolean) => void;
  onStartCall?: (deviceId: string, alias: string, type: 'audio' | 'video') => void;
}

export const ContactDetailsModal: React.FC<ContactDetailsModalProps> = ({
  isOpen,
  contact,
  isConnected,
  onClose,
  onStartChat,
  onDeleteContact,
  onClearHistory,
  onUpdateAlias,
  onUpdateAvatar,
  onToggleVerify,
  onStartCall,
}) => {
  const [copiedId, setCopiedId] = useState(false);
  const [isEditingAlias, setIsEditingAlias] = useState(false);
  const [aliasInput, setAliasInput] = useState('');
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen || !contact) return null;

  const initial = (contact.alias || contact.deviceId.slice(4, 6)).charAt(0).toUpperCase();
  const avatarColor = contact.avatarColor || '#3b82f6';
  const isVerified = contact.verificationStatus === 'VERIFIED';

  const handleAvatarFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await fileToAvatarDataUrl(file);
      onUpdateAvatar?.(contact.deviceId, dataUrl);
    } catch (err) {
      console.error('Failed to process contact avatar:', err);
    }
  };

  const handleRemoveAvatar = () => {
    onUpdateAvatar?.(contact.deviceId, undefined);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const copyDeviceId = () => {
    navigator.clipboard.writeText(contact.deviceId);
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2000);
  };

  const handleSaveAlias = () => {
    if (!aliasInput.trim()) return;
    const trimmed = aliasInput.trim();
    onUpdateAlias(contact.deviceId, trimmed);
    setIsEditingAlias(false);
  };

  const handleToggleVerification = () => {
    onToggleVerify(contact.deviceId, !isVerified);
  };

  const handleExecuteClearHistory = () => {
    onClearHistory(contact.deviceId);
    setShowClearConfirm(false);
  };

  const handleExecuteDelete = () => {
    onDeleteContact(contact.deviceId);
    setShowDeleteConfirm(false);
    onClose();
  };

  return (
    <div
      id="contact-details-modal-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-150 font-sans select-none"
    >
      <div
        id="contact-details-modal"
        className="w-full max-w-md h-[580px] max-h-[92vh] bg-[#0c0c0e] border border-[#27272a] rounded-2xl shadow-2xl overflow-hidden flex flex-col"
      >
        {/* Top Header */}
        <div className="relative px-5 py-4 border-b border-[#1f1f23] bg-[#09090b] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 text-xs font-semibold text-[#a1a1aa] uppercase tracking-wider">
            <span>Contact Profile</span>
          </div>
          <button
            id="close-contact-modal-btn"
            onClick={onClose}
            className="p-1.5 text-[#71717a] hover:text-white hover:bg-[#18181b] rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Avatar & Identity Info */}
          <div className="flex flex-col items-center text-center space-y-2">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleAvatarFileSelect}
              accept="image/*"
              className="hidden"
            />
            <div
              className="relative group cursor-pointer"
              onClick={() => fileInputRef.current?.click()}
              title="Change contact photo"
            >
              <div
                className="w-16 h-16 rounded-2xl flex items-center justify-center text-white text-2xl font-bold shadow-lg overflow-hidden"
                style={{ backgroundColor: contact.avatarUrl ? '#18181b' : avatarColor }}
              >
                {contact.avatarUrl ? (
                  <img src={contact.avatarUrl} alt={contact.alias} className="w-full h-full object-cover" />
                ) : (
                  initial
                )}
              </div>
              <div className="absolute inset-0 bg-black/60 rounded-2xl opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity text-white">
                <Camera className="w-5 h-5" />
              </div>
              <div
                className={`absolute -bottom-1 -right-1 w-4 h-4 rounded-full border-2 border-[#0c0c0e] ${
                  isConnected ? 'bg-emerald-400' : contact.isOnline ? 'bg-emerald-500' : 'bg-[#52525b]'
                }`}
              />
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="text-[10px] text-blue-400 hover:underline flex items-center gap-1 cursor-pointer"
              >
                <Upload className="w-3 h-3" />
                <span>{contact.avatarUrl ? 'Change Photo' : 'Set Photo'}</span>
              </button>
              {contact.avatarUrl && (
                <button
                  type="button"
                  onClick={handleRemoveAvatar}
                  className="text-[10px] text-rose-400 hover:underline cursor-pointer"
                >
                  Remove
                </button>
              )}
            </div>

            {/* Editable Alias */}
            <div className="space-y-1 w-full max-w-xs">
              {isEditingAlias ? (
                <div className="flex items-center gap-2 justify-center">
                  <input
                    type="text"
                    value={aliasInput}
                    onChange={(e) => setAliasInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveAlias();
                      if (e.key === 'Escape') setIsEditingAlias(false);
                    }}
                    autoFocus
                    placeholder="Contact Name"
                    className="px-2.5 py-1 bg-[#18181b] border border-[#3f3f46] rounded-lg text-sm text-white text-center focus:outline-none focus:border-white"
                  />
                  <button
                    onClick={handleSaveAlias}
                    className="p-1.5 bg-white text-black rounded-lg text-xs font-semibold hover:bg-neutral-200"
                  >
                    <Check className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setIsEditingAlias(false)}
                    className="p-1.5 bg-[#18181b] text-[#a1a1aa] rounded-lg text-xs hover:text-white"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center justify-center gap-1.5">
                  <h3 className="text-base font-semibold text-white truncate">{contact.alias}</h3>
                  <button
                    onClick={() => {
                      setAliasInput(contact.alias);
                      setIsEditingAlias(true);
                    }}
                    className="p-1 text-[#71717a] hover:text-white transition-colors"
                    title="Rename contact"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              <p className="font-mono text-[11px] text-[#71717a] truncate">{contact.deviceId}</p>
            </div>
          </div>

          {/* Quick Actions Row */}
          <div className="grid grid-cols-3 gap-2">
            <button
              id="contact-message-btn"
              onClick={() => {
                onStartChat(contact);
                onClose();
              }}
              className="flex flex-col items-center justify-center p-3 rounded-xl bg-[#141418] hover:bg-[#1c1c22] border border-[#27272a] text-white transition-all"
            >
              <MessageSquare className="w-4 h-4 mb-1 text-blue-400" />
              <span className="text-xs font-medium">Message</span>
            </button>

            <button
              id="contact-voice-call-btn"
              onClick={() => {
                onStartCall?.(contact.deviceId, contact.alias, 'audio');
                onClose();
              }}
              className="flex flex-col items-center justify-center p-3 rounded-xl bg-[#141418] hover:bg-[#1c1c22] border border-[#27272a] text-white transition-all"
            >
              <Phone className="w-4 h-4 mb-1 text-emerald-400" />
              <span className="text-xs font-medium">Voice</span>
            </button>

            <button
              id="contact-video-call-btn"
              onClick={() => {
                onStartCall?.(contact.deviceId, contact.alias, 'video');
                onClose();
              }}
              className="flex flex-col items-center justify-center p-3 rounded-xl bg-[#141418] hover:bg-[#1c1c22] border border-[#27272a] text-white transition-all"
            >
              <Video className="w-4 h-4 mb-1 text-blue-400" />
              <span className="text-xs font-medium">Video</span>
            </button>
          </div>

          {/* Security & Details */}
          <div className="space-y-2 bg-[#121215] border border-[#1f1f23] rounded-xl p-3.5 text-xs">
            <div className="flex items-center justify-between py-1 border-b border-[#1f1f23]">
              <span className="text-[#a1a1aa] flex items-center gap-1.5">
                <Key className="w-3.5 h-3.5 text-[#71717a]" />
                Device ID
              </span>
              <div className="flex items-center gap-1.5 font-mono text-[11px] text-white">
                <span className="truncate max-w-[140px]">{contact.deviceId}</span>
                <button
                  onClick={copyDeviceId}
                  className="p-1 text-[#71717a] hover:text-white transition-colors"
                  title="Copy Device ID"
                >
                  {copiedId ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-[#a1a1aa]" />}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between py-1 border-b border-[#1f1f23]">
              <span className="text-[#a1a1aa] flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-[#71717a]" />
                Verification Status
              </span>
              <button
                onClick={handleToggleVerification}
                className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                  isVerified
                    ? 'bg-emerald-950 text-emerald-400 border border-emerald-800/60 hover:bg-emerald-900/50'
                    : 'bg-[#1e1e24] text-[#a1a1aa] border border-[#33333b] hover:text-white'
                }`}
              >
                {isVerified ? 'Verified' : 'Unverified'}
              </button>
            </div>

            {contact.safetyNumber && (
              <div className="flex items-center justify-between py-1 border-b border-[#1f1f23]">
                <span className="text-[#a1a1aa]">Safety Number</span>
                <span className="font-mono text-emerald-400 text-[11px] tracking-wider font-semibold">
                  {contact.safetyNumber}
                </span>
              </div>
            )}

            <div className="flex items-center justify-between py-1">
              <span className="text-[#a1a1aa] flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-[#71717a]" />
                Connected Since
              </span>
              <span className="text-[#71717a]">
                {contact.addedAt ? new Date(contact.addedAt).toLocaleDateString() : 'Recently'}
              </span>
            </div>
          </div>

          {/* Danger Zone */}
          <div className="space-y-2 pt-1 border-t border-[#1f1f23]">
            {showClearConfirm ? (
              <div className="p-3 bg-red-950/30 border border-red-900/40 rounded-xl space-y-2">
                <p className="text-xs text-red-200 font-medium">Are you sure you want to clear message history?</p>
                <div className="flex gap-2">
                  <button
                    onClick={handleExecuteClearHistory}
                    className="px-3 py-1 bg-red-600 hover:bg-red-500 text-white text-xs font-semibold rounded-lg transition-colors"
                  >
                    Yes, Clear
                  </button>
                  <button
                    onClick={() => setShowClearConfirm(false)}
                    className="px-3 py-1 bg-[#18181b] text-xs text-[#a1a1aa] hover:text-white rounded-lg"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setShowClearConfirm(true)}
                className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-[#141418] hover:bg-[#1b1b20] border border-[#1f1f23] text-xs text-[#a1a1aa] hover:text-white transition-colors"
              >
                <span>Clear Chat History</span>
                <Trash2 className="w-3.5 h-3.5 text-[#71717a]" />
              </button>
            )}

            {showDeleteConfirm ? (
              <div className="p-3 bg-red-950/40 border border-red-900/50 rounded-xl space-y-2">
                <p className="text-xs text-red-200 font-medium">Are you sure you want to remove this contact?</p>
                <div className="flex gap-2">
                  <button
                    onClick={handleExecuteDelete}
                    className="px-3 py-1 bg-red-600 hover:bg-red-500 text-white text-xs font-semibold rounded-lg transition-colors"
                  >
                    Yes, Delete
                  </button>
                  <button
                    onClick={() => setShowDeleteConfirm(false)}
                    className="px-3 py-1 bg-[#18181b] text-xs text-[#a1a1aa] hover:text-white rounded-lg"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-red-950/20 hover:bg-red-950/40 border border-red-900/30 text-xs text-red-400 transition-colors"
              >
                <span>Delete Contact</span>
                <UserX className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
