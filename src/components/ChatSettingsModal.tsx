import React, { useState } from 'react';
import {
  X,
  EyeOff,
  Eye,
  Download,
  BellOff,
  Bell,
  Clock,
  FileText,
  Shield,
  RotateCcw,
  PhoneOff,
  VideoOff,
  Play,
  Check,
} from 'lucide-react';
import { ContactRecord } from '../types/index';
import {
  getChatSettings,
  saveChatSettings,
  ChatCustomSettings,
  DEFAULT_CHAT_SETTINGS,
} from '../utils/chatSettings';
import { MessageSoundType, soundEngine } from '../utils/cyberSoundEngine';

interface ChatSettingsModalProps {
  isOpen: boolean;
  contact: ContactRecord | null;
  onClose: () => void;
  onSettingsChanged?: (settings: ChatCustomSettings) => void;
}

const DISAPPEARING_OPTIONS = [
  { value: 0, label: 'Off' },
  { value: 3600, label: '1 Hour' },
  { value: 86400, label: '24 Hours' },
  { value: 604800, label: '7 Days' },
];

const SOUND_OPTIONS: { id: MessageSoundType | 'default'; label: string }[] = [
  { id: 'default', label: 'Default App Tone' },
  { id: 'neural_ping', label: 'Neural Ping' },
  { id: 'quantum_chime', label: 'Quantum Chime' },
  { id: 'cyber_glitch', label: 'Cyber Glitch' },
  { id: 'glitch_ping', label: 'Glitch Ping' },
  { id: 'laser_blip', label: 'Laser Blip' },
  { id: 'sub_thud', label: 'Sub Thud' },
  { id: 'matrix_chime', label: 'Matrix Chime' },
];

export const ChatSettingsModal: React.FC<ChatSettingsModalProps> = ({
  isOpen,
  contact,
  onClose,
  onSettingsChanged,
}) => {
  if (!isOpen || !contact) return null;

  const [settings, setSettingsState] = useState<ChatCustomSettings>(() =>
    getChatSettings(contact.deviceId)
  );

  const updateSetting = <K extends keyof ChatCustomSettings>(
    key: K,
    value: ChatCustomSettings[K]
  ) => {
    const updated: ChatCustomSettings = { ...settings, [key]: value };
    setSettingsState(updated);
    saveChatSettings(contact.deviceId, updated);
    onSettingsChanged?.(updated);
  };

  const handleTestSound = async (soundId: MessageSoundType | 'default') => {
    if (soundId === 'default') {
      await soundEngine.playMessageReceived();
    } else {
      await soundEngine.playMessageSound(soundId);
    }
  };

  const handleResetDefaults = () => {
    setSettingsState(DEFAULT_CHAT_SETTINGS);
    saveChatSettings(contact.deviceId, DEFAULT_CHAT_SETTINGS);
    onSettingsChanged?.(DEFAULT_CHAT_SETTINGS);
  };

  return (
    <div
      id="chat-settings-backdrop"
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150 font-sans select-none"
    >
      <div className="w-full max-w-md bg-zinc-950 border border-zinc-800 rounded-2xl shadow-xl overflow-hidden text-xs flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-5 py-4 border-b border-zinc-800 bg-zinc-950/50 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-white font-medium text-xs shadow-sm"
              style={{ backgroundColor: contact.avatarColor || '#3f3f46' }}
            >
              {contact.alias.charAt(0).toUpperCase()}
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">
                {contact.alias}
              </h2>
              <p className="text-[11px] text-zinc-500">
                Customized local settings
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-zinc-500 hover:text-white hover:bg-zinc-900 rounded-lg transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Privacy Note */}
          <div className="p-3 bg-zinc-900/30 border border-zinc-800 rounded-xl flex items-start gap-2 text-zinc-400 text-[11px]">
            <Shield className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
            <p>
              These options are stored locally on your device.
            </p>
          </div>

          {/* 1. Blur / Hide Images by Default */}
          <div className="p-4 bg-zinc-950/50 border border-zinc-800 rounded-xl space-y-2">
            <div className="flex items-center justify-between">
              <div className="pr-3">
                <div className="flex items-center gap-1.5 font-medium text-white">
                  <EyeOff className="w-3.5 h-3.5 text-amber-400" />
                  <span>Blur Images by Default</span>
                </div>
                <p className="text-zinc-500 text-[11px] mt-0.5">
                  Received photos appear blurred with a reveal button.
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer flex-shrink-0">
                <input
                  type="checkbox"
                  checked={settings.blurMedia}
                  onChange={(e) => updateSetting('blurMedia', e.target.checked)}
                  className="sr-only peer"
                  aria-label="Blur media"
                />
                <div className="w-9 h-5 bg-zinc-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-400" />
              </label>
            </div>
          </div>

          {/* 2. Notifications & Mute */}
          <div className="p-4 bg-zinc-950/50 border border-zinc-800 rounded-xl space-y-3">
            <div className="flex items-center justify-between">
              <div className="pr-3">
                <div className="flex items-center gap-1.5 font-medium text-white">
                  {settings.muteNotifications ? (
                    <BellOff className="w-3.5 h-3.5 text-rose-400" />
                  ) : (
                    <Bell className="w-3.5 h-3.5 text-white" />
                  )}
                  <span>Mute Notifications</span>
                </div>
                <p className="text-zinc-500 text-[11px] mt-0.5">
                  Silence alerts and banner notifications from this contact.
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer flex-shrink-0">
                <input
                  type="checkbox"
                  checked={settings.muteNotifications}
                  onChange={(e) => updateSetting('muteNotifications', e.target.checked)}
                  className="sr-only peer"
                  aria-label="Mute notifications"
                />
                <div className="w-9 h-5 bg-zinc-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-rose-600" />
              </label>
            </div>

            {!settings.muteNotifications && (
              <div className="pt-2 border-t border-zinc-800 space-y-1.5">
                <label className="block text-zinc-500 font-medium text-[11px]">
                  Notification Tone for this Chat
                </label>
                <div className="flex items-center gap-2">
                  <select
                    value={settings.customSound || 'default'}
                    onChange={(e) => updateSetting('customSound', e.target.value as any)}
                    className="flex-1 bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-white text-xs focus:ring-1 focus:ring-emerald-400/20"
                    aria-label="Notification tone"
                  >
                    {SOUND_OPTIONS.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => handleTestSound(settings.customSound)}
                    className="px-3 py-2 bg-white hover:bg-neutral-200 text-zinc-950 font-medium rounded-xl text-xs transition-colors flex-shrink-0 shadow-sm"
                    aria-label="Test sound"
                  >
                    <Play className="w-3 h-3" />
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* 3. Auto-Download Media */}
          <div className="p-4 bg-zinc-950/50 border border-zinc-800 rounded-xl space-y-2">
            <div className="flex items-center justify-between">
              <div className="pr-3">
                <div className="flex items-center gap-1.5 font-medium text-white">
                  <Download className="w-3.5 h-3.5 text-white" />
                  <span>Auto-Download Media</span>
                </div>
                <p className="text-zinc-500 text-[11px] mt-0.5">
                  Automatically store incoming file chunks locally.
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer flex-shrink-0">
                <input
                  type="checkbox"
                  checked={settings.autoDownloadMedia}
                  onChange={(e) => updateSetting('autoDownloadMedia', e.target.checked)}
                  className="sr-only peer"
                  aria-label="Auto-download media"
                />
                <div className="w-9 h-5 bg-zinc-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-400" />
              </label>
            </div>
          </div>

          {/* 4. Disappearing Messages */}
          <div className="p-4 bg-zinc-950/50 border border-zinc-800 rounded-xl space-y-2.5">
            <div>
              <div className="flex items-center gap-1.5 font-medium text-white">
                <Clock className="w-3.5 h-3.5 text-white" />
                <span>Message Timer</span>
              </div>
              <p className="text-zinc-500 text-[11px] mt-0.5">
                Automatically purge messages older than the selected period.
              </p>
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {DISAPPEARING_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => updateSetting('disappearingTimerSeconds', opt.value)}
                  className={`py-2 px-1 rounded-xl text-center font-medium transition-all ${
                    settings.disappearingTimerSeconds === opt.value
                      ? 'bg-emerald-400 text-zinc-950 font-semibold'
                      : 'bg-zinc-900 border border-zinc-800 text-zinc-500 hover:text-white'
                  }`}
                  aria-label={`Set timer to ${opt.label}`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* 5. Call & Video Permissions */}
          <div className="p-4 bg-zinc-950/50 border border-zinc-800 rounded-xl space-y-3">
            <div>
              <div className="font-medium text-white flex items-center gap-1.5">
                <PhoneOff className="w-3.5 h-3.5 text-rose-400" />
                <span>Call &amp; Video Call Permissions</span>
              </div>
              <p className="text-zinc-500 text-[11px] mt-0.5">
                Restrict this contact from calling you.
              </p>
            </div>

            <div className="space-y-2 pt-1 border-t border-zinc-800">
              {/* Block Voice Calls */}
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs text-white font-medium">Block Voice Calls</span>
                  <p className="text-[10px] text-zinc-500">Silently reject incoming audio calls</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer flex-shrink-0">
                  <input
                    type="checkbox"
                    checked={settings.blockVoiceCalls}
                    onChange={(e) => updateSetting('blockVoiceCalls', e.target.checked)}
                    className="sr-only peer"
                    aria-label="Block voice calls"
                  />
                  <div className="w-9 h-5 bg-zinc-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-rose-600" />
                </label>
              </div>

              {/* Block Video Calls */}
              <div className="flex items-center justify-between pt-1 border-t border-zinc-800">
                <div>
                  <span className="text-xs text-white font-medium">Block Video Calls</span>
                  <p className="text-[10px] text-zinc-500">Silently reject incoming video calls</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer flex-shrink-0">
                  <input
                    type="checkbox"
                    checked={settings.blockVideoCalls}
                    onChange={(e) => updateSetting('blockVideoCalls', e.target.checked)}
                    className="sr-only peer"
                    aria-label="Block video calls"
                  />
                  <div className="w-9 h-5 bg-zinc-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-rose-600" />
                </label>
              </div>
            </div>
          </div>

          {/* 6. Private Notes */}
          <div className="p-4 bg-zinc-950/50 border border-zinc-800 rounded-xl space-y-2">
            <div className="flex items-center gap-1.5 font-medium text-white">
              <FileText className="w-3.5 h-3.5 text-white" />
              <span>Private Notes</span>
            </div>
            <textarea
              value={settings.privateNotes || ''}
              onChange={(e) => updateSetting('privateNotes', e.target.value)}
              placeholder="Notes about this contact (local only)..."
              rows={2}
              className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-2.5 text-white text-xs placeholder-zinc-500 input-base focus:ring-1 focus:ring-emerald-400/20 resize-none"
              aria-label="Private notes"
            />
          </div>

          {/* Reset button */}
          <div className="pt-1 flex justify-start">
            <button
              type="button"
              onClick={handleResetDefaults}
              className="px-3 py-1.5 text-xs text-zinc-500 hover:text-white bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded-lg transition-colors flex items-center gap-1.5"
              aria-label="Reset to defaults"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Reset to Defaults</span>
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-zinc-800 bg-zinc-950/50 flex items-center justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 bg-white text-zinc-950 hover:bg-neutral-200 font-medium rounded-xl transition-colors text-xs shadow-sm"
            aria-label="Done"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};