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
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 select-none font-sans"
    >
      <div className="w-full max-w-xl bg-[#18181b] border border-[#27272a] rounded-2xl shadow-2xl overflow-hidden text-xs flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-[#27272a] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-[#27272a] flex items-center justify-center text-white">
              <Sliders className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">Settings</h2>
              <p className="text-[11px] text-[#a1a1aa]">Configure audio, calls, and device preferences</p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-1.5 text-[#a1a1aa] hover:text-white hover:bg-[#27272a] rounded-lg transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="px-5 pt-3 border-b border-[#27272a] flex items-center gap-2 bg-[#09090b]">
          <button
            onClick={() => {
              soundEngine.stopRingtone();
              setIsPlayingRing(false);
              setActiveTab('audio');
            }}
            className={`pb-2.5 px-2 font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === 'audio'
                ? 'border-white text-white'
                : 'border-transparent text-[#a1a1aa] hover:text-[#e4e4e7]'
            }`}
          >
            <Volume2 className="w-3.5 h-3.5" />
            <span>Audio &amp; Sounds</span>
          </button>

          <button
            onClick={() => {
              soundEngine.stopRingtone();
              setIsPlayingRing(false);
              setActiveTab('calls');
            }}
            className={`pb-2.5 px-2 font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === 'calls'
                ? 'border-white text-white'
                : 'border-transparent text-[#a1a1aa] hover:text-[#e4e4e7]'
            }`}
          >
            <Mic className="w-3.5 h-3.5" />
            <span>Studio Voice &amp; Video</span>
          </button>

          <button
            onClick={() => {
              soundEngine.stopRingtone();
              setIsPlayingRing(false);
              setActiveTab('privacy');
            }}
            className={`pb-2.5 px-2 font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === 'privacy'
                ? 'border-white text-white'
                : 'border-transparent text-[#a1a1aa] hover:text-[#e4e4e7]'
            }`}
          >
            <Shield className="w-3.5 h-3.5" />
            <span>Queue &amp; Privacy</span>
          </button>
        </div>

        {/* Tab Contents */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* TAB 1: AUDIO & SOUNDS */}
          {activeTab === 'audio' && (
            <div className="space-y-4">
              {/* Master Volume & Sound Toggle */}
              <div className="p-4 bg-[#09090b] border border-[#27272a] rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold text-white">Synthesized Audio Effects</h3>
                    <p className="text-[#a1a1aa] text-[11px]">Real-time zero-latency Web Audio sound synthesis</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.soundEnabled}
                      onChange={(e) => updateSetting('soundEnabled', e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-[#27272a] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-[#27272a] after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-600" />
                  </label>
                </div>

                {settings.soundEnabled && (
                  <div className="pt-2 border-t border-[#27272a] flex items-center gap-3">
                    <Volume2 className="w-4 h-4 text-[#a1a1aa]" />
                    <input
                      type="range"
                      min="0.1"
                      max="1"
                      step="0.05"
                      value={settings.masterVolume}
                      onChange={(e) => updateSetting('masterVolume', parseFloat(e.target.value))}
                      className="flex-1 accent-white h-1.5 bg-[#27272a] rounded-lg cursor-pointer"
                    />
                    <span className="font-mono text-white w-10 text-right">
                      {Math.round(settings.masterVolume * 100)}%
                    </span>
                  </div>
                )}
              </div>

              {/* Message Notification Tones */}
              <div className="p-4 bg-[#09090b] border border-[#27272a] rounded-xl space-y-3">
                <div>
                  <h3 className="font-semibold text-white">Message Alert Sound</h3>
                  <p className="text-[#a1a1aa] text-[11px]">Synthesized audio chime played when a message arrives</p>
                </div>

                <div className="space-y-1.5">
                  {MESSAGE_SOUNDS.map((item) => {
                    const isSelected = (settings.messageSound || 'neural_ping') === item.id;
                    const isTesting = activeTestTone === item.id;
                    return (
                      <div
                        key={item.id}
                        onClick={() => updateSetting('messageSound', item.id)}
                        className={`p-2.5 rounded-xl border flex items-center justify-between cursor-pointer transition-all ${
                          isSelected
                            ? 'bg-[#27272a] border-white text-white'
                            : 'bg-[#18181b] border-[#27272a] text-[#e4e4e7] hover:border-[#3f3f46]'
                        }`}
                      >
                        <div className="min-w-0 pr-2">
                          <div className="font-medium flex items-center gap-1.5">
                            <span>{item.label}</span>
                            {isSelected && <Check className="w-3.5 h-3.5 text-emerald-400" />}
                          </div>
                          <p className="text-[10.5px] text-[#a1a1aa] truncate">{item.desc}</p>
                        </div>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleTestMessageTone(item.id);
                          }}
                          className="px-2.5 py-1 bg-white hover:bg-neutral-200 text-black font-medium rounded-lg text-[11px] flex items-center gap-1 shadow-sm transition-colors flex-shrink-0"
                          title="Play Test Sound"
                        >
                          <Play className={`w-3 h-3 ${isTesting ? 'animate-spin' : ''}`} />
                          <span>Test</span>
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Call Ringtone Presets */}
              <div className="p-4 bg-[#09090b] border border-[#27272a] rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold text-white">Incoming Call Ringtone</h3>
                    <p className="text-[#a1a1aa] text-[11px]">Continuous synthesized melodic tone for incoming calls</p>
                  </div>
                  {isPlayingRing && (
                    <button
                      type="button"
                      onClick={() => handleToggleRingtoneTest(settings.ringtone)}
                      className="px-3 py-1 bg-red-600 hover:bg-red-500 text-white rounded-lg font-medium flex items-center gap-1 text-[11px]"
                    >
                      <Square className="w-3 h-3" />
                      <span>Stop</span>
                    </button>
                  )}
                </div>

                <div className="space-y-1.5">
                  {RINGTONES.map((item) => {
                    const isSelected = (settings.ringtone || 'cyber_pulse') === item.id;
                    return (
                      <div
                        key={item.id}
                        onClick={() => updateSetting('ringtone', item.id)}
                        className={`p-2.5 rounded-xl border flex items-center justify-between cursor-pointer transition-all ${
                          isSelected
                            ? 'bg-[#27272a] border-white text-white'
                            : 'bg-[#18181b] border-[#27272a] text-[#e4e4e7] hover:border-[#3f3f46]'
                        }`}
                      >
                        <div className="min-w-0 pr-2">
                          <div className="font-medium flex items-center gap-1.5">
                            <span>{item.label}</span>
                            {isSelected && <Check className="w-3.5 h-3.5 text-emerald-400" />}
                          </div>
                          <p className="text-[10.5px] text-[#a1a1aa] truncate">{item.desc}</p>
                        </div>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggleRingtoneTest(item.id);
                          }}
                          className="px-2.5 py-1 bg-white hover:bg-neutral-200 text-black font-medium rounded-lg text-[11px] flex items-center gap-1 shadow-sm transition-colors flex-shrink-0"
                        >
                          <Play className="w-3 h-3" />
                          <span>Test</span>
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: CALLS & VOICE CLARITY */}
          {activeTab === 'calls' && (
            <div className="space-y-4">
              {/* Studio Voice Gate & Noise Suppression */}
              <div className="p-4 bg-[#09090b] border border-[#27272a] rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <div className="pr-4">
                    <div className="flex items-center gap-1.5">
                      <h3 className="font-semibold text-white">Studio Voice Clarity &amp; Noise Gate</h3>
                      <span className="px-1.5 py-0.5 bg-emerald-950/60 border border-emerald-800 text-emerald-400 text-[10px] rounded font-medium">
                        Active DSP
                      </span>
                    </div>
                    <p className="text-[#a1a1aa] text-[11px] mt-0.5">
                      Eliminates low-end rumble (85Hz filter), electrical humming, and background noise. Keeps only crisp, clean human speech.
                    </p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer flex-shrink-0">
                    <input
                      type="checkbox"
                      checked={settings.studioVoiceGate ?? true}
                      onChange={(e) => updateSetting('studioVoiceGate', e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-[#27272a] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-[#27272a] after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-600" />
                  </label>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-2 border-t border-[#27272a]">
                  <label className="p-2.5 bg-[#18181b] border border-[#27272a] rounded-lg flex items-center justify-between cursor-pointer">
                    <span className="text-white">Echo Cancellation</span>
                    <input
                      type="checkbox"
                      checked={settings.echoCancellation}
                      onChange={(e) => updateSetting('echoCancellation', e.target.checked)}
                      className="accent-white"
                    />
                  </label>
                  <label className="p-2.5 bg-[#18181b] border border-[#27272a] rounded-lg flex items-center justify-between cursor-pointer">
                    <span className="text-white">Noise Suppression</span>
                    <input
                      type="checkbox"
                      checked={settings.noiseSuppression}
                      onChange={(e) => updateSetting('noiseSuppression', e.target.checked)}
                      className="accent-white"
                    />
                  </label>
                  <label className="p-2.5 bg-[#18181b] border border-[#27272a] rounded-lg flex items-center justify-between cursor-pointer">
                    <span className="text-white">Auto Gain Control</span>
                    <input
                      type="checkbox"
                      checked={settings.autoGainControl}
                      onChange={(e) => updateSetting('autoGainControl', e.target.checked)}
                      className="accent-white"
                    />
                  </label>
                </div>
              </div>

              {/* Opus Studio Codec & Video Quality */}
              <div className="p-4 bg-[#09090b] border border-[#27272a] rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold text-white">Audio Codec Profile</h3>
                    <p className="text-[#a1a1aa] text-[11px]">Opus 48kHz with 128kbps stereo stream &amp; In-Band Forward Error Correction</p>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: 'opus_hd', label: 'Opus HD (48kHz)', desc: 'Broadcast quality' },
                    { id: 'standard', label: 'Standard (44.1kHz)', desc: 'Balanced' },
                    { id: 'eco', label: 'Eco Bandwidth', desc: 'Low network usage' },
                  ].map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => updateSetting('audioPreset', item.id as any)}
                      className={`p-2.5 rounded-xl border text-left transition-all ${
                        settings.audioPreset === item.id
                          ? 'bg-[#27272a] border-white text-white'
                          : 'bg-[#18181b] border-[#27272a] text-[#a1a1aa] hover:border-[#3f3f46]'
                      }`}
                    >
                      <div className="font-medium text-white text-xs">{item.label}</div>
                      <div className="text-[10px] text-[#71717a]">{item.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Video Resolution */}
              <div className="p-4 bg-[#09090b] border border-[#27272a] rounded-xl space-y-3">
                <div>
                  <h3 className="font-semibold text-white">Video Call Resolution</h3>
                  <p className="text-[#a1a1aa] text-[11px]">Target capture and transmission resolution for video calls</p>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: '1080p', label: '1080p Full HD', desc: '60 FPS Ultra HD' },
                    { id: '720p', label: '720p HD', desc: '30 FPS Crisp' },
                    { id: '480p', label: '480p SD', desc: '24 FPS Efficient' },
                  ].map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => updateSetting('videoQuality', item.id as any)}
                      className={`p-2.5 rounded-xl border text-left transition-all ${
                        settings.videoQuality === item.id
                          ? 'bg-[#27272a] border-white text-white'
                          : 'bg-[#18181b] border-[#27272a] text-[#a1a1aa] hover:border-[#3f3f46]'
                      }`}
                    >
                      <div className="font-medium text-white text-xs">{item.label}</div>
                      <div className="text-[10px] text-[#71717a]">{item.desc}</div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: QUEUE & PRIVACY */}
          {activeTab === 'privacy' && (
            <div className="space-y-4">
              {/* Offline Outbox Queue */}
              <div className="p-4 bg-[#09090b] border border-[#27272a] rounded-xl space-y-2">
                <h3 className="font-semibold text-white">Offline Outbox Auto-Delivery</h3>
                <p className="text-[#a1a1aa] text-[11px] leading-relaxed">
                  Messages and files sent to offline contacts are safely stored in your local IndexedDB queue without uploading binary payloads to the signaling server. When the peer reconnects online, queued items are automatically transmitted directly over peer-to-peer WebRTC!
                </p>
                <div className="flex items-center gap-2 pt-2 text-[11px] text-emerald-400 font-medium">
                  <Check className="w-3.5 h-3.5" />
                  <span>Zero-relay storage bloat • 100% Peer-to-Peer</span>
                </div>
              </div>

              {/* Signaling & Network Info */}
              <div className="p-4 bg-[#09090b] border border-[#27272a] rounded-xl space-y-2.5">
                <h3 className="font-semibold text-white">Signaling Network Status</h3>
                <div className="flex items-center justify-between text-xs pt-1">
                  <span className="text-[#a1a1aa]">Relay Server</span>
                  <span className="font-medium text-emerald-400 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-400" />
                    {relayStatus}
                  </span>
                </div>
                {relayPingMs !== null && relayPingMs !== undefined && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[#a1a1aa]">Signaling RTT Latency</span>
                    <span className="font-mono text-white">{relayPingMs} ms</span>
                  </div>
                )}
              </div>

              {/* Reset Defaults */}
              <div className="pt-2">
                <button
                  type="button"
                  onClick={handleResetDefaults}
                  className="px-3 py-2 text-xs text-[#a1a1aa] hover:text-white bg-[#18181b] hover:bg-[#27272a] border border-[#27272a] rounded-xl transition-colors flex items-center gap-1.5"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Reset All Settings to Defaults</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-[#27272a] bg-[#09090b] flex items-center justify-end">
          <button
            type="button"
            onClick={handleClose}
            className="px-5 py-2 bg-white text-black hover:bg-neutral-200 font-medium rounded-xl transition-colors text-xs shadow-sm"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
