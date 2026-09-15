import React, { useRef, useState } from 'react';
import { IdentityRecord } from '../types/index';
import { ArrowLeft, ArrowRight, Camera, Check, Moon, Sun, Trash2 } from 'lucide-react';
import { updateIdentityProfile } from '../crypto/keys';
import { fileToAvatarDataUrl } from '../utils/imageHelper';
import { ScryptChatLogo } from './ScryptChatLogo';
import { useTheme } from '../utils/theme';

interface OnboardingModalProps {
  identity: IdentityRecord;
  onComplete: (updated: IdentityRecord) => void;
}

const AVATAR_COLORS = [
  '#2563eb',
  '#0ea5e9',
  '#0d9488',
  '#059669',
  '#d97706',
  '#dc2626',
  '#64748b',
  '#334155',
];

const STEPS = ['Welcome', 'Profile', 'Appearance'] as const;

/**
 * First-run welcome shown the first time this device is opened (and again after
 * a local data wipe). The user picks a name, photo, bio, status and theme
 * before the chat workspace is unlocked. Everything stays on this device.
 */
export const OnboardingModal: React.FC<OnboardingModalProps> = ({ identity, onComplete }) => {
  const [step, setStep] = useState(0);
  const [displayName, setDisplayName] = useState(identity.displayName || '');
  const [statusBio, setStatusBio] = useState(identity.statusBio || '');
  const [status, setStatus] = useState(identity.status || '');
  const [selectedColor, setSelectedColor] = useState(identity.avatarColor || AVATAR_COLORS[0]);
  const [avatarUrl, setAvatarUrl] = useState<string | undefined>(identity.avatarUrl);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { theme, setTheme } = useTheme();

  const trimmedName = displayName.trim();
  const initial = (trimmedName || 'A').charAt(0).toUpperCase();

  const handleAvatarFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setAvatarUrl(await fileToAvatarDataUrl(file));
      setError('');
    } catch {
      setError('Could not read that image. Try another file.');
    }
  };

  const handleRemoveAvatar = () => {
    setAvatarUrl(undefined);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const goNext = () => {
    if (step === 0 && !trimmedName) {
      setError('Pick a name so contacts recognise this device.');
      return;
    }
    setError('');
    setStep((current) => Math.min(current + 1, STEPS.length - 1));
  };

  const goBack = () => {
    setError('');
    setStep((current) => Math.max(current - 1, 0));
  };

  const finish = async () => {
    if (!trimmedName) {
      setStep(0);
      setError('Pick a name so contacts recognise this device.');
      return;
    }

    setIsSubmitting(true);
    setError('');
    try {
      const updated = await updateIdentityProfile(trimmedName, selectedColor, statusBio.trim(), {
        avatarUrl,
        status: status.trim() || undefined,
      });
      if (updated) {
        onComplete(updated);
      } else {
        setError('Could not save your profile. Please try again.');
        setIsSubmitting(false);
      }
    } catch {
      setError('Could not save your profile. Please try again.');
      setIsSubmitting(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (step < STEPS.length - 1) {
      goNext();
      return;
    }
    void finish();
  };

  return (
    <div
      id="onboarding-modal-backdrop"
      className="fixed inset-0 z-[60] bg-zinc-950 flex items-start sm:items-center justify-center overflow-y-auto select-none font-sans"
    >
      <div className="w-full max-w-md my-auto p-4 sm:p-6">
        <div className="flex justify-center mb-6">
          <ScryptChatLogo size={40} showText />
        </div>

        <div className="rounded-3xl border border-zinc-800 bg-zinc-900 p-5 sm:p-6 space-y-5">
          {/* Step indicator */}
          <div className="flex items-center gap-2">
            {STEPS.map((label, index) => (
              <div key={label} className="flex items-center gap-2">
                <span
                  className={`h-1.5 rounded-full transition-all ${
                    index === step
                      ? 'w-8 bg-zinc-100'
                      : index < step
                        ? 'w-4 bg-zinc-600'
                        : 'w-4 bg-zinc-800'
                  }`}
                />
              </div>
            ))}
            <span className="ml-auto text-[11px] text-zinc-500">
              {step + 1} / {STEPS.length}
            </span>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* ------------------------------- step 0 ------------------------------ */}
            {step === 0 && (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <h1 className="text-base font-medium text-white">Welcome to scryptChat</h1>
                  <p className="text-xs text-zinc-500 leading-relaxed">
                    This device creates its own keys. Messages, files and calls stay between the
                    devices you pair - nothing is stored on a server.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="onboarding-name" className="text-[11px] text-zinc-400">
                    Your name
                  </label>
                  <input
                    id="onboarding-name"
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="e.g. Alex"
                    maxLength={40}
                    autoFocus
                    className="input-base"
                    aria-label="Display name"
                  />
                </div>

                <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-3">
                  <p className="text-[11px] text-zinc-500 mb-1.5">This device</p>
                  <p className="font-mono text-[11px] text-zinc-400 truncate select-all">
                    {identity.deviceId}
                  </p>
                </div>
              </div>
            )}

            {/* ------------------------------- step 1 ------------------------------ */}
            {step === 1 && (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <h1 className="text-base font-medium text-white">Add a face to the name</h1>
                  <p className="text-xs text-zinc-500">
                    Optional - contacts see this photo next to your messages.
                  </p>
                </div>

                <div className="flex flex-col items-center gap-3">
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleAvatarFileSelect}
                    accept="image/*"
                    className="hidden"
                    aria-label="Profile photo"
                  />

                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="relative w-24 h-24 rounded-full overflow-hidden border border-zinc-800 cursor-pointer group"
                    aria-label="Upload profile photo"
                  >
                    {avatarUrl ? (
                      <img src={avatarUrl} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <span
                        className="w-full h-full flex items-center justify-center text-2xl font-medium text-white"
                        style={{ backgroundColor: selectedColor }}
                      >
                        {initial}
                      </span>
                    )}
                    <span className="absolute inset-0 bg-black/45 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <Camera className="w-5 h-5 text-white" />
                    </span>
                  </button>

                  <div className="flex items-center gap-3 text-[11px]">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="text-zinc-300 hover:text-white transition-colors cursor-pointer"
                    >
                      Upload photo
                    </button>
                    {avatarUrl && (
                      <button
                        type="button"
                        onClick={handleRemoveAvatar}
                        className="flex items-center gap-1 text-rose-400 hover:text-rose-300 transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-3 h-3" />
                        <span>Remove</span>
                      </button>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                    {AVATAR_COLORS.map((color) => (
                      <button
                        key={color}
                        type="button"
                        onClick={() => setSelectedColor(color)}
                        style={{ backgroundColor: color }}
                        className={`w-6 h-6 rounded-full transition-transform cursor-pointer ${
                          selectedColor === color ? 'ring-2 ring-offset-2 ring-offset-zinc-900 ring-zinc-400' : ''
                        }`}
                        aria-label={`Avatar colour ${color}`}
                      />
                    ))}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="onboarding-bio" className="text-[11px] text-zinc-400">
                    Bio
                  </label>
                  <textarea
                    id="onboarding-bio"
                    value={statusBio}
                    onChange={(e) => setStatusBio(e.target.value)}
                    placeholder="A line about you"
                    maxLength={160}
                    rows={2}
                    className="input-base resize-none"
                  />
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="onboarding-status" className="text-[11px] text-zinc-400">
                    Current status
                  </label>
                  <input
                    id="onboarding-status"
                    type="text"
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                    placeholder="Available, Busy, On the move…"
                    maxLength={40}
                    className="input-base"
                  />
                </div>
              </div>
            )}

            {/* ------------------------------- step 2 ------------------------------ */}
            {step === 2 && (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <h1 className="text-base font-medium text-white">Pick your look</h1>
                  <p className="text-xs text-zinc-500">You can switch this any time from the header.</p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {(
                    [
                      { mode: 'light' as const, label: 'Light', icon: <Sun className="w-4 h-4" /> },
                      { mode: 'dark' as const, label: 'Dark', icon: <Moon className="w-4 h-4" /> },
                    ]
                  ).map((option) => (
                    <button
                      key={option.mode}
                      type="button"
                      onClick={() => setTheme(option.mode)}
                      className={`rounded-2xl border p-4 text-left transition-colors cursor-pointer ${
                        theme === option.mode
                          ? 'border-zinc-500 bg-zinc-800'
                          : 'border-zinc-800 bg-zinc-950 hover:border-zinc-700'
                      }`}
                      aria-pressed={theme === option.mode}
                    >
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-zinc-300">{option.icon}</span>
                        {theme === option.mode && <Check className="w-3.5 h-3.5 text-zinc-200" />}
                      </div>
                      <span className="text-xs font-medium text-white">{option.label}</span>
                      <div className="mt-2 space-y-1">
                        <span
                          className={`block h-1.5 rounded-full ${
                            option.mode === 'light' ? 'bg-zinc-700' : 'bg-zinc-700'
                          }`}
                        />
                        <span className="block h-1.5 w-2/3 rounded-full bg-zinc-800" />
                      </div>
                    </button>
                  ))}
                </div>

                <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-3 space-y-1">
                  <p className="text-[11px] text-zinc-400">
                    {trimmedName || 'Unnamed device'}
                    {status ? ` · ${status}` : ''}
                  </p>
                  <p className="text-[11px] text-zinc-500 truncate">
                    {statusBio || 'No bio yet'}
                  </p>
                </div>
              </div>
            )}

            {error && <p className="text-[11px] text-rose-400">{error}</p>}

            {/* Navigation */}
            <div className="flex items-center gap-2">
              {step > 0 && (
                <button
                  type="button"
                  onClick={goBack}
                  className="flex items-center gap-1.5 px-4 py-2.5 btn-secondary text-xs"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Back</span>
                </button>
              )}
              <button
                id="onboarding-submit-btn"
                type="submit"
                disabled={isSubmitting}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 px-4 btn-primary text-xs"
              >
                <span>
                  {step === STEPS.length - 1
                    ? isSubmitting
                      ? 'Saving…'
                      : 'Enter scryptChat'
                    : 'Continue'}
                </span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </form>
        </div>

        <button
          type="button"
          onClick={() => onComplete(identity)}
          className="mt-4 w-full py-2 text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer"
        >
          Skip setup for now
        </button>
      </div>
    </div>
  );
};
