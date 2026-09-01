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
  Save,
  Check,
  RotateCcw,
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
  const [isSaved, setIsSaved] = useState(false);

  const updateSetting = <K extends keyof ChatCustomSettings>(
    key: K,
    value: ChatCustomSettings[K]
  ) => {
    const updated = { ...settings, [key]: value };
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
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 select-none font-sans"
    >
      <div className="w-full max-w-md bg-[#18181b] border border-[#27272a] rounded-2xl shadow-2xl overflow-hidden text-xs flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-5 py-4 border-b border-[#27272a] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-white font-medium text-xs shadow-sm"
              style={{ backgroundColor: contact.avatarColor || '#3f3f46' }}
            >
              {contact.alias.charAt(0).toUpperCase()}
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">
                Chat Preferences: {contact.alias}
              </h2>
              <p className="text-[11px] text-[#a1a1aa]">
                Customized local settings for this specific chat
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-[#a1a1aa] hover:text-white hover:bg-[#27272a] rounded-lg transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Privacy Note */}
          <div className="p-3 bg-[#09090b] border border-[#27272a] rounded-xl flex items-start gap-2 text-[#a1a1aa] text-[11px]">
            <Shield className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
            <p>
              These options are stored strictly on your local device. They will not alter or restrict the settings of {contact.alias}&apos;s device.
            </p>
          </div>

          {/* 1. Blur / Hide Images by Default */}
          <div className="p-4 bg-[#09090b] border border-[#27272a] rounded-xl space-y-2">
            <div className="flex items-center justify-between">
              <div className="pr-3">
                <div className="flex items-center gap-1.5 font-medium text-white">
                  <EyeOff className="w-3.5 h-3.5 text-amber-400" />
                  <span>Blur &amp; Hide Images by Default</span>
                </div>
                <p className="text-[#a1a1aa] text-[11px] mt-0.5">
                  When enabled, received photos appear blurred with an eye-off overlay and a &quot;Reveal Image&quot; button.
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer flex-shrink-0">
                <input
                  type="checkbox"
                  checked={settings.blurMedia}
                  onChange={(e) => updateSetting('blurMedia', e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-[#27272a] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-[#27272a] after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-amber-500" />
              </label>
            </div>
          </div>

          {/* 2. Notifications & Mute for this Chat */}
          <div className="p-4 bg-[#09090b] border border-[#27272a] rounded-xl space-y-3">
            <div className="flex items-center justify-between">
              <div className="pr-3">
                <div className="flex items-center gap-1.5 font-medium text-white">
                  {settings.muteNotifications ? (
                    <BellOff className="w-3.5 h-3.5 text-red-400" />
                  ) : (
                    <Bell className="w-3.5 h-3.5 text-white" />
                  )}
                  <span>Mute Notifications</span>
                </div>
                <p className="text-[#a1a1aa] text-[11px] mt-0.5">
                  Silence sound alerts and banner notifications for incoming messages from this contact.
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer flex-shrink-0">
                <input
                  type="checkbox"
                  checked={settings.muteNotifications}
                  onChange={(e) => updateSetting('muteNotifications', e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-[#27272a] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-[#27272a] after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-red-600" />
              </label>
            </div>

            {!settings.muteNotifications && (
              <div className="pt-2 border-t border-[#27272a] space-y-1.5">
                <label className="block text-[#a1a1aa] font-medium text-[11px]">
                  Custom Notification Tone for this Chat
                </label>
                <div className="flex items-center gap-2">
                  <select
                    value={settings.customSound}
                    onChange={(e) => updateSetting('customSound', e.target.value as any)}
                    className="flex-1 bg-[#18181b] border border-[#27272a] rounded-xl px-3 py-2 text-white text-xs focus:outline-none focus:border-white"
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
                    className="px-3 py-2 bg-white hover:bg-neutral-200 text-black font-medium rounded-xl text-xs transition-colors flex-shrink-0 shadow-sm"
                  >
                    Test Tone
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* 3. Auto-Download Media */}
          <div className="p-4 bg-[#09090b] border border-[#27272a] rounded-xl space-y-2">
            <div className="flex items-center justify-between">
              <div className="pr-3">
                <div className="flex items-center gap-1.5 font-medium text-white">
                  <Download className="w-3.5 h-3.5 text-white" />
                  <span>Auto-Download Media Files</span>
                </div>
                <p className="text-[#a1a1aa] text-[11px] mt-0.5">
                  Automatically assemble incoming file chunks and store them in local IndexedDB storage.
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer flex-shrink-0">
                <input
                  type="checkbox"
                  checked={settings.autoDownloadMedia}
                  onChange={(e) => updateSetting('autoDownloadMedia', e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-[#27272a] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-[#27272a] after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-600" />
              </label>
            </div>
          </div>

          {/* 4. Disappearing Messages */}
          <div className="p-4 bg-[#09090b] border border-[#27272a] rounded-xl space-y-2.5">
            <div>
              <div className="flex items-center gap-1.5 font-medium text-white">
                <Clock className="w-3.5 h-3.5 text-white" />
                <span>Disappearing Message Timer</span>
              </div>
              <p className="text-[#a1a1aa] text-[11px] mt-0.5">
                Automatically purge messages older than the selected retention period on this device.
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
                      ? 'bg-white text-black font-semibold'
                      : 'bg-[#18181b] border border-[#27272a] text-[#a1a1aa] hover:text-white'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* 5. Private Notes */}
          <div className="p-4 bg-[#09090b] border border-[#27272a] rounded-xl space-y-2">
            <div className="flex items-center gap-1.5 font-medium text-white">
              <FileText className="w-3.5 h-3.5 text-white" />
              <span>Private Contact Notes</span>
            </div>
            <textarea
              value={settings.privateNotes}
              onChange={(e) => updateSetting('privateNotes', e.target.value)}
              placeholder="Encrypted private notes about this contact (only visible to you)..."
              rows={2}
              className="w-full bg-[#18181b] border border-[#27272a] rounded-xl p-2.5 text-white text-xs placeholder-[#52525b] focus:outline-none focus:border-white resize-none"
            />
          </div>

          {/* Reset button */}
          <div className="pt-1 flex justify-start">
            <button
              type="button"
              onClick={handleResetDefaults}
              className="px-3 py-1.5 text-xs text-[#a1a1aa] hover:text-white bg-[#09090b] hover:bg-[#27272a] border border-[#27272a] rounded-lg transition-colors flex items-center gap-1.5"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Reset to Defaults</span>
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-[#27272a] bg-[#09090b] flex items-center justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 bg-white text-black hover:bg-neutral-200 font-medium rounded-xl transition-colors text-xs shadow-sm"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
