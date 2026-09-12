import React, { useState } from 'react';
import { IdentityRecord } from '../types/index';
import { Shield, User, ArrowRight, Key } from 'lucide-react';
import { updateIdentityProfile } from '../crypto/keys';

interface OnboardingModalProps {
  identity: IdentityRecord;
  onComplete: (updated: IdentityRecord) => void;
}

const AVATAR_COLORS = [
  '#7C5CFC',
  '#3b82f6',
  '#059669',
  '#d97706',
  '#dc2626',
  '#0891b2',
  '#6366f1',
  '#64748b',
];

export const OnboardingModal: React.FC<OnboardingModalProps> = ({
  identity,
  onComplete,
}) => {
  const [displayName, setDisplayName] = useState('');
  const [selectedColor, setSelectedColor] = useState(AVATAR_COLORS[1]);
  const [statusBio, setStatusBio] = useState('Online');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = displayName.trim();
    if (!trimmed) {
      setError('Please enter a display name to continue.');
      return;
    }

    setIsSubmitting(true);
    try {
      const updated = await updateIdentityProfile(trimmed, selectedColor, statusBio);
      if (updated) {
        onComplete(updated);
      }
    } catch (err) {
      setError('Failed to save profile. Please try again.');
      setIsSubmitting(false);
    }
  };

  const initial = displayName.charAt(0).toUpperCase() || 'A';

  return (
    <div
      id="onboarding-modal-backdrop"
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 select-none font-sans animate-in fade-in duration-150"
    >
      <div className="w-full max-w-sm bg-zinc-950 border border-zinc-800 rounded-2xl shadow-xl overflow-hidden p-6 space-y-5">
        {/* Headline */}
        <div className="space-y-1">
          <h1 className="text-base font-semibold text-white tracking-tight">
            Welcome to scryptChat
          </h1>
          <p className="text-xs text-zinc-500">
            Choose a display name to start chatting.
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Avatar Preview & Color Picker */}
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold text-sm shadow-sm"
                style={{ backgroundColor: selectedColor }}
              >
                {initial}
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                {AVATAR_COLORS.map((col) => (
                  <button
                    key={col}
                    type="button"
                    onClick={() => setSelectedColor(col)}
                    className={`w-6 h-6 rounded-full transition-all cursor-pointer ${
                      selectedColor === col
                        ? 'scale-110 ring-2 ring-white ring-offset-2 ring-offset-zinc-950'
                        : 'opacity-70 hover:opacity-100'
                    }`}
                    style={{ backgroundColor: col }}
                    aria-label={`Color ${col}`}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Display Name Input */}
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-zinc-300">
              Display Name
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-zinc-500">
                <User className="w-4 h-4" />
              </div>
              <input
                id="onboarding-name-input"
                type="text"
                value={displayName}
                onChange={(e) => {
                  setDisplayName(e.target.value);
                  if (error) setError('');
                }}
                placeholder="e.g. Alex"
                maxLength={32}
                autoFocus
                className="w-full pl-9 pr-3 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-xs text-white placeholder-zinc-500 input-base focus:ring-1 focus:ring-emerald-400/20"
                aria-label="Display name"
              />
            </div>
            {error && <p className="text-xs text-rose-400 mt-1">{error}</p>}
          </div>

          {/* Status Bio Input */}
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-zinc-300">
              Status (Optional)
            </label>
            <input
              type="text"
              value={statusBio}
              onChange={(e) => setStatusBio(e.target.value)}
              maxLength={80}
              placeholder="e.g. Available, Busy..."
              className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-xs text-white placeholder-zinc-500 input-base focus:ring-1 focus:ring-emerald-400/20"
              aria-label="Status message"
            />
          </div>

          {/* Device ID Display */}
          <div className="space-y-1">
            <label className="block text-[11px] font-medium text-zinc-500">
              Permanent Device ID
            </label>
            <div className="font-mono text-[11px] text-zinc-500 bg-zinc-900 px-2.5 py-1.5 rounded-lg border border-zinc-800 truncate select-all">
              {identity.deviceId}
            </div>
          </div>

          {/* Submit Button */}
          <button
            id="onboarding-submit-btn"
            type="submit"
            disabled={isSubmitting}
            className="w-full flex items-center justify-center gap-1.5 py-2.5 px-4 btn-primary shadow-md"
            aria-label="Continue"
          >
            <span>Continue</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </form>
      </div>
    </div>
  );
};