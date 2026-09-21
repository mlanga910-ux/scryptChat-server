import React, { useEffect, useState } from 'react';
import {
  X,
  Volume2,
  VolumeX,
  Play,
  Square,
  Mic,
  Sliders,
  Check,
  RotateCcw,
} from 'lucide-react';
import {
  getSoundSettings,
  saveSoundSettings,
  soundEngine,
  SoundSettings,
  MessageSoundType,
  RingtoneType,
  MESSAGE_TONES,
  RINGTONE_PRESETS,
} from '../utils/cyberSoundEngine';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  relayStatusText?: string;
  vaultText?: string;
}

type SettingsTab = 'audio' | 'calls';

const TABS: { id: SettingsTab; label: string; hint: string; icon: React.ReactNode }[] = [
  { id: 'audio', label: 'Audio', hint: 'Sounds & volume', icon: <Volume2 className="w-3.5 h-3.5" /> },
  { id: 'calls', label: 'Calls', hint: 'Voice & video', icon: <Mic className="w-3.5 h-3.5" /> },
];

const AUDIO_PRESETS = [
  { id: 'opus_hd', label: 'Studio', hint: '128 kbps' },
  { id: 'standard', label: 'Balanced', hint: '48 kbps' },
  { id: 'eco', label: 'Data saver', hint: '24 kbps' },
] as const;

const VIDEO_PRESETS = [
  { id: '1080p', label: '1080p', hint: 'Full HD' },
  { id: '720p', label: '720p', hint: 'HD' },
  { id: '480p', label: '480p', hint: 'Low data' },
] as const;

/**
 * The settings window itself: custom notification sounds and call quality.
 * Profile and About have their own windows.
 */
export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  relayStatusText,
  vaultText,
}) => {
  const [activeTab, setActiveTab] = useState<SettingsTab>('audio');
  const [settings, setSettings] = useState<SoundSettings>(() => getSoundSettings());
  const [isPlayingRing, setIsPlayingRing] = useState(false);

  useEffect(() => {
    if (isOpen) setSettings(getSoundSettings());
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      soundEngine.stopRingtone();
      setIsPlayingRing(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const updateSetting = <K extends keyof SoundSettings>(key: K, value: SoundSettings[K]) => {
    const updated = { ...settings, [key]: value };
    setSettings(updated);
    saveSoundSettings(updated);
  };

  const previewRingtone = async (ringtone: RingtoneType) => {
    if (isPlayingRing) {
      soundEngine.stopRingtone();
      setIsPlayingRing(false);
      return;
    }
    updateSetting('ringtone', ringtone);
    setIsPlayingRing(true);
    await soundEngine.startIncomingRingtone(ringtone);
  };

  const handleClose = () => {
    soundEngine.stopRingtone();
    setIsPlayingRing(false);
    onClose();
  };

  const resetAudio = () => {
    const defaults: SoundSettings = {
      ...settings,
      soundEnabled: true,
      masterVolume: 0.75,
      volume: 0.75,
      messageSound: 'crystal_glass',
      notificationPreset: 'crystal_glass',
      ringtone: 'crystal_pulse',
      ringtonePreset: 'crystal_pulse',
      studioVoiceGate: true,
      audioPreset: 'opus_hd',
      videoQuality: '1080p',
    };
    setSettings(defaults);
    saveSoundSettings(defaults);
  };

  const sectionLabel = 'block text-[11px] font-semibold uppercase tracking-wider text-zinc-500 mb-2';
  const segmented = (active: boolean) =>
    `px-2.5 py-2 rounded-xl text-center transition-colors cursor-pointer border ${
      active
        ? 'border-transparent bg-[var(--sc-accent)] text-[var(--sc-on-accent)] font-semibold'
        : 'border-zinc-800 bg-zinc-950/40 text-zinc-400 hover:text-white'
    }`;
  const switchBase =
    'w-10 h-6 rounded-full transition-colors relative flex items-center p-0.5 shrink-0 cursor-pointer';

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 select-none font-sans text-xs animate-in fade-in duration-150">
      <div className="w-full max-w-md h-[min(600px,92vh)] panel-surface border border-zinc-800 rounded-3xl shadow-[var(--sc-shadow-lg)] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="shrink-0 px-4 py-3.5 flex items-center gap-3 border-b border-zinc-800">
          <div className="grid place-items-center h-8 w-8 rounded-xl border border-zinc-800 bg-zinc-900 text-zinc-300">
            <Sliders className="w-4 h-4" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-white tracking-tight">Settings</h2>
            <p className="text-[10px] text-zinc-500">Sounds, notifications and call quality</p>
          </div>
          <button
            onClick={handleClose}
            className="grid place-items-center h-8 w-8 rounded-full text-zinc-500 hover:text-white hover:bg-zinc-900 transition-colors cursor-pointer"
            aria-label="Close settings"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="shrink-0 px-3 pt-3">
          <div className="grid grid-cols-2 gap-1 p-1 rounded-2xl border border-zinc-800 bg-zinc-950/40">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`sc-lift flex items-center justify-center gap-2 py-2 rounded-xl transition-colors cursor-pointer ${
                  activeTab === tab.id
                    ? 'bg-[var(--sc-accent)] text-[var(--sc-on-accent)] font-semibold'
                    : 'text-zinc-500 hover:text-white'
                }`}
                aria-label={tab.label}
                aria-current={activeTab === tab.id}
              >
                {tab.icon}
                <span className="text-[11px] font-medium">{tab.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Body - keyed by tab so switching panes plays the reveal gesture */}
        <div
          key={activeTab}
          className="sc-reveal flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-4"
        >
          {activeTab === 'audio' && (
            <div className="space-y-4">
              <div className="p-3.5 rounded-2xl border border-zinc-800 bg-zinc-950/40 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-white">Notification sounds</span>
                  <button
                    onClick={() => updateSetting('soundEnabled', !settings.soundEnabled)}
                    className={`${switchBase} ${
                      settings.soundEnabled ? 'bg-[var(--sc-e400)]' : 'bg-zinc-800'
                    }`}
                    aria-label="Toggle notification sounds"
                    aria-pressed={settings.soundEnabled}
                  >
                    <span
                      className={`w-5 h-5 rounded-full bg-zinc-950 shadow transition-transform ${
                        settings.soundEnabled ? 'translate-x-4' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
                <div className="flex items-center gap-2.5">
                  <VolumeX className="w-4 h-4 text-zinc-500 shrink-0" />
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={settings.masterVolume ?? 0.75}
                    onChange={(e) => updateSetting('masterVolume', parseFloat(e.target.value))}
                    className="flex-1 h-1.5 rounded-full accent-[var(--sc-e400)] cursor-pointer"
                    aria-label="Volume"
                  />
                  <span className="w-8 text-right text-[11px] tabular-nums text-zinc-500">
                    {Math.round((settings.masterVolume ?? 0.75) * 100)}%
                  </span>
                </div>
              </div>

              <div>
                <span className={sectionLabel}>Message tone</span>
                <div className="grid grid-cols-3 gap-1.5">
                  {MESSAGE_TONES.map((tone) => {
                    const selected = settings.messageSound === tone.id;
                    return (
                      <button
                        key={tone.id}
                        onClick={() => {
                          updateSetting('messageSound', tone.id);
                          void soundEngine.playMessageSound(tone.id);
                        }}
                        className={`flex flex-col items-center gap-1.5 px-2 py-3 rounded-2xl border transition-colors cursor-pointer ${
                          selected
                            ? 'border-[var(--sc-e400)] bg-zinc-900'
                            : 'border-zinc-800 bg-zinc-950/40 hover:border-zinc-700'
                        }`}
                        aria-label={tone.label}
                      >
                        {selected ? (
                          <Check className="w-3.5 h-3.5 text-[var(--sc-e400)]" />
                        ) : (
                          <Volume2 className="w-3.5 h-3.5 text-zinc-500" />
                        )}
                        <span className="text-[11px] font-medium text-white">{tone.label}</span>
                        <span className="text-[10px] text-zinc-500">{tone.desc}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <span className={sectionLabel}>Incoming call ringtone</span>
                <div className="space-y-1.5">
                  {RINGTONE_PRESETS.map((ring) => {
                    const selected = settings.ringtone === ring.id;
                    const playing = isPlayingRing && selected;
                    return (
                      <div
                        key={ring.id}
                        className={`flex items-center justify-between gap-2 px-3 py-2.5 rounded-2xl border transition-colors ${
                          selected
                            ? 'border-[var(--sc-e400)] bg-zinc-900'
                            : 'border-zinc-800 bg-zinc-950/40'
                        }`}
                      >
                        <button
                          onClick={() => updateSetting('ringtone', ring.id)}
                          className="flex-1 min-w-0 text-left cursor-pointer"
                          aria-label={ring.label}
                        >
                          <div className="flex items-center gap-1.5">
                            {selected && (
                              <Check className="w-3.5 h-3.5 text-[var(--sc-e400)] shrink-0" />
                            )}
                            <span className="text-[11px] font-medium text-white">{ring.label}</span>
                          </div>
                          <span className="text-[10px] text-zinc-500">{ring.desc}</span>
                        </button>
                        <button
                          onClick={() => previewRingtone(ring.id)}
                          className={`shrink-0 grid place-items-center h-7 w-7 rounded-full border transition-colors cursor-pointer ${
                            playing
                              ? 'border-transparent bg-rose-500/90 text-white'
                              : 'border-zinc-800 text-zinc-400 hover:text-white hover:border-zinc-700'
                          }`}
                          aria-label={playing ? `Stop ${ring.label}` : `Preview ${ring.label}`}
                        >
                          {playing ? <Square className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

              <button
                onClick={resetAudio}
                className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl border border-zinc-800 text-[11px] text-zinc-500 hover:text-white hover:border-zinc-700 transition-colors cursor-pointer"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Reset sound defaults</span>
              </button>
            </div>
          )}

          {activeTab === 'calls' && (
            <div className="space-y-4">
              <div className="p-3.5 rounded-2xl border border-zinc-800 bg-zinc-950/40 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium text-white">Voice isolation</div>
                  <p className="text-[10px] text-zinc-500 mt-0.5">
                    Echo, noise and gain control while calling
                  </p>
                </div>
                <button
                  onClick={() => updateSetting('studioVoiceGate', !settings.studioVoiceGate)}
                  className={`${switchBase} ${
                    settings.studioVoiceGate ? 'bg-[var(--sc-e400)]' : 'bg-zinc-800'
                  }`}
                  aria-label="Toggle voice isolation"
                  aria-pressed={!!settings.studioVoiceGate}
                >
                  <span
                    className={`w-5 h-5 rounded-full bg-zinc-950 shadow transition-transform ${
                      settings.studioVoiceGate ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              <div>
                <span className={sectionLabel}>Call audio quality</span>
                <div className="grid grid-cols-3 gap-1.5">
                  {AUDIO_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      onClick={() => updateSetting('audioPreset', preset.id)}
                      className={segmented(settings.audioPreset === preset.id)}
                      aria-label={preset.label}
                    >
                      <span className="block text-[11px] font-medium">{preset.label}</span>
                      <span className="block text-[10px] opacity-70">{preset.hint}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <span className={sectionLabel}>Video call quality</span>
                <div className="grid grid-cols-3 gap-1.5">
                  {VIDEO_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      onClick={() => updateSetting('videoQuality', preset.id)}
                      className={segmented(settings.videoQuality === preset.id)}
                      aria-label={preset.label}
                    >
                      <span className="block text-[11px] font-medium">{preset.label}</span>
                      <span className="block text-[10px] opacity-70">{preset.hint}</span>
                    </button>
                  ))}
                </div>
              </div>

              <p className="text-[10px] text-zinc-600 leading-relaxed">
                Calls are peer to peer. On the same network they never leave your LAN.
              </p>
            </div>
          )}
        </div>

        {(relayStatusText || vaultText) && (
          <div className="shrink-0 px-4 py-2.5 border-t border-zinc-800 text-center text-[10px] text-zinc-600 tabular-nums">
            {[relayStatusText, vaultText].filter(Boolean).join(' · ')}
          </div>
        )}
      </div>
    </div>
  );
};
