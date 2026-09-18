import React, { useState } from 'react';
import { ContactRecord } from '../types/index';
import {
  X,
  MessageSquare,
  Phone,
  Video,
  Copy,
  Check,
  Trash2,
  Edit2,
  UserX,
  Key,
  Calendar,
} from 'lucide-react';
import { Avatar } from './Avatar';
import { describePresence, statusColor } from '../utils/presence';

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
  onStartCall,
}) => {
  const [copiedId, setCopiedId] = useState(false);
  const [isEditingAlias, setIsEditingAlias] = useState(false);
  const [aliasInput, setAliasInput] = useState('');
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  if (!isOpen || !contact) return null;

  const presence = describePresence(contact, isConnected);

  const copyDeviceId = () => {
    navigator.clipboard.writeText(contact.deviceId);
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2000);
  };

  const handleSaveAlias = () => {
    if (!aliasInput.trim()) return;
    onUpdateAlias(contact.deviceId, aliasInput.trim());
    setIsEditingAlias(false);
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
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 select-none font-sans animate-in fade-in duration-150"
    >
      <div
        id="contact-details-modal"
        className="w-full max-w-md h-[560px] max-h-[92vh] bg-zinc-950 border border-zinc-800 rounded-2xl shadow-xl flex flex-col overflow-hidden"
      >
        {/* Top Header */}
        <div className="px-5 py-4 border-b border-zinc-800 bg-zinc-950/50 flex items-center justify-between shrink-0">
          <h2 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
            Contact Profile
          </h2>
          <button
            id="close-contact-modal-btn"
            onClick={onClose}
            className="p-1.5 text-zinc-500 hover:text-white hover:bg-zinc-900 rounded-lg transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Avatar & Identity Info. The photo comes from the contact's own profile
              and updates automatically, so it is shown read-only here. */}
          <div className="flex flex-col items-center text-center space-y-2">
            <div className="relative">
              <Avatar
                name={contact.alias || contact.deviceId}
                avatarUrl={contact.avatarUrl}
                avatarColor={contact.avatarColor}
                size="xl"
                className="rounded-2xl"
              />
              <div
                className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full"
                style={{ boxShadow: '0 0 0 2px var(--sc-panel)' }}
              />
            </div>

            <p className="text-[11px] text-zinc-500">
              {presence.isOnline ? (
                <span className="text-[var(--sc-e400)]">
                  {presence.state === 'lan' ? 'Online · LAN' : 'Online'}
                </span>
              ) : (
                presence.label
              )}
            </p>

            {/* Editable Alias */}
            <div className="space-y-1 w-full max-w-xs">
              {isEditingAlias ? (
                <div className="flex items-center justify-center gap-2">
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
                    className="px-3 py-1.5 bg-zinc-900 border border-zinc-800 rounded-lg text-sm text-center text-white focus:outline-none focus:border-emerald-400/40"
                    aria-label="Edit contact name"
                  />
                  <button
                    onClick={handleSaveAlias}
                    className="p-1.5 bg-emerald-400 text-zinc-950 rounded-lg text-xs font-semibold hover:bg-emerald-300"
                    aria-label="Save name"
                  >
                    <Check className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setIsEditingAlias(false)}
                    className="p-1.5 bg-zinc-900 text-zinc-500 rounded-lg text-xs hover:text-white"
                    aria-label="Cancel"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center justify-center gap-1.5">
                  <h3 className="text-base font-semibold text-white truncate" title={contact.alias}>
                    {contact.alias}
                  </h3>
                  <button
                    onClick={() => {
                      setAliasInput(contact.alias);
                      setIsEditingAlias(true);
                    }}
                    className="p-1 text-zinc-500 hover:text-white transition-colors"
                    title="Rename contact"
                    aria-label="Rename contact"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              <p className="font-mono text-[11px] text-zinc-500 truncate" title={contact.deviceId}>
                {contact.deviceId}
              </p>
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
              className="flex flex-col items-center justify-center p-3 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-white transition-colors"
              aria-label="Message"
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
              className="flex flex-col items-center justify-center p-3 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-white transition-colors"
              aria-label="Voice call"
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
              className="flex flex-col items-center justify-center p-3 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-white transition-colors"
              aria-label="Video call"
            >
              <Video className="w-4 h-4 mb-1 text-blue-400" />
              <span className="text-xs font-medium">Video</span>
            </button>
          </div>

          {/* Security & Details */}
          <div className="space-y-2 bg-zinc-900/50 border border-zinc-800 rounded-xl p-3.5 text-xs">
            <div className="flex items-center justify-between py-1 border-b border-zinc-800">
              <span className="text-zinc-500 flex items-center gap-1.5">
                <Key className="w-3.5 h-3.5 text-zinc-600" />
                Device ID
              </span>
              <div className="flex items-center gap-1.5 font-mono text-[11px] text-white">
                <span className="truncate max-w-[140px]">{contact.deviceId}</span>
                <button
                  onClick={copyDeviceId}
                  className="p-1 text-zinc-500 hover:text-white transition-colors"
                  title="Copy Device ID"
                  aria-label="Copy device ID"
                >
                  {copiedId ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-zinc-500" />}
                </button>
              </div>
            </div>

            {contact.status && (
              <div className="flex items-center justify-between py-1 border-b border-zinc-800">
                <span className="text-zinc-500 flex items-center gap-1.5">
                  <span
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ backgroundColor: statusColor(contact.status) }}
                  />
                  Status
                </span>
                <span className="text-white text-[11px] font-medium">{contact.status}</span>
              </div>
            )}

            <div className="flex items-center justify-between py-1">
              <span className="text-zinc-500 flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-zinc-600" />
                Connected Since
              </span>
              <span className="text-zinc-500">
                {contact.addedAt ? new Date(contact.addedAt).toLocaleDateString() : 'Recently'}
              </span>
            </div>
          </div>

          {/* Danger Zone */}
          <div className="space-y-2 pt-1 border-t border-zinc-800">
            {showClearConfirm ? (
              <div className="p-3 bg-rose-950/30 border border-rose-900/40 rounded-xl space-y-2">
                <p className="text-xs text-rose-200 font-medium">Clear message history?</p>
                <div className="flex gap-2">
                  <button
                    onClick={handleExecuteClearHistory}
                    className="px-3 py-1 bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold rounded-lg transition-colors"
                    aria-label="Clear history"
                  >
                    Yes, Clear
                  </button>
                  <button
                    onClick={() => setShowClearConfirm(false)}
                    className="px-3 py-1 bg-zinc-800 text-zinc-400 rounded-lg text-xs hover:text-white"
                    aria-label="Cancel"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setShowClearConfirm(true)}
                className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs text-zinc-400 hover:text-white transition-colors"
                aria-label="Clear chat history"
              >
                <span>Clear Chat History</span>
                <Trash2 className="w-3.5 h-3.5 text-zinc-500" />
              </button>
            )}

            {showDeleteConfirm ? (
              <div className="p-3 bg-rose-950/40 border border-rose-900/50 rounded-xl space-y-2">
                <p className="text-xs text-rose-200 font-medium">Remove this contact?</p>
                <div className="flex gap-2">
                  <button
                    onClick={handleExecuteDelete}
                    className="px-3 py-1 bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold rounded-lg transition-colors"
                    aria-label="Delete contact"
                  >
                    Yes, Delete
                  </button>
                  <button
                    onClick={() => setShowDeleteConfirm(false)}
                    className="px-3 py-1 bg-zinc-800 text-zinc-400 rounded-lg text-xs hover:text-white"
                    aria-label="Cancel"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-rose-950/20 hover:bg-rose-950/40 border border-rose-900/30 text-xs text-rose-400 transition-colors"
                aria-label="Delete contact"
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