import React, { useState } from 'react';
import { IdentityRecord } from '../types/index';
import {
  X,
  User,
  Copy,
  Check,
  Save,
  Fingerprint,
} from 'lucide-react';
import { updateIdentityProfile } from '../crypto/keys';

interface ProfileModalProps {
  isOpen: boolean;
  identity: IdentityRecord | null;
  onClose: () => void;
  onUpdate: (updated: IdentityRecord) => void;
}

const AVATAR_COLORS = [
  '#27272a', // Zinc Dark
  '#3f3f46', // Zinc
  '#2563eb', // Royal Blue
  '#059669', // Emerald
  '#d97706', // Amber
  '#dc2626', // Red
  '#0891b2', // Cyan
  '#7c3aed', // Purple
  '#db2777', // Pink
];

export const ProfileModal: React.FC<ProfileModalProps> = ({
  isOpen,
  identity,
  onClose,
  onUpdate,
}) => {
  if (!isOpen || !identity) return null;

  const [displayName, setDisplayName] = useState(identity.displayName || '');
  const [avatarColor, setAvatarColor] = useState(identity.avatarColor || '#2563eb');
  const [statusBio, setStatusBio] = useState(identity.statusBio || 'Online');
  const [copied, setCopied] = useState(false);
  const [isSaved, setIsSaved] = useState(false);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!displayName.trim()) return;
    const updated = await updateIdentityProfile(displayName.trim(), avatarColor, statusBio.trim());
    if (updated) {
      onUpdate(updated);
      setIsSaved(true);
      setTimeout(() => {
        setIsSaved(false);
        onClose();
      }, 500);
    }
  };

  const copyDeviceId = () => {
    navigator.clipboard.writeText(identity.deviceId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const initial = (displayName || 'U').charAt(0).toUpperCase();

  return (
    <div
      id="profile-modal-backdrop"
      className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 select-none font-sans animate-in fade-in duration-150"
    >
      <div className="w-full max-w-md h-[560px] max-h-[92vh] bg-[#0c0c0e] border border-[#27272a] rounded-2xl shadow-2xl overflow-hidden text-xs flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 border-b border-[#1f1f23] bg-[#09090b] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#18181b] border border-[#27272a] flex items-center justify-center text-white">
              <User className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white tracking-tight">Profile &amp; Identity</h2>
              <p className="text-[11px] text-[#71717a]">Manage your display name and cryptographic avatar</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-[#71717a] hover:text-white hover:bg-[#18181b] rounded-lg transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSaveProfile} className="flex-1 overflow-y-auto p-5 space-y-4 flex flex-col justify-between">
          <div className="space-y-4">
            {/* Avatar Preview & Color Selection */}
            <div className="flex flex-col items-center gap-3 p-4 bg-[#09090b] border border-[#1f1f23] rounded-xl">
              <div
                className="w-16 h-16 rounded-2xl flex items-center justify-center text-white font-bold text-2xl shadow-lg ring-2 ring-[#27272a]"
                style={{ backgroundColor: avatarColor }}
              >
                {initial}
              </div>

              <div className="flex items-center gap-1.5 flex-wrap justify-center pt-1">
                {AVATAR_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => setAvatarColor(color)}
                    className={`w-6 h-6 rounded-full transition-transform ${
                      avatarColor === color ? 'scale-125 ring-2 ring-white shadow-md' : 'hover:scale-110 opacity-80 hover:opacity-100'
                    }`}
                    style={{ backgroundColor: color }}
                    title={color}
                  />
                ))}
              </div>
            </div>

            {/* Form Fields */}
            <div className="space-y-3.5">
              <div>
                <label className="block text-[#a1a1aa] mb-1 font-medium text-xs">Display Name</label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  maxLength={32}
                  placeholder="e.g. Alice, Bob..."
                  className="w-full bg-[#09090b] border border-[#27272a] rounded-xl px-3.5 py-2.5 text-white placeholder-[#52525b] focus:outline-none focus:border-white transition-colors text-xs"
                  required
                />
              </div>

              <div>
                <label className="block text-[#a1a1aa] mb-1 font-medium text-xs">Status / Bio</label>
                <input
                  type="text"
                  value={statusBio}
                  onChange={(e) => setStatusBio(e.target.value)}
                  maxLength={64}
                  placeholder="e.g. Available, Encrypted P2P..."
                  className="w-full bg-[#09090b] border border-[#27272a] rounded-xl px-3.5 py-2.5 text-white placeholder-[#52525b] focus:outline-none focus:border-white transition-colors text-xs"
                />
              </div>

              {/* Device ID Box */}
              <div className="p-3 bg-[#09090b] border border-[#1f1f23] rounded-xl space-y-1.5">
                <div className="flex items-center justify-between text-[#a1a1aa]">
                  <span className="flex items-center gap-1.5 font-medium text-xs">
                    <Fingerprint className="w-3.5 h-3.5 text-white" />
                    Your Device ID
                  </span>
                  <button
                    type="button"
                    onClick={copyDeviceId}
                    className="flex items-center gap-1 text-white hover:text-emerald-400 font-medium transition-colors text-xs"
                  >
                    {copied ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="text-emerald-400">Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copy</span>
                      </>
                    )}
                  </button>
                </div>
                <div className="font-mono text-[11px] text-[#71717a] break-all select-all">
                  {identity.deviceId}
                </div>
              </div>
            </div>
          </div>

          {/* Footer Actions */}
          <div className="pt-3 flex items-center justify-end gap-2 border-t border-[#1f1f23]">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-[#a1a1aa] hover:text-white hover:bg-[#18181b] rounded-xl transition-colors font-medium text-xs"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaved}
              className={`px-5 py-2 rounded-xl font-medium transition-all flex items-center gap-1.5 text-xs ${
                isSaved
                  ? 'bg-emerald-600 text-white'
                  : 'bg-white text-black hover:bg-neutral-200'
              }`}
            >
              {isSaved ? (
                <>
                  <Check className="w-3.5 h-3.5" />
                  <span>Saved!</span>
                </>
              ) : (
                <>
                  <Save className="w-3.5 h-3.5" />
                  <span>Save Changes</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
