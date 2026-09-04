import React, { useState, useRef } from 'react';
import { IdentityRecord, SocialLinks } from '../types/index';
import {
  X,
  User,
  Copy,
  Check,
  Save,
  Fingerprint,
  Phone,
  Mail,
  Globe,
  Github,
  Send,
  AtSign,
  Shield,
  Activity,
  Camera,
  Trash2,
  Upload,
} from 'lucide-react';
import { updateIdentityProfile } from '../crypto/keys';
import { fileToAvatarDataUrl } from '../utils/imageHelper';

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
  const [avatarUrl, setAvatarUrl] = useState<string | undefined>(identity.avatarUrl);
  const [statusBio, setStatusBio] = useState(identity.statusBio || 'Online');
  const [status, setStatus] = useState(identity.status || 'Available');
  const [phone, setPhone] = useState(identity.phone || '');
  const [email, setEmail] = useState(identity.email || '');
  const [socialLinks, setSocialLinks] = useState<SocialLinks>(identity.socialLinks || {});
  const [activeTab, setActiveTab] = useState<'general' | 'optional'>('general');
  const [copied, setCopied] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleAvatarFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await fileToAvatarDataUrl(file);
      setAvatarUrl(dataUrl);
    } catch (err) {
      console.error('Error processing avatar image:', err);
    }
  };

  const handleRemoveAvatar = () => {
    setAvatarUrl(undefined);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!displayName.trim()) return;
    const updated = await updateIdentityProfile(
      displayName.trim(),
      avatarColor,
      statusBio.trim(),
      {
        avatarUrl,
        status: status.trim() || undefined,
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        socialLinks: {
          telegram: socialLinks.telegram?.trim() || undefined,
          twitter: socialLinks.twitter?.trim() || undefined,
          github: socialLinks.github?.trim() || undefined,
          instagram: socialLinks.instagram?.trim() || undefined,
          website: socialLinks.website?.trim() || undefined,
        },
      }
    );
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
      <div className="w-full max-w-md h-[600px] max-h-[92vh] bg-[#0c0c0e] border border-[#27272a] rounded-2xl shadow-2xl overflow-hidden text-xs flex flex-col">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-[#1f1f23] bg-[#09090b] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#18181b] border border-[#27272a] flex items-center justify-center text-white">
              <User className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white tracking-tight">Profile &amp; Identity</h2>
              <p className="text-[11px] text-[#71717a]">Manage your profile and optional contact details</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-[#71717a] hover:text-white hover:bg-[#18181b] rounded-lg transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab switcher */}
        <div className="flex items-center px-4 pt-2 border-b border-[#1f1f23] bg-[#09090b] gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab('general')}
            className={`pb-2 px-2 text-xs font-medium border-b-2 transition-colors ${
              activeTab === 'general'
                ? 'border-white text-white'
                : 'border-transparent text-[#71717a] hover:text-[#a1a1aa]'
            }`}
          >
            General Profile
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('optional')}
            className={`pb-2 px-2 text-xs font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === 'optional'
                ? 'border-white text-white'
                : 'border-transparent text-[#71717a] hover:text-[#a1a1aa]'
            }`}
          >
            <span>Optional Info &amp; Socials</span>
            <span className="text-[10px] px-1.5 py-0.2 bg-[#27272a] text-[#a1a1aa] rounded-full">
              Voluntary
            </span>
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSaveProfile} className="flex-1 overflow-y-auto p-4 space-y-4 flex flex-col justify-between">
          {activeTab === 'general' ? (
            <div className="space-y-4">
              {/* Avatar Preview & Custom Photo Upload */}
              <div className="flex flex-col items-center gap-3 p-3.5 bg-[#09090b] border border-[#1f1f23] rounded-xl">
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleAvatarFileSelect}
                  accept="image/*"
                  className="hidden"
                />

                <div className="relative group cursor-pointer" onClick={() => fileInputRef.current?.click()}>
                  <div
                    className="w-16 h-16 rounded-2xl flex items-center justify-center text-white font-bold text-xl shadow-lg ring-2 ring-[#27272a] overflow-hidden"
                    style={{ backgroundColor: avatarUrl ? '#18181b' : avatarColor }}
                  >
                    {avatarUrl ? (
                      <img src={avatarUrl} alt="Avatar" className="w-full h-full object-cover" />
                    ) : (
                      initial
                    )}
                  </div>

                  <div className="absolute inset-0 bg-black/60 rounded-2xl opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity text-white">
                    <Camera className="w-5 h-5" />
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="px-2.5 py-1 bg-[#18181b] hover:bg-[#27272a] border border-[#27272a] text-white rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <Upload className="w-3.5 h-3.5 text-blue-400" />
                    <span>{avatarUrl ? 'Change Photo' : 'Upload Photo'}</span>
                  </button>
                  {avatarUrl && (
                    <button
                      type="button"
                      onClick={handleRemoveAvatar}
                      className="p-1.5 bg-rose-950/40 hover:bg-rose-900/60 border border-rose-900/50 text-rose-300 rounded-lg text-xs transition-colors cursor-pointer"
                      title="Remove custom photo"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {/* Color Palette fallback */}
                <div className="flex items-center gap-1.5 flex-wrap justify-center pt-1 border-t border-[#1f1f23] w-full">
                  <span className="text-[10px] text-[#71717a] mr-1">Fallback Color:</span>
                  {AVATAR_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setAvatarColor(color)}
                      className={`w-4 h-4 rounded-full transition-transform cursor-pointer ${
                        avatarColor === color ? 'scale-125 ring-2 ring-white shadow-md' : 'hover:scale-110 opacity-70 hover:opacity-100'
                      }`}
                      style={{ backgroundColor: color }}
                      title={color}
                    />
                  ))}
                </div>
              </div>

              {/* Form Fields */}
              <div className="space-y-3">
                <div>
                  <label className="block text-[#a1a1aa] mb-1 font-medium text-xs">Display Name *</label>
                  <input
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    maxLength={32}
                    placeholder="e.g. Alice, Bob..."
                    className="w-full bg-[#09090b] border border-[#27272a] rounded-xl px-3 py-2 text-white placeholder-[#52525b] focus:outline-none focus:border-white transition-colors text-xs"
                    required
                  />
                </div>

                <div>
                  <label className="block text-[#a1a1aa] mb-1 font-medium text-xs">Status message</label>
                  <input
                    type="text"
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                    maxLength={40}
                    placeholder="e.g. Available, In a meeting, Busy..."
                    className="w-full bg-[#09090b] border border-[#27272a] rounded-xl px-3 py-2 text-white placeholder-[#52525b] focus:outline-none focus:border-white transition-colors text-xs"
                  />
                </div>

                <div>
                  <label className="block text-[#a1a1aa] mb-1 font-medium text-xs">Bio description</label>
                  <input
                    type="text"
                    value={statusBio}
                    onChange={(e) => setStatusBio(e.target.value)}
                    maxLength={80}
                    placeholder="e.g. Software engineer, Privacy enthusiast..."
                    className="w-full bg-[#09090b] border border-[#27272a] rounded-xl px-3 py-2 text-white placeholder-[#52525b] focus:outline-none focus:border-white transition-colors text-xs"
                  />
                </div>

                {/* Device ID Box */}
                <div className="p-2.5 bg-[#09090b] border border-[#1f1f23] rounded-xl space-y-1">
                  <div className="flex items-center justify-between text-[#a1a1aa]">
                    <span className="flex items-center gap-1.5 font-medium text-[11px]">
                      <Fingerprint className="w-3.5 h-3.5 text-white" />
                      Your Permanent Device ID
                    </span>
                    <button
                      type="button"
                      onClick={copyDeviceId}
                      className="flex items-center gap-1 text-white hover:text-emerald-400 font-medium transition-colors text-xs"
                    >
                      {copied ? (
                        <>
                          <Check className="w-3 h-3 text-emerald-400" />
                          <span className="text-emerald-400">Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" />
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
          ) : (
            <div className="space-y-3.5">
              <div className="p-2.5 bg-[#18181b]/50 border border-[#27272a] rounded-xl flex items-start gap-2 text-[#a1a1aa] text-[11px]">
                <Shield className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <p>
                  All information below is completely optional. It is never transmitted without your consent and is preserved securely in your local E2EE vault.
                </p>
              </div>

              {/* Phone & Email */}
              <div className="space-y-2.5">
                <div>
                  <label className="flex items-center gap-1.5 text-[#a1a1aa] mb-1 font-medium text-xs">
                    <Phone className="w-3.5 h-3.5 text-[#71717a]" />
                    <span>Phone Number (Optional)</span>
                  </label>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="e.g. +421 900 123 456"
                    className="w-full bg-[#09090b] border border-[#27272a] rounded-xl px-3 py-2 text-white placeholder-[#52525b] focus:outline-none focus:border-white transition-colors text-xs"
                  />
                </div>

                <div>
                  <label className="flex items-center gap-1.5 text-[#a1a1aa] mb-1 font-medium text-xs">
                    <Mail className="w-3.5 h-3.5 text-[#71717a]" />
                    <span>Email Address (Optional)</span>
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="e.g. yourname@example.com"
                    className="w-full bg-[#09090b] border border-[#27272a] rounded-xl px-3 py-2 text-white placeholder-[#52525b] focus:outline-none focus:border-white transition-colors text-xs"
                  />
                </div>
              </div>

              {/* Social Profiles */}
              <div className="space-y-2 pt-1">
                <div className="text-[11px] font-semibold text-[#a1a1aa] uppercase tracking-wider">
                  Social Media Links
                </div>

                <div className="grid grid-cols-1 gap-2">
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-[#71717a]">
                      <Send className="w-3.5 h-3.5 text-blue-400" />
                    </div>
                    <input
                      type="text"
                      value={socialLinks.telegram || ''}
                      onChange={(e) => setSocialLinks({ ...socialLinks, telegram: e.target.value })}
                      placeholder="Telegram username (@user)"
                      className="w-full pl-8 pr-3 py-1.5 bg-[#09090b] border border-[#27272a] rounded-xl text-white placeholder-[#52525b] focus:outline-none focus:border-white transition-colors text-xs"
                    />
                  </div>

                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-[#71717a]">
                      <AtSign className="w-3.5 h-3.5 text-sky-400" />
                    </div>
                    <input
                      type="text"
                      value={socialLinks.twitter || ''}
                      onChange={(e) => setSocialLinks({ ...socialLinks, twitter: e.target.value })}
                      placeholder="Twitter / X (@handle)"
                      className="w-full pl-8 pr-3 py-1.5 bg-[#09090b] border border-[#27272a] rounded-xl text-white placeholder-[#52525b] focus:outline-none focus:border-white transition-colors text-xs"
                    />
                  </div>

                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-[#71717a]">
                      <Github className="w-3.5 h-3.5 text-zinc-300" />
                    </div>
                    <input
                      type="text"
                      value={socialLinks.github || ''}
                      onChange={(e) => setSocialLinks({ ...socialLinks, github: e.target.value })}
                      placeholder="GitHub username"
                      className="w-full pl-8 pr-3 py-1.5 bg-[#09090b] border border-[#27272a] rounded-xl text-white placeholder-[#52525b] focus:outline-none focus:border-white transition-colors text-xs"
                    />
                  </div>

                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-[#71717a]">
                      <Globe className="w-3.5 h-3.5 text-emerald-400" />
                    </div>
                    <input
                      type="url"
                      value={socialLinks.website || ''}
                      onChange={(e) => setSocialLinks({ ...socialLinks, website: e.target.value })}
                      placeholder="Personal website URL (https://...)"
                      className="w-full pl-8 pr-3 py-1.5 bg-[#09090b] border border-[#27272a] rounded-xl text-white placeholder-[#52525b] focus:outline-none focus:border-white transition-colors text-xs"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Footer Actions */}
          <div className="pt-3 flex items-center justify-end gap-2 border-t border-[#1f1f23]">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 text-[#a1a1aa] hover:text-white hover:bg-[#18181b] rounded-xl transition-colors font-medium text-xs"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaved}
              className={`px-4 py-1.5 rounded-xl font-medium transition-all flex items-center gap-1.5 text-xs ${
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
