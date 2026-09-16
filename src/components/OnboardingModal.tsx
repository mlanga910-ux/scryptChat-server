import React, { useRef, useState } from 'react';
import { IdentityRecord } from '../types/index';
import { ArrowLeft, ArrowRight, Camera, Check, Moon, RefreshCw, Sun, Trash2 } from 'lucide-react';
import { getOrCreateIdentity, updateIdentityProfile } from '../crypto/keys';
import { fileToAvatarDataUrl } from '../utils/imageHelper';
import { ScryptChatLogo } from './ScryptChatLogo';
import { useTheme } from '../utils/theme';

interface OnboardingModalProps {
  identity: IdentityRecord | null;
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

const STEPS = ['Name', 'Profile', 'Look'] as const;

/**
 * First-run welcome shown the first time this device opens scryptChat, and again
 * after a local data wipe. Collects a name, photo, bio, status and theme, then
 * unlocks the chat workspace. Stored entirely on this device.
 */
export const OnboardingModal: React.FC<OnboardingModalProps> = ({ identity, onComplete }) => {
  const [step, setStep] = useState(0);
  const [displayName, setDisplayName] = useState(identity?.displayName || '');
  const [statusBio, setStatusBio] = useState(identity?.statusBio || '');
  const [status, setStatus] = useState(identity?.status || '');
  const [selectedColor, setSelectedColor] = useState(identity?.avatarColor || AVATAR_COLORS[0]);
  const [avatarUrl, setAvatarUrl] = useState<string | undefined>(identity?.avatarUrl);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { theme, setTheme } = useTheme();

  const trimmedName = displayName.trim();
  const previewInitial = (trimmedName || 'A').charAt(0).toUpperCase();

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
      setError('Pick a name first.');
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
      setError('Pick a name first.');
      return;
    }

    setIsSubmitting(true);
    setError('');
    try {
      if (!identity) {
        // No vault yet (storage was cleared, or the very first run): mint the
        // device identity here so the profile always has somewhere to live.
        await getOrCreateIdentity(trimmedName, selectedColor);
      }
      const updated = await updateIdentityProfile(trimmedName, selectedColor, statusBio.trim(), {
        avatarUrl,
        status: status.trim() || undefined,
      });
      if (updated) {
        onComplete(updated);
        return;
      }
      setError('Could not save your profile. Please try again.');
    } catch {
      setError('Could not save your profile. Please try again.');
    }
    setIsSubmitting(false);
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
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-zinc-950 text-zinc-100 select-none font-sans">
      {/* Ambient backdrop */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="onb-blob onb-blob-a" />
        <div className="onb-blob onb-blob-b" />
        <div className="onb-grid absolute inset-0" />
      </div>

      <div className="relative min-h-full flex flex-col items-center justify-center px-4 py-10">
        {/* Brand */}
        <div className="flex flex-col items-center gap-4 onb-fade-up">
          <div className="relative">
            <span className="onb-ring" />
            <div className="relative flex h-12 w-12 items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-900">
              <ScryptChatLogo size={26} />
            </div>
          </div>
          <div className="text-center space-y-1">
            <h1 className="text-lg font-medium tracking-tight text-white">Welcome to scryptChat</h1>
            <p className="text-[11px] text-zinc-500">
              {STEPS[step]} · {step + 1} of {STEPS.length}
            </p>
          </div>
        </div>

        {/* Card */}
        <div
          className="onb-fade-up mt-6 w-full max-w-md rounded-3xl border border-zinc-800 bg-zinc-900/80 p-5 sm:p-6 backdrop-blur-xl shadow-[var(--sc-shadow-lg)]"
          style={{ animationDelay: '80ms' }}
        >
          {/* Progress */}
          <div className="mb-5 flex items-center gap-1.5">
            {STEPS.map((label, index) => (
              <span
                key={label}
                className={`h-1 flex-1 rounded-full transition-colors duration-300 ${
                  index <= step ? 'bg-[var(--sc-fg-strong)]' : 'bg-zinc-800'
                }`}
              />
            ))}
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div key={step} className="onb-step space-y-5">
              {/* ------------------------------- name ------------------------------ */}
              {step === 0 && (
                <>
                  <div className="space-y-1.5">
                    <label htmlFor="onboarding-name" className="text-[11px] text-zinc-400">
                      Your name
                    </label>
                    <input
                      id="onboarding-name"
                      type="text"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="Alex"
                      maxLength={40}
                      autoFocus
                      className="input-base"
                      aria-label="Display name"
                    />
                  </div>

                  <div className="rounded-2xl border border-zinc-800 bg-zinc-950/70 p-3">
                    <p className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">
                      This device
                    </p>
                    <p className="truncate font-mono text-[11px] text-zinc-400 select-all">
                      {identity?.deviceId || 'Generating keys…'}
                    </p>
                  </div>
                </>
              )}

              {/* ------------------------------ profile ----------------------------- */}
              {step === 1 && (
                <>
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
                      className="group relative h-24 w-24 overflow-hidden rounded-full border border-zinc-800 cursor-pointer onb-pop"
                      aria-label="Upload profile photo"
                    >
                      {avatarUrl ? (
                        <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <span
                          className="flex h-full w-full items-center justify-center text-2xl font-medium text-white transition-colors"
                          style={{ backgroundColor: selectedColor }}
                        >
                          {previewInitial}
                        </span>
                      )}
                      <span className="absolute inset-0 flex items-center justify-center bg-black/45 opacity-0 transition-opacity group-hover:opacity-100">
                        <Camera className="h-5 w-5 text-white" />
                      </span>
                    </button>

                    <div className="flex items-center gap-3 text-[11px]">
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="text-zinc-300 transition-colors hover:text-white cursor-pointer"
                      >
                        {avatarUrl ? 'Replace photo' : 'Upload photo'}
                      </button>
                      {avatarUrl && (
                        <button
                          type="button"
                          onClick={handleRemoveAvatar}
                          className="flex items-center gap-1 text-rose-400 transition-colors hover:text-rose-300 cursor-pointer"
                        >
                          <Trash2 className="h-3 w-3" />
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
                          className={`h-6 w-6 rounded-full transition-transform hover:scale-110 cursor-pointer ${
                            selectedColor === color && !avatarUrl
                              ? 'ring-2 ring-offset-2 ring-offset-zinc-900 ring-zinc-400'
                              : ''
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
                      placeholder="A short line about you"
                      maxLength={160}
                      rows={2}
                      className="input-base resize-none"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label htmlFor="onboarding-status" className="text-[11px] text-zinc-400">
                      Status
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
                </>
              )}

              {/* ------------------------------- theme ------------------------------ */}
              {step === 2 && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { mode: 'light' as const, label: 'Light', icon: <Sun className="h-4 w-4" /> },
                      { mode: 'dark' as const, label: 'Dark', icon: <Moon className="h-4 w-4" /> },
                    ].map((option) => (
                      <button
                        key={option.mode}
                        type="button"
                        onClick={() => setTheme(option.mode)}
                        className={`rounded-2xl border p-3 text-left transition-all cursor-pointer ${
                          theme === option.mode
                            ? 'border-zinc-500 bg-zinc-800'
                            : 'border-zinc-800 bg-zinc-950 hover:border-zinc-700'
                        }`}
                        aria-pressed={theme === option.mode}
                      >
                        <div className="mb-3 flex items-center justify-between">
                          <span className="text-zinc-300">{option.icon}</span>
                          {theme === option.mode && <Check className="h-3.5 w-3.5 text-zinc-200" />}
                        </div>
                        <span className="text-xs font-medium text-white">{option.label}</span>
                        <div className="mt-2 space-y-1">
                          <span
                            className={`block h-1.5 rounded-full ${
                              option.mode === 'light' ? 'bg-zinc-400' : 'bg-zinc-600'
                            }`}
                          />
                          <span className="block h-1.5 w-2/3 rounded-full bg-zinc-700" />
                        </div>
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center gap-3 rounded-2xl border border-zinc-800 bg-zinc-950/70 p-3">
                    {avatarUrl ? (
                      <img src={avatarUrl} alt="" className="h-10 w-10 rounded-full object-cover" />
                    ) : (
                      <span
                        className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-medium text-white"
                        style={{ backgroundColor: selectedColor }}
                      >
                        {previewInitial}
                      </span>
                    )}
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium text-white">
                        {trimmedName || 'Unnamed device'}
                      </p>
                      <p className="truncate text-[11px] text-zinc-500">
                        {status ? `${status} · ` : ''}
                        {statusBio || 'No bio yet'}
                      </p>
                    </div>
                  </div>

                  <p className="text-[11px] text-zinc-500">
                    You can change any of this later from your profile.
                  </p>
                </>
              )}
            </div>

            {error && (
              <p className="flex items-center gap-1.5 text-[11px] text-rose-400">
                <RefreshCw className="h-3 w-3" />
                <span>{error}</span>
              </p>
            )}

            {/* Navigation */}
            <div className="flex items-center gap-2">
              {step > 0 && (
                <button
                  type="button"
                  onClick={goBack}
                  className="btn-secondary flex items-center gap-1.5 px-4 py-2.5 text-xs"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  <span>Back</span>
                </button>
              )}
              <button
                id="onboarding-submit-btn"
                type="submit"
                disabled={isSubmitting}
                className="btn-primary flex flex-1 items-center justify-center gap-2 px-4 py-2.5 text-xs"
              >
                <span>
                  {step === STEPS.length - 1
                    ? isSubmitting
                      ? 'Saving…'
                      : 'Enter scryptChat'
                    : 'Continue'}
                </span>
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
