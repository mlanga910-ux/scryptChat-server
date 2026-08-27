import React, { useState } from 'react';
import { IdentityRecord } from '../types/index';
import { Shield, User, ArrowRight, Key, Sparkles } from 'lucide-react';
import { updateIdentityProfile } from '../crypto/keys';

interface OnboardingModalProps {
  identity: IdentityRecord;
  onComplete: (updated: IdentityRecord) => void;
}

const AVATAR_COLORS = [
  '#7C5CFC', // Primary Violet
  '#3b82f6', // Blue
  '#10b981', // Emerald
  '#f59e0b', // Amber
  '#ec4899', // Pink
  '#06b6d4', // Cyan
  '#6366f1', // Indigo
  '#64748b', // Slate
];

export const OnboardingModal: React.FC<OnboardingModalProps> = ({
  identity,
  onComplete,
}) => {
  const [displayName, setDisplayName] = useState('');
  const [selectedColor, setSelectedColor] = useState(AVATAR_COLORS[1]); // Blue by default
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

  return (
    <div
      id="onboarding-modal-backdrop"
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 select-none font-sans"
    >
      <div className="w-full max-w-sm bg-[#18181b] border border-[#27272a] rounded-2xl shadow-xl overflow-hidden p-6 space-y-5">
        {/* Headline */}
        <div className="space-y-1">
          <h1 className="text-base font-semibold text-white tracking-tight">
            Welcome to scryptChat
          </h1>
          <p className="text-xs text-[#a1a1aa]">
            Choose a display name to start chatting.
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Display Name Input */}
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-[#d4d4d8]">
              Display Name
            </label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-[#71717a]">
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
                className="w-full pl-9 pr-3 py-2 bg-[#09090b] border border-[#27272a] rounded-lg text-xs text-white placeholder-[#71717a] focus:outline-none focus:border-white transition-colors"
              />
            </div>
            {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
          </div>

          {/* Avatar Color Picker */}
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-[#d4d4d8]">
              Avatar Color
            </label>
            <div className="flex items-center gap-2">
              {AVATAR_COLORS.map((col) => (
                <button
                  key={col}
                  type="button"
                  onClick={() => setSelectedColor(col)}
                  className={`w-6 h-6 rounded-full transition-all ${
                    selectedColor === col ? 'scale-110 ring-2 ring-white ring-offset-2 ring-offset-[#18181b]' : 'opacity-70 hover:opacity-100'
                  }`}
                  style={{ backgroundColor: col }}
                />
              ))}
            </div>
          </div>

          {/* Device ID Display */}
          <div className="space-y-1">
            <label className="block text-[11px] font-medium text-[#71717a]">
              Permanent Device ID
            </label>
            <div className="font-mono text-[11px] text-[#a1a1aa] bg-[#09090b] px-2.5 py-1.5 rounded-lg border border-[#27272a] truncate select-all">
              {identity.deviceId}
            </div>
          </div>

          {/* Submit Button */}
          <button
            id="onboarding-submit-btn"
            type="submit"
            disabled={isSubmitting}
            className="w-full flex items-center justify-center gap-1.5 py-2.5 px-4 bg-white hover:bg-neutral-200 text-black font-semibold text-xs rounded-lg transition-all active:scale-[0.99] disabled:opacity-50 mt-2"
          >
            <span>Continue</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </form>
      </div>
    </div>
  );
};

