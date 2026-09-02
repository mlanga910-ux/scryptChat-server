import React, { useState } from 'react';
import {
  X,
  Volume2,
  VolumeX,
  Play,
  Square,
  Mic,
  Video,
  Shield,
  Radio,
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
} from '../utils/cyberSoundEngine';
import { RelayStatus } from '../types/index';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  relayStatus: RelayStatus;
  relayPingMs?: number | null;
}

const MESSAGE_SOUNDS: { id: MessageSoundType; label: string; desc: string }[] = [
  { id: 'neural_ping', label: 'Neural Ping', desc: 'Harmonic sine chirp with rapid exponential decay' },
  { id: 'quantum_chime', label: 'Quantum Chime', desc: 'Resonant pure glass triad chord' },
  { id: 'cyber_glitch', label: 'Cyber Glitch', desc: 'Frequency-modulated micro flutter' },
  { id: 'glitch_ping', label: 'Glitch Ping', desc: 'Fast FM sawtooth tick' },
  { id: 'laser_blip', label: 'Laser Blip', desc: 'Retro cyber downward blip' },
  { id: 'sub_thud', label: 'Sub Thud', desc: 'Low-frequency punchy transient' },
  { id: 'matrix_chime', label: 'Matrix Chime', desc: 'Multi-harmonic digital sequence' },
];

const RINGTONES: { id: RingtoneType; label: string; desc: string }[] = [
  { id: 'cyber_pulse', label: 'Cyber Pulse', desc: 'Arpeggiated high-frequency pulse' },
  { id: 'neon_hologram', label: 'Neon Hologram', desc: 'Futuristic warm dual-chord progression' },
  { id: 'sub_quantum', label: 'Sub-Quantum', desc: 'Deep bass pulse with high harmonic resonance' },
  { id: 'cyber_alert', label: 'Cyber Alert', desc: 'High urgency dual-tone burst' },
  { id: 'neon_synth', label: 'Neon Synth', desc: 'Smooth synth chord swell' },
];

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  relayStatus,
  relayPingMs,
}) => {
  if (!isOpen) return null;

  const [activeTab, setActiveTab] = useState<'audio' | 'calls' | 'privacy'>('audio');
  const [settings, setSettings] = useState<SoundSettings>(getSoundSettings());
  const [isPlayingRing, setIsPlayingRing] = useState(false);
  const [activeTestTone, setActiveTestTone] = useState<string | null>(null);

  const updateSetting = <K extends keyof SoundSettings>(key: K, value: SoundSettings[K]) => {
    const updated = { ...settings, [key]: value };
    setSettings(updated);
    saveSoundSettings(updated);
  };

  const handleTestMessageTone = async (soundId: MessageSoundType) => {
    setActiveTestTone(soundId);
    await soundEngine.playMessageSound(soundId);
    setTimeout(() => setActiveTestTone(null), 500);
  };

  const handleToggleRingtoneTest = async (ringId: RingtoneType) => {
    if (isPlayingRing) {
      soundEngine.stopRingtone();
      setIsPlayingRing(false);
    } else {
      setIsPlayingRing(true);
      await soundEngine.startIncomingRingtone(ringId);
    }
  };

  const handleClose = () => {
    soundEngine.stopRingtone();
    setIsPlayingRing(false);
    onClose();
  };

  const handleResetDefaults = () => {
    const defaultSettings: SoundSettings = {
      soundEnabled: true,
      masterVolume: 0.85,
      volume: 0.85,
      ringtone: 'cyber_pulse',
      ringtonePreset: 'cyber_pulse',
      messageSound: 'neural_ping',
      notificationPreset: 'neural_ping',
      audioPreset: 'opus_hd',
      videoQuality: '1080p',
      noiseSuppression: true,
      echoCancellation: true,
      autoGainControl: true,
      studioVoiceGate: true,
    };
    setSettings(defaultSettings);
    saveSoundSettings(defaultSettings);
  };

  return (
    <div
      id="settings-modal-backdrop"
      className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 select-none font-sans text-xs animate-in fade-in duration-150"
    >
      <div className="w-full max-w-xl h-[620px] max-h-[92vh] bg-[#0c0c0e] border border-[#27272a] rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-[#1f1f23] bg-[#09090b] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#18181b] border border-[#27272a] flex items-center justify-center text-white">
              <Sliders className="w-4 h-4 text-white" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white tracking-tight">
                Settings
              </h3>
              <p className="text-[11px] text-[#71717a]">
                Audio synthesis, call studio quality, and network preferences
              </p>
            </div>
          </div>
          <button
            id="close-settings-modal-btn"
            onClick={handleClose}
            className="p-1.5 text-[#71717a] hover:text-white hover:bg-[#18181b] rounded-lg transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="grid grid-cols-3 border-b border-[#1f1f23] bg-[#09090b] p-1.5 gap-1.5 text-center shrink-0">
          <button
            id="tab-audio-settings"
            onClick={() => setActiveTab('audio')}
            className={`py-2 rounded-xl text-xs font-medium transition-colors flex items-center justify-center gap-1.5 ${
              activeTab === 'audio'
                ? 'bg-[#18181b] text-white border border-[#27272a] font-semibold'
                : 'text-[#71717a] hover:text-white'
            }`}
          >
            <Volume2 className="w-3.5 h-3.5" />
            <span>Audio &amp; Sounds</span>
          </button>
          <button
            id="tab-calls-settings"
            onClick={() => setActiveTab('calls')}
            className={`py-2 rounded-xl text-xs font-medium transition-colors flex items-center justify-center gap-1.5 ${
              activeTab === 'calls'
                ? 'bg-[#18181b] text-white border border-[#27272a] font-semibold'
                : 'text-[#71717a] hover:text-white'
            }`}
          >
            <Mic className="w-3.5 h-3.5" />
            <span>Call &amp; Media</span>
          </button>
          <button
            id="tab-privacy-settings"
            onClick={() => setActiveTab('privacy')}
            className={`py-2 rounded-xl text-xs font-medium transition-colors flex items-center justify-center gap-1.5 ${
              activeTab === 'privacy'
                ? 'bg-[#18181b] text-white border border-[#27272a] font-semibold'
                : 'text-[#71717a] hover:text-white'
            }`}
          >
            <Radio className="w-3.5 h-3.5" />
            <span>Network &amp; Status</span>
          </button>
        </div>

        {/* Modal Body with Fixed Height & Smooth Scroll */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* TAB 1: AUDIO & SOUNDS */}
          {activeTab === 'audio' && (
            <div className="space-y-4">
              {/* Master Volume Toggle */}
              <div className="p-4 bg-[#09090b] border border-[#1f1f23] rounded-xl flex items-center justify-between">
                <div>
                  <div className="font-semibold text-white text-xs">Audio Feedback &amp; Synthesizer</div>
                  <div className="text-[11px] text-[#71717a] mt-0.5">
                    Real-time procedural audio synthesis without external files
                  </div>
                </div>
                <button
                  id="toggle-sound-enabled-btn"
                  onClick={() => updateSetting('soundEnabled', !settings.soundEnabled)}
                  className={`w-11 h-6 rounded-full transition-colors relative flex items-center p-0.5 ${
                    settings.soundEnabled ? 'bg-white' : 'bg-[#27272a]'
                  }`}
                >
                  <div
                    className={`w-5 h-5 rounded-full bg-black shadow-md transition-transform ${
                      settings.soundEnabled ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {/* Volume Slider */}
              <div className="p-4 bg-[#09090b] border border-[#1f1f23] rounded-xl space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-white text-xs">Master Volume</span>
                  <span className="font-mono text-[11px] text-[#71717a]">
                    {Math.round((settings.masterVolume || 0.85) * 100)}%
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <VolumeX className="w-4 h-4 text-[#71717a]" />
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={settings.masterVolume ?? 0.85}
                    onChange={(e) => updateSetting('masterVolume', parseFloat(e.target.value))}
                    className="flex-1 accent-white h-1.5 bg-[#27272a] rounded-lg appearance-none cursor-pointer"
                  />
                  <Volume2 className="w-4 h-4 text-white" />
                </div>
              </div>

              {/* Message Sound Presets */}
              <div className="space-y-2">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-[#a1a1aa] block">
                  Message Notification Tones
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {MESSAGE_SOUNDS.map((sound) => {
                    const isSelected = settings.messageSound === sound.id;
                    const isTesting = activeTestTone === sound.id;
                    return (
                      <div
                        key={sound.id}
                        onClick={() => updateSetting('messageSound', sound.id)}
                        className={`p-3 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-2 ${
                          isSelected
                            ? 'bg-[#18181b] border-white/40 text-white shadow-sm'
                            : 'bg-[#09090b] border-[#1f1f23] text-[#a1a1aa] hover:border-[#27272a] hover:text-white'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="font-semibold text-xs text-white truncate flex items-center gap-1.5">
                            {isSelected && <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />}
                            <span>{sound.label}</span>
                          </div>
                          <div className="text-[10px] text-[#71717a] truncate mt-0.5">{sound.desc}</div>
                        </div>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleTestMessageTone(sound.id);
                          }}
                          className={`p-2 rounded-lg transition-colors shrink-0 ${
                            isTesting
                              ? 'bg-emerald-500 text-black'
                              : 'bg-[#18181b] text-white hover:bg-[#27272a]'
                          }`}
                          title="Test tone"
                        >
                          <Play className="w-3 h-3" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Ringtone Presets */}
              <div className="space-y-2">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-[#a1a1aa] block">
                  Incoming Call Ringtones
                </label>
                <div className="space-y-2">
                  {RINGTONES.map((ring) => {
                    const isSelected = settings.ringtone === ring.id;
                    const isTestingThis = isPlayingRing && isSelected;
                    return (
                      <div
                        key={ring.id}
                        onClick={() => updateSetting('ringtone', ring.id)}
                        className={`p-3 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-2 ${
                          isSelected
                            ? 'bg-[#18181b] border-white/40 text-white shadow-sm'
                            : 'bg-[#09090b] border-[#1f1f23] text-[#a1a1aa] hover:border-[#27272a] hover:text-white'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="font-semibold text-xs text-white truncate flex items-center gap-1.5">
                            {isSelected && <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />}
                            <span>{ring.label}</span>
                          </div>
                          <div className="text-[10px] text-[#71717a] truncate mt-0.5">{ring.desc}</div>
                        </div>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            updateSetting('ringtone', ring.id);
                            handleToggleRingtoneTest(ring.id);
                          }}
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors shrink-0 ${
                            isTestingThis
                              ? 'bg-rose-600 text-white animate-pulse'
                              : 'bg-[#18181b] text-white hover:bg-[#27272a]'
                          }`}
                        >
                          {isTestingThis ? <Square className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                          <span>{isTestingThis ? 'Stop' : 'Test'}</span>
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: CALL & MEDIA STUDIO QUALITY */}
          {activeTab === 'calls' && (
            <div className="space-y-4">
              {/* Studio Voice Engine */}
              <div className="p-4 bg-[#09090b] border border-[#1f1f23] rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-semibold text-white text-xs">Studio Voice &amp; Noise Isolation</div>
                    <div className="text-[11px] text-[#71717a] mt-0.5">
                      DSP dynamic voice gate &amp; active background noise filtering
                    </div>
                  </div>
                  <button
                    onClick={() => updateSetting('studioVoiceGate', !settings.studioVoiceGate)}
                    className={`w-11 h-6 rounded-full transition-colors relative flex items-center p-0.5 ${
                      settings.studioVoiceGate ? 'bg-emerald-500' : 'bg-[#27272a]'
                    }`}
                  >
                    <div
                      className={`w-5 h-5 rounded-full bg-black shadow-md transition-transform ${
                        settings.studioVoiceGate ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-2 pt-1 border-t border-[#1f1f23]">
                  <div className="flex items-center justify-between p-2 bg-[#141418] rounded-lg">
                    <span className="text-[10px] text-[#a1a1aa]">Echo Cancellation</span>
                    <span className="text-emerald-400 font-bold text-[10px]">ON</span>
                  </div>
                  <div className="flex items-center justify-between p-2 bg-[#141418] rounded-lg">
                    <span className="text-[10px] text-[#a1a1aa]">Noise Suppression</span>
                    <span className="text-emerald-400 font-bold text-[10px]">ON</span>
                  </div>
                  <div className="flex items-center justify-between p-2 bg-[#141418] rounded-lg">
                    <span className="text-[10px] text-[#a1a1aa]">Auto Gain Control</span>
                    <span className="text-emerald-400 font-bold text-[10px]">ON</span>
                  </div>
                </div>
              </div>

              {/* Audio Fidelity Preset */}
              <div className="space-y-2">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-[#a1a1aa] block">
                  Audio Codec Quality
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: 'opus_hd', label: 'Opus HD Studio', desc: '128 kbps 48kHz Stereo' },
                    { id: 'standard', label: 'Standard Voice', desc: '48 kbps Mono' },
                    { id: 'eco', label: 'Low Bandwidth', desc: '24 kbps Narrow' },
                  ].map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => updateSetting('audioPreset', preset.id as any)}
                      className={`p-3 rounded-xl border text-left transition-all ${
                        settings.audioPreset === preset.id
                          ? 'bg-[#18181b] border-white text-white font-semibold'
                          : 'bg-[#09090b] border-[#1f1f23] text-[#71717a] hover:text-white'
                      }`}
                    >
                      <div className="text-xs font-semibold text-white">{preset.label}</div>
                      <div className="text-[10px] opacity-70 mt-0.5">{preset.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Video Resolution */}
              <div className="space-y-2">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-[#a1a1aa] block">
                  Video Call Resolution
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: '1080p', label: 'Full HD 1080p', desc: '60 fps VP9/H.264' },
                    { id: '720p', label: 'HD 720p', desc: '30 fps Balanced' },
                    { id: '480p', label: 'SD 480p', desc: 'Low Data Usage' },
                  ].map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => updateSetting('videoQuality', v.id as any)}
                      className={`p-3 rounded-xl border text-left transition-all ${
                        settings.videoQuality === v.id
                          ? 'bg-[#18181b] border-white text-white font-semibold'
                          : 'bg-[#09090b] border-[#1f1f23] text-[#71717a] hover:text-white'
                      }`}
                    >
                      <div className="text-xs font-semibold text-white">{v.label}</div>
                      <div className="text-[10px] opacity-70 mt-0.5">{v.desc}</div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: NETWORK & STATUS */}
          {activeTab === 'privacy' && (
            <div className="space-y-4">
              <div className="p-4 bg-[#09090b] border border-[#1f1f23] rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-[#a1a1aa]">Signaling Server Status</span>
                  <div className="flex items-center gap-2">
                    <div
                      className={`w-2 h-2 rounded-full ${
                        relayStatus === 'ONLINE'
                          ? 'bg-emerald-400 animate-pulse'
                          : relayStatus === 'CONNECTING'
                          ? 'bg-amber-400'
                          : 'bg-rose-500'
                      }`}
                    />
                    <span className="font-mono text-xs text-white">{relayStatus}</span>
                  </div>
                </div>

                {relayPingMs !== null && relayPingMs !== undefined && (
                  <div className="flex items-center justify-between pt-2 border-t border-[#1f1f23]">
                    <span className="text-xs text-[#a1a1aa]">Signaling Latency</span>
                    <span className="font-mono text-xs text-emerald-400 font-semibold">
                      {relayPingMs} ms
                    </span>
                  </div>
                )}
              </div>

              <div className="p-4 bg-[#09090b] border border-[#1f1f23] rounded-xl space-y-2">
                <div className="font-medium text-white text-xs">Direct Zero-Knowledge Mesh</div>
                <p className="text-[11px] text-[#71717a] leading-relaxed">
                  All audio, video, and file streams connect directly P2P through WebSockets/WebRTC with AES-256-GCM encryption. The signaling server never decrypts or retains communication keys.
                </p>
              </div>

              <div className="pt-2">
                <button
                  type="button"
                  onClick={handleResetDefaults}
                  className="flex items-center justify-center gap-2 w-full py-2.5 bg-[#18181b] hover:bg-[#27272a] text-white border border-[#27272a] rounded-xl text-xs font-medium transition-colors"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Restore Factory Defaults</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
