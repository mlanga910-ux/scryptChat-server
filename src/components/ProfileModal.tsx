import React, { useEffect, useRef, useState } from 'react';
import { IdentityRecord, SocialLinks } from '../types/index';
import {
  X,
  User,
  Copy,
  Check,
  Camera,
  Trash2,
  Fingerprint,
  ChevronDown,
  Save,
  Phone,
  Mail,
  Globe,
  Github,
  Send,
  AtSign,
} from 'lucide-react';
import { updateIdentityProfile } from '../crypto/keys';
import { fileToAvatarDataUrl } from '../utils/imageHelper';
import { STATUS_PRESETS, statusColor } from '../utils/presence';

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
];

/**
 * Profile window: your name, photo, status and the optional contact details.
 * Nothing about sounds or calls lives here.
 */
export const ProfileModal: React.FC<ProfileModalProps> = ({
  isOpen,
  identity,
  onClose,
  onUpdate,
}) => {
  const [displayName, setDisplayName] = useState('');
  const [avatarColor, setAvatarColor] = useState('#2563eb');
  const [avatarUrl, setAvatarUrl] = useState<string | undefined>(undefined);
  const [status, setStatus] = useState('Online');
  const [statusBio, setStatusBio] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [socialLinks, setSocialLinks] = useState<SocialLinks>({});
  const [showDetails, setShowDetails] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load the current profile every time the window opens.
  useEffect(() => {
    if (!isOpen || !identity) return;
    setDisplayName(identity.displayName || '');
    setAvatarColor(identity.avatarColor || '#2563eb');
    setAvatarUrl(identity.avatarUrl);
    setStatus(identity.status || 'Online');
    setStatusBio(identity.statusBio || '');
    setPhone(identity.phone || '');
    setEmail(identity.email || '');
    setSocialLinks(identity.socialLinks || {});
    setIsSaved(false);
  }, [isOpen, identity?.deviceId]);

  if (!isOpen) return null;

  const handleAvatarFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setAvatarUrl(await fileToAvatarDataUrl(file));
    } catch (err) {
      console.error('Error processing avatar image:', err);
    }
  };

  const copyDeviceId = () => {
    if (!identity?.deviceId) return;
    navigator.clipboard.writeText(identity.deviceId);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!displayName.trim() || isSaving) return;
    setIsSaving(true);
    try {
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
        }, 700);
      }
    } finally {
      setIsSaving(false);
    }
  };

  const initial = (displayName || 'U').charAt(0).toUpperCase();
  const field =
    'w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-white text-xs placeholder-zinc-500 input-base';

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 select-none font-sans text-xs animate-in fade-in duration-150">
      <form
        onSubmit={handleSave}
        className="w-full max-w-md max-h-[92vh] panel-surface border border-zinc-800 rounded-3xl shadow-[var(--sc-shadow-lg)] flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="shrink-0 px-4 py-3.5 flex items-center gap-3 border-b border-zinc-800">
          <div className="grid place-items-center h-8 w-8 rounded-xl border border-zinc-800 bg-zinc-900 text-zinc-300">
            <User className="w-4 h-4" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-white tracking-tight">Profile</h2>
            <p className="text-[10px] text-zinc-500">How contacts see you</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid place-items-center h-8 w-8 rounded-full text-zinc-500 hover:text-white hover:bg-zinc-900 transition-colors cursor-pointer"
            aria-label="Close profile"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 space-y-4">
          {/* Avatar */}
          <div className="flex items-center gap-3 p-3 rounded-2xl border border-zinc-800 bg-zinc-950/40">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleAvatarFileSelect}
              accept="image/*"
              className="hidden"
              aria-label="Upload photo"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="relative group shrink-0 cursor-pointer"
              aria-label="Change photo"
            >
              <div
                className="w-16 h-16 rounded-2xl overflow-hidden grid place-items-center text-white font-semibold text-xl ring-1 ring-zinc-800"
                style={{ backgroundColor: avatarUrl ? 'transparent' : avatarColor }}
              >
                {avatarUrl ? (
                  <img src={avatarUrl} alt="" className="w-full h-full object-cover" />
                ) : (
                  initial
                )}
              </div>
              <span className="absolute inset-0 rounded-2xl bg-black/55 opacity-0 group-hover:opacity-100 transition-opacity grid place-items-center text-white">
                <Camera className="w-5 h-5" />
              </span>
            </button>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="text-xs font-medium text-white hover:opacity-80 transition-opacity cursor-pointer"
                >
                  {avatarUrl ? 'Change photo' : 'Upload photo'}
                </button>
                {avatarUrl && (
                  <button
                    type="button"
                    onClick={() => {
                      setAvatarUrl(undefined);
                      if (fileInputRef.current) fileInputRef.current.value = '';
                    }}
                    className="grid place-items-center w-6 h-6 rounded-lg border border-zinc-800 text-zinc-500 hover:text-rose-400 hover:border-rose-900/60 transition-colors cursor-pointer"
                    title="Remove photo"
                    aria-label="Remove photo"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
              </div>
              <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                {AVATAR_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => setAvatarColor(color)}
                    className={`w-4 h-4 rounded-full transition-transform cursor-pointer ${
                      avatarColor === color
                        ? 'ring-2 ring-white scale-110'
                        : 'opacity-60 hover:opacity-100 hover:scale-105'
                    }`}
                    style={{ backgroundColor: color }}
                    aria-label={`Accent ${color}`}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Display name */}
          <div>
            <label className="block text-zinc-500 mb-1.5 text-[11px] font-medium">Display name</label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={32}
              placeholder="Your name"
              className={field}
              aria-label="Display name"
            />
          </div>

          {/* Status */}
          <div>
            <label className="block text-zinc-500 mb-1.5 text-[11px] font-medium">Status</label>
            <div className="flex flex-wrap gap-1.5">
              {STATUS_PRESETS.map((preset) => {
                const selected = (status || 'Online') === preset.label;
                return (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => setStatus(preset.label)}
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border transition-colors cursor-pointer ${
                      selected
                        ? 'border-transparent bg-[var(--sc-accent)] text-[var(--sc-on-accent)] font-semibold'
                        : 'border-zinc-800 text-zinc-400 hover:text-white hover:border-zinc-700'
                    }`}
                    aria-pressed={selected}
                  >
                    <span
                      className="w-1.5 h-1.5 rounded-full shrink-0"
                      style={{
                        backgroundColor: selected
                          ? 'var(--sc-on-accent)'
                          : statusColor(preset.label),
                      }}
                    />
                    <span className="text-[11px]">{preset.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Bio */}
          <div>
            <label className="block text-zinc-500 mb-1.5 text-[11px] font-medium">Bio</label>
            <input
              type="text"
              value={statusBio}
              onChange={(e) => setStatusBio(e.target.value)}
              maxLength={80}
              placeholder="A short line about you"
              className={field}
              aria-label="Bio"
            />
          </div>

          {/* Optional details */}
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/40 overflow-hidden">
            <button
              type="button"
              onClick={() => setShowDetails((v) => !v)}
              className="w-full flex items-center justify-between px-3 py-2.5 text-xs font-medium text-zinc-400 hover:text-white transition-colors cursor-pointer"
              aria-expanded={showDetails}
            >
              <span>Contact details</span>
              <span className="flex items-center gap-1.5 text-[10px] text-zinc-600">
                Optional
                <ChevronDown
                  className={`w-3.5 h-3.5 transition-transform ${showDetails ? 'rotate-180' : ''}`}
                />
              </span>
            </button>

            {showDetails && (
              <div className="px-3 pb-3 space-y-2.5 sc-fade-in">
                <div className="relative">
                  <Phone className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-600" />
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="Phone number"
                    className={`${field} pl-8`}
                    aria-label="Phone number"
                  />
                </div>
                <div className="relative">
                  <Mail className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-600" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Email address"
                    className={`${field} pl-8`}
                    aria-label="Email address"
                  />
                </div>
                <div className="relative">
                  <Send className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-600" />
                  <input
                    type="text"
                    value={socialLinks.telegram || ''}
                    onChange={(e) => setSocialLinks({ ...socialLinks, telegram: e.target.value })}
                    placeholder="Telegram"
                    className={`${field} pl-8`}
                    aria-label="Telegram"
                  />
                </div>
                <div className="relative">
                  <AtSign className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-600" />
                  <input
                    type="text"
                    value={socialLinks.twitter || ''}
                    onChange={(e) => setSocialLinks({ ...socialLinks, twitter: e.target.value })}
                    placeholder="X / Twitter"
                    className={`${field} pl-8`}
                    aria-label="X username"
                  />
                </div>
                <div className="relative">
                  <Github className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-600" />
                  <input
                    type="text"
                    value={socialLinks.github || ''}
                    onChange={(e) => setSocialLinks({ ...socialLinks, github: e.target.value })}
                    placeholder="GitHub"
                    className={`${field} pl-8`}
                    aria-label="GitHub"
                  />
                </div>
                <div className="relative">
                  <Globe className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-600" />
                  <input
                    type="url"
                    value={socialLinks.website || ''}
                    onChange={(e) => setSocialLinks({ ...socialLinks, website: e.target.value })}
                    placeholder="Website"
                    className={`${field} pl-8`}
                    aria-label="Website"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Device ID */}
          <div className="p-3 rounded-2xl border border-zinc-800 bg-zinc-950/40">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-500">
                <Fingerprint className="w-3.5 h-3.5" />
                Device ID
              </span>
              <button
                type="button"
                onClick={copyDeviceId}
                className="flex items-center gap-1 text-[11px] text-zinc-400 hover:text-white transition-colors cursor-pointer"
                aria-label="Copy device ID"
              >
                {copied ? (
                  <Check className="w-3 h-3 text-[var(--sc-e400)]" />
                ) : (
                  <Copy className="w-3 h-3" />
                )}
                <span>{copied ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
            <p className="mt-1 font-mono text-[11px] text-zinc-500 break-all select-all">
              {identity?.deviceId}
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="shrink-0 px-4 py-3 border-t border-zinc-800 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-2 rounded-xl text-zinc-400 hover:text-white transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!displayName.trim() || isSaving}
            className="px-4 py-2 btn-primary flex items-center gap-1.5"
            aria-label="Save profile"
          >
            {isSaved ? (
              <>
                <Check className="w-3.5 h-3.5" />
                <span>Saved</span>
              </>
            ) : (
              <>
                <Save className="w-3.5 h-3.5" />
                <span>Save</span>
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
};
