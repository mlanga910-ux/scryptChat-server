import React, { useState } from 'react';
import { X, BellOff, Bell, EyeOff, PhoneOff, VideoOff, Eraser, UserX, Check } from 'lucide-react';
import { ContactRecord } from '../types/index';
import {
  getChatSettings,
  saveChatSettings,
  ChatCustomSettings,
} from '../utils/chatSettings';
import {
  MESSAGE_TONES,
  MessageSoundType,
  soundEngine,
} from '../utils/cyberSoundEngine';
import { Avatar } from './Avatar';

interface ChatSettingsModalProps {
  isOpen: boolean;
  contact: ContactRecord | null;
  onClose: () => void;
  onSettingsChanged?: (settings: ChatCustomSettings) => void;
  onClearHistory?: (deviceId: string) => void | Promise<void>;
  onDeleteContact?: (deviceId: string) => void | Promise<void>;
}

/**
 * Per-chat settings: only the switches that actually affect this conversation,
 * plus the two destructive actions that were missing before.
 */
export const ChatSettingsModal: React.FC<ChatSettingsModalProps> = ({
  isOpen,
  contact,
  onClose,
  onSettingsChanged,
  onClearHistory,
  onDeleteContact,
}) => {
  const [settings, setSettingsState] = useState<ChatCustomSettings>(() =>
    contact ? getChatSettings(contact.deviceId) : ({} as ChatCustomSettings)
  );
  const [confirmAction, setConfirmAction] = useState<'clear' | 'remove' | null>(null);
  const [busy, setBusy] = useState(false);
  const [activeTone, setActiveTone] = useState<string | null>(null);

  if (!isOpen || !contact) return null;

  const updateSetting = <K extends keyof ChatCustomSettings>(
    key: K,
    value: ChatCustomSettings[K]
  ) => {
    const updated: ChatCustomSettings = { ...settings, [key]: value };
    setSettingsState(updated);
    saveChatSettings(contact.deviceId, updated);
    onSettingsChanged?.(updated);
  };

  const previewTone = async (tone: MessageSoundType) => {
    setActiveTone(tone);
    await soundEngine.playMessageSound(tone);
    setTimeout(() => setActiveTone((current) => (current === tone ? null : current)), 600);
  };

  const runConfirmAction = async () => {
    if (!confirmAction || busy) return;
    setBusy(true);
    try {
      if (confirmAction === 'clear') await onClearHistory?.(contact.deviceId);
      else await onDeleteContact?.(contact.deviceId);
    } finally {
      setBusy(false);
      setConfirmAction(null);
      onClose();
    }
  };

  const row = 'flex items-center justify-between gap-3 px-3.5 py-3';
  const toggle = (active: boolean, danger = false) =>
    `w-10 h-6 rounded-full transition-colors relative flex items-center p-0.5 shrink-0 cursor-pointer ${
      active ? (danger ? 'bg-rose-500/90' : 'bg-[var(--sc-e400)]') : 'bg-zinc-800'
    }`;

  const selectedTone = settings.customSound === 'default' ? undefined : settings.customSound;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-3 select-none font-sans text-xs animate-in fade-in duration-150">
      <div className="w-full max-w-sm max-h-[88vh] panel-surface border border-zinc-800 rounded-3xl shadow-[var(--sc-shadow-lg)] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="shrink-0 px-4 py-3.5 flex items-center gap-3 border-b border-zinc-800">
          <Avatar
            name={contact.alias}
            avatarUrl={contact.avatarUrl}
            avatarColor={contact.avatarColor}
            size="sm"
          />
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-white truncate">{contact.alias}</h2>
            <p className="text-[10px] text-zinc-500 font-mono truncate">{contact.deviceId}</p>
          </div>
          <button
            onClick={onClose}
            className="grid place-items-center h-8 w-8 rounded-full text-zinc-500 hover:text-white hover:bg-zinc-900 transition-colors cursor-pointer"
            aria-label="Close chat settings"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-3 space-y-3">
          {/* Notifications */}
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/40 overflow-hidden">
            <div className={row}>
              <div className="flex items-center gap-2 min-w-0">
                {settings.muteNotifications ? (
                  <BellOff className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                ) : (
                  <Bell className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                )}
                <span className="font-medium text-white">Mute notifications</span>
              </div>
              <button
                onClick={() => updateSetting('muteNotifications', !settings.muteNotifications)}
                className={toggle(settings.muteNotifications, true)}
                aria-label="Mute notifications"
                aria-pressed={settings.muteNotifications}
              >
                <span
                  className={`w-5 h-5 rounded-full bg-zinc-950 shadow transition-transform ${
                    settings.muteNotifications ? 'translate-x-4' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {!settings.muteNotifications && (
              <div className="px-3.5 pb-3 pt-1 space-y-1.5 border-t border-zinc-800">
                <span className="block text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">
                  Tone
                </span>
                <div className="grid grid-cols-4 gap-1">
                  <button
                    onClick={() => updateSetting('customSound', 'default')}
                    className={`py-2 rounded-xl border text-[10px] font-medium transition-colors cursor-pointer ${
                      settings.customSound === 'default'
                        ? 'border-transparent bg-[var(--sc-accent)] text-[var(--sc-on-accent)]'
                        : 'border-zinc-800 text-zinc-400 hover:text-white'
                    }`}
                    aria-label="Default tone"
                  >
                    Default
                  </button>
                  {MESSAGE_TONES.map((tone) => (
                    <button
                      key={tone.id}
                      onClick={() => {
                        updateSetting('customSound', tone.id);
                        void previewTone(tone.id);
                      }}
                      className={`py-2 rounded-xl border text-[10px] font-medium transition-colors cursor-pointer ${
                        settings.customSound === tone.id
                          ? 'border-transparent bg-[var(--sc-accent)] text-[var(--sc-on-accent)]'
                          : 'border-zinc-800 text-zinc-400 hover:text-white'
                      }`}
                      aria-label={tone.label}
                    >
                      {activeTone === tone.id ? '•' : tone.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Privacy & media */}
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/40 overflow-hidden">
            <div className={row}>
              <div className="flex items-center gap-2 min-w-0">
                <EyeOff className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                <div className="min-w-0">
                  <div className="font-medium text-white">Blur received photos</div>
                  <p className="text-[10px] text-zinc-500">Tap to reveal</p>
                </div>
              </div>
              <button
                onClick={() => updateSetting('blurMedia', !settings.blurMedia)}
                className={toggle(settings.blurMedia)}
                aria-label="Blur received photos"
                aria-pressed={settings.blurMedia}
              >
                <span
                  className={`w-5 h-5 rounded-full bg-zinc-950 shadow transition-transform ${
                    settings.blurMedia ? 'translate-x-4' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          </div>

          {/* Calls from this contact */}
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/40 overflow-hidden">
            <div className={`${row} border-b border-zinc-800`}>
              <div className="flex items-center gap-2 min-w-0">
                <PhoneOff className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                <span className="font-medium text-white">Block voice calls</span>
              </div>
              <button
                onClick={() => updateSetting('blockVoiceCalls', !settings.blockVoiceCalls)}
                className={toggle(settings.blockVoiceCalls, true)}
                aria-label="Block voice calls"
                aria-pressed={settings.blockVoiceCalls}
              >
                <span
                  className={`w-5 h-5 rounded-full bg-zinc-950 shadow transition-transform ${
                    settings.blockVoiceCalls ? 'translate-x-4' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
            <div className={row}>
              <div className="flex items-center gap-2 min-w-0">
                <VideoOff className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                <span className="font-medium text-white">Block video calls</span>
              </div>
              <button
                onClick={() => updateSetting('blockVideoCalls', !settings.blockVideoCalls)}
                className={toggle(settings.blockVideoCalls, true)}
                aria-label="Block video calls"
                aria-pressed={settings.blockVideoCalls}
              >
                <span
                  className={`w-5 h-5 rounded-full bg-zinc-950 shadow transition-transform ${
                    settings.blockVideoCalls ? 'translate-x-4' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          </div>

          {/* Destructive */}
          <div className="rounded-2xl border border-rose-900/40 bg-rose-950/10 overflow-hidden">
            <button
              onClick={() =>
                setConfirmAction((current) => (current === 'clear' ? null : 'clear'))
              }
              className={`${row} w-full text-left hover:bg-rose-950/20 transition-colors cursor-pointer`}
            >
              <div className="flex items-center gap-2">
                <Eraser className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                <span className="font-medium text-rose-300">Clear chat history</span>
              </div>
            </button>
            <button
              onClick={() =>
                setConfirmAction((current) => (current === 'remove' ? null : 'remove'))
              }
              className={`${row} w-full text-left border-t border-rose-900/40 hover:bg-rose-950/20 transition-colors cursor-pointer`}
            >
              <div className="flex items-center gap-2">
                <UserX className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                <span className="font-medium text-rose-300">Remove contact</span>
              </div>
            </button>

            {confirmAction && (
              <div className="px-3.5 pb-3.5 pt-1 space-y-2 sc-fade-in">
                <p className="text-[10px] text-rose-300/90 leading-relaxed">
                  {confirmAction === 'clear'
                    ? 'Delete every message and file in this conversation on this device?'
                    : `Remove ${contact.alias} and this conversation from this device? They stay in their own list until they remove you.`}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={runConfirmAction}
                    disabled={busy}
                    className="flex-1 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-semibold transition-colors disabled:opacity-50 cursor-pointer"
                    aria-label={confirmAction === 'clear' ? 'Confirm clear history' : 'Confirm remove contact'}
                  >
                    {confirmAction === 'clear' ? 'Clear' : 'Remove'}
                  </button>
                  <button
                    onClick={() => setConfirmAction(null)}
                    className="flex-1 py-2 rounded-xl border border-zinc-800 text-zinc-300 hover:text-white transition-colors cursor-pointer"
                    aria-label="Cancel"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          {selectedTone && (
            <p className="flex items-center gap-1.5 text-[10px] text-zinc-600 px-1">
              <Check className="w-3 h-3" />
              These settings stay on this device only.
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
