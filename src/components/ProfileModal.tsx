import React, { useState } from 'react';
import { IdentityRecord } from '../types/index';
import {
  X,
  User,
  Key,
  Copy,
  Check,
} from 'lucide-react';
import { updateIdentityProfile } from '../crypto/keys';

interface ProfileModalProps {
  isOpen: boolean;
  identity: IdentityRecord | null;
  onClose: () => void;
  onUpdate: (updated: IdentityRecord) => void;
}

const AVATAR_COLORS = [
  '#27272a', // Dark Zinc
  '#3f3f46', // Zinc
  '#52525b', // Neutral
  '#2563eb', // Blue
  '#059669', // Emerald
  '#d97706', // Amber
  '#dc2626', // Red
  '#0891b2', // Cyan
];

export const ProfileModal: React.FC<ProfileModalProps> = ({
  isOpen,
  identity,
  onClose,
  onUpdate,
}) => {
  if (!isOpen || !identity) return null;

  const [displayName, setDisplayName] = useState(identity.displayName || '');
  const [avatarColor, setAvatarColor] = useState(identity.avatarColor || '#27272a');
  const [statusBio, setStatusBio] = useState(identity.statusBio || 'Online');
  const [copied, setCopied] = useState(false);
  const [isSaved, setIsSaved] = useState(false);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!displayName.trim()) return;
    const updated = await updateIdentityProfile(displayName.trim(), avatarColor, statusBio.trim());
    if (updated) {
      onUpdate(updated);
      setIsSaved(true);
      setTimeout(() => {
        setIsSaved(false);
        onClose();
      }, 600);
    }
  };

  const copyDeviceId = () => {
    navigator.clipboard.writeText(identity.deviceId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      id="profile-modal-backdrop"
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 select-none font-sans"
    >
      <div className="w-full max-w-md bg-[#18181b] border border-[#27272a] rounded-2xl shadow-xl overflow-hidden text-xs">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-[#27272a] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg bg-[#09090b] border border-[#27272a] flex items-center justify-center text-white">
              <User className="w-3.5 h-3.5" />
            </div>
            <h2 className="text-xs font-semibold text-white">Profile</h2>
          </div>
          <button
            id="close-profile-modal-btn"
            onClick={onClose}
            className="p-1.5 text-[#71717a] hover:text-white hover:bg-[#27272a] rounded-lg transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSave} className="p-5 space-y-3.5">
          {/* Avatar Preview */}
          <div className="flex items-center gap-3 p-3 bg-[#09090b] border border-[#27272a] rounded-xl">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-semibold text-sm shadow-sm flex-shrink-0"
              style={{ backgroundColor: avatarColor }}
            >
              {(displayName.trim() || 'U').charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="text-xs font-semibold text-white truncate">{displayName || 'User'}</div>
              <div className="text-[11px] text-[#71717a] truncate">{statusBio}</div>
            </div>
          </div>

          {/* Display Name Input */}
          <div className="space-y-1">
            <label className="block text-[11px] font-medium text-[#a1a1aa]">Display Name</label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Your name"
              maxLength={32}
              className="w-full px-3 py-2 bg-[#09090b] border border-[#27272a] rounded-lg text-white placeholder-[#71717a] focus:outline-none focus:border-white transition-colors text-xs"
            />
          </div>

          {/* Status Bio */}
          <div className="space-y-1">
            <label className="block text-[11px] font-medium text-[#a1a1aa]">Status</label>
            <input
              type="text"
              value={statusBio}
              onChange={(e) => setStatusBio(e.target.value)}
              placeholder="Status message"
              maxLength={64}
              className="w-full px-3 py-2 bg-[#09090b] border border-[#27272a] rounded-lg text-white placeholder-[#71717a] focus:outline-none focus:border-white transition-colors text-xs"
            />
          </div>

          {/* Avatar Color */}
          <div className="space-y-1.5">
            <label className="block text-[11px] font-medium text-[#a1a1aa]">Color</label>
            <div className="flex items-center gap-2">
              {AVATAR_COLORS.map((col) => (
                <button
                  key={col}
                  type="button"
                  onClick={() => setAvatarColor(col)}
                  className={`w-5 h-5 rounded-full transition-transform ${
                    avatarColor === col ? 'scale-110 ring-2 ring-white ring-offset-2 ring-offset-[#18181b]' : 'opacity-70 hover:opacity-100'
                  }`}
                  style={{ backgroundColor: col }}
                />
              ))}
            </div>
          </div>

          {/* Permanent Sovereign ID */}
          <div className="p-3 bg-[#09090b] border border-[#27272a] rounded-xl space-y-1.5 font-mono">
            <div className="flex items-center justify-between text-xs text-[#71717a]">
              <span className="flex items-center gap-1.5 font-sans font-medium text-white text-xs">
                <Key className="w-3.5 h-3.5 text-white" />
                <span>Device ID</span>
              </span>
              <button
                type="button"
                onClick={copyDeviceId}
                className="flex items-center gap-1 text-[11px] text-[#a1a1aa] hover:text-white bg-[#27272a] px-2 py-0.5 rounded"
              >
                {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                <span>{copied ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
            <div className="text-[11px] text-[#a1a1aa] select-all bg-[#18181b] p-2 rounded border border-[#27272a] truncate">
              {identity.deviceId}
            </div>
          </div>

          {/* Save Button */}
          <button
            type="submit"
            className="w-full py-2 bg-white hover:bg-neutral-200 text-black font-semibold rounded-lg transition-colors text-xs"
          >
            {isSaved ? 'Saved' : 'Save Changes'}
          </button>
        </form>
      </div>
    </div>
  );
};

