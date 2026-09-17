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
  '#27272a',
  '#3f3f46',
  '#2563eb',
  '#059669',
  '#d97706',
  '#dc2626',
  '#0891b2',
  '#7c3aed',
  '#db2777',
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
      className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 select-none font-sans animate-in fade-in duration-150"
    >
      <div className="w-full max-w-md h-[600px] max-h-[92vh] bg-zinc-950 border border-zinc-800 rounded-2xl shadow-xl overflow-hidden text-xs flex flex-col">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-zinc-800 bg-zinc-950/50 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center text-white">
              <User className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white tracking-tight">Profile &amp; Identity</h2>
              <p className="text-[11px] text-zinc-500">Manage your profile and optional contact details</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-zinc-500 hover:text-white hover:bg-zinc-900 rounded-lg transition-colors"
            aria-label="Close profile"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab switcher */}
        <div className="flex items-center px-4 pt-2 border-b border-zinc-800 bg-zinc-950/50 gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab('general')}
            className={`pb-2 px-2 text-xs font-medium border-b-2 transition-colors ${
              activeTab === 'general'
                ? 'border-white text-white'
                : 'border-transparent text-zinc-500 hover:text-zinc-300'
            }`}
            aria-label="General profile"
          >
            General Profile
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('optional')}
            className={`pb-2 px-2 text-xs font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === 'optional'
                ? 'border-white text-white'
                : 'border-transparent text-zinc-500 hover:text-zinc-300'
            }`}
            aria-label="Optional info"
          >
            <span>Optional Info &amp; Socials</span>
            <span className="text-[10px] px-1.5 py-0.2 bg-zinc-800 text-zinc-400 rounded-full">
              Voluntary
            </span>
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSaveProfile} className="flex-1 overflow-y-auto p-4 space-y-4 flex flex-col justify-between">
          {activeTab === 'general' ? (
            <div className="space-y-4">
              {/* Avatar Preview & Custom Photo Upload */}
              <div className="flex flex-col items-center gap-3 p-3.5 bg-zinc-950/50 border border-zinc-800 rounded-xl">
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleAvatarFileSelect}
                  accept="image/*"
                  className="hidden"
                  aria-label="Upload avatar"
                />

                <div className="relative group cursor-pointer" onClick={() => fileInputRef.current?.click()}>
                  <div
                    className="w-16 h-16 rounded-2xl flex items-center justify-center text-white font-bold text-xl shadow-lg ring-2 ring-zinc-800 overflow-hidden"
                    style={{ backgroundColor: avatarUrl ? 'transparent' : avatarColor }}
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
                    className="px-2.5 py-1 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-white rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
                    aria-label={avatarUrl ? 'Change photo' : 'Upload photo'}
                  >
                    <Upload className="w-3.5 h-3.5 text-emerald-400" />
                    <span>{avatarUrl ? 'Change Photo' : 'Upload Photo'}</span>
                  </button>
                  {avatarUrl && (
                    <button
                      type="button"
                      onClick={handleRemoveAvatar}
                      className="p-1.5 bg-rose-950/40 hover:bg-rose-900/60 border border-rose-900/50 text-rose-300 rounded-lg text-xs transition-colors cursor-pointer"
                      title="Remove custom photo"
                      aria-label="Remove avatar"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {/* Color Palette fallback */}
                <div className="flex items-center gap-1.5 flex-wrap justify-center pt-1 border-t border-zinc-800 w-full">
                  <span className="text-[10px] text-zinc-500 mr-1">Fallback:</span>
                  {AVATAR_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setAvatarColor(color)}
                      className={`w-4 h-4 rounded-full transition-transform cursor-pointer ${
                        avatarColor === color
                          ? 'scale-125 ring-2 ring-white shadow-md'
                          : 'hover:scale-110 opacity-70 hover:opacity-100'
                      }`}
                      style={{ backgroundColor: color }}
                      aria-label={`Color ${color}`}
                    />
                  ))}
                </div>
              </div>

              {/* Form Fields */}
              <div className="space-y-3">
                <div>
                  <label className="block text-zinc-400 mb-1 font-medium text-xs">
                    Display Name
                  </label>
                  <input
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    maxLength={32}
                    placeholder="e.g. Alice, Bob..."
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-white placeholder-zinc-500 input-base focus:ring-1 focus:ring-emerald-400/20"
                    aria-label="Display name"
                  />
                </div>

                <div>
                  <label className="block text-zinc-400 mb-1 font-medium text-xs">
                    Status message
                  </label>
                  <input
                    type="text"
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                    maxLength={40}
                    placeholder="e.g. Available, In a meeting..."
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-white placeholder-zinc-500 input-base focus:ring-1 focus:ring-emerald-400/20"
                    aria-label="Status message"
                  />
                </div>

                <div>
                  <label className="block text-zinc-400 mb-1 font-medium text-xs">
                    Bio description
                  </label>
                  <input
                    type="text"
                    value={statusBio}
                    onChange={(e) => setStatusBio(e.target.value)}
                    maxLength={80}
                    placeholder="e.g. Software engineer, Privacy enthusiast..."
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-white placeholder-zinc-500 input-base focus:ring-1 focus:ring-emerald-400/20"
                    aria-label="Bio description"
                  />
                </div>

                {/* Device ID Box */}
                <div className="p-2.5 bg-zinc-950/50 border border-zinc-800 rounded-xl space-y-1">
                  <div className="flex items-center justify-between text-zinc-400">
                    <span className="flex items-center gap-1.5 font-medium text-[11px]">
                      <Fingerprint className="w-3.5 h-3.5 text-white" />
                      Your Permanent Device ID
                    </span>
                    <button
                      type="button"
                      onClick={copyDeviceId}
                      className="flex items-center gap-1 text-white hover:text-emerald-400 font-medium"
                      aria-label={copied ? 'Copied' : 'Copy Device ID'}
                    >
                      {copied ? (
                        <Check className="w-3 h-3 text-emerald-400" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                      <span className="text-[10px]">{copied ? 'Copied' : 'Copy'}</span>
                    </button>
                  </div>
                  <div className="font-mono text-[11px] text-zinc-500 break-all select-all">
                    {identity.deviceId}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-3.5">
              <div className="p-2.5 bg-zinc-900/30 border border-zinc-800 rounded-xl flex items-start gap-2 text-zinc-400 text-[11px]">
                <Shield className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <p>Optional. Stored only on this device.</p>
              </div>

              {/* Phone & Email */}
              <div className="space-y-2.5">
                <div>
                  <label className="flex items-center gap-1.5 text-zinc-400 mb-1 font-medium text-xs">
                    <Phone className="w-3.5 h-3.5 text-zinc-500" />
                    <span>Phone Number (Optional)</span>
                  </label>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="e.g. +421 900 123 456"
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-white placeholder-zinc-500 input-base focus:ring-1 focus:ring-emerald-400/20"
                    aria-label="Phone number"
                  />
                </div>

                <div>
                  <label className="flex items-center gap-1.5 text-zinc-400 mb-1 font-medium text-xs">
                    <Mail className="w-3.5 h-3.5 text-zinc-500" />
                    <span>Email Address (Optional)</span>
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="e.g. yourname@example.com"
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-white placeholder-zinc-500 input-base focus:ring-1 focus:ring-emerald-400/20"
                    aria-label="Email address"
                  />
                </div>
              </div>

              {/* Social Profiles */}
              <div className="space-y-2 pt-1">
                <div className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">
                  Social Media Links
                </div>

                <div className="grid grid-cols-1 gap-2">
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-zinc-500">
                      <Send className="w-3.5 h-3.5 text-blue-400" />
                    </div>
                    <input
                      type="text"
                      value={socialLinks.telegram || ''}
                      onChange={(e) => setSocialLinks({ ...socialLinks, telegram: e.target.value })}
                      placeholder="Telegram (@user)"
                      className="w-full pl-8 pr-3 py-1.5 bg-zinc-900 border border-zinc-800 rounded-xl text-white placeholder-zinc-500 input-base focus:ring-1 focus:ring-emerald-400/20"
                      aria-label="Telegram username"
                    />
                  </div>

                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-zinc-500">
                      <AtSign className="w-3.5 h-3.5 text-sky-400" />
                    </div>
                    <input
                      type="text"
                      value={socialLinks.twitter || ''}
                      onChange={(e) => setSocialLinks({ ...socialLinks, twitter: e.target.value })}
                      placeholder="Twitter / X (@handle)"
                      className="w-full pl-8 pr-3 py-1.5 bg-zinc-900 border border-zinc-800 rounded-xl text-white placeholder-zinc-500 input-base focus:ring-1 focus:ring-emerald-400/20"
                      aria-label="Twitter handle"
                    />
                  </div>

                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-zinc-500">
                      <Github className="w-3.5 h-3.5 text-zinc-300" />
                    </div>
                    <input
                      type="text"
                      value={socialLinks.github || ''}
                      onChange={(e) => setSocialLinks({ ...socialLinks, github: e.target.value })}
                      placeholder="GitHub username"
                      className="w-full pl-8 pr-3 py-1.5 bg-zinc-900 border border-zinc-800 rounded-xl text-white placeholder-zinc-500 input-base focus:ring-1 focus:ring-emerald-400/20"
                      aria-label="GitHub username"
                    />
                  </div>

                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-zinc-500">
                      <Globe className="w-3.5 h-3.5 text-emerald-400" />
                    </div>
                    <input
                      type="url"
                      value={socialLinks.website || ''}
                      onChange={(e) => setSocialLinks({ ...socialLinks, website: e.target.value })}
                      placeholder="Personal website (https://...)"
                      className="w-full pl-8 pr-3 py-1.5 bg-zinc-900 border border-zinc-800 rounded-xl text-white placeholder-zinc-500 input-base focus:ring-1 focus:ring-emerald-400/20"
                      aria-label="Website URL"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Footer Actions */}
          <div className="pt-3 flex items-center justify-end gap-2 border-t border-zinc-800">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 text-zinc-400 hover:text-white hover:bg-zinc-900 rounded-xl transition-colors font-medium text-xs"
              aria-label="Cancel"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaved}
              className={`px-4 py-1.5 rounded-xl font-medium transition-all flex items-center gap-1.5 text-xs ${
                isSaved
                  ? 'bg-emerald-400 text-zinc-950'
                  : 'btn-primary'
              }`}
              aria-label={isSaved ? 'Saved' : 'Save changes'}
            >
              {isSaved ? (
                <>
                  <Check className="w-3.5 h-3.5" />
                  <span>Saved</span>
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