/**
 * scryptChat Studio Sound Engine
 * 
 * High-fidelity, crystal-clear, pleasant chimes, acoustic tones, and smooth harmonic ringtones
 * synthesized in real-time via Web Audio API. Zero harsh glitches.
 */

export type RingtoneType =
  | 'crystal_pulse'
  | 'harmonic_ring'
  | 'zen_chime'
  | 'subtle_orbit'
  | 'gentle_bell'
  | 'cyber_pulse'
  | 'neon_hologram'
  | 'sub_quantum'
  | 'cyber_alert'
  | 'neon_synth';

export type MessageSoundType =
  | 'crystal_glass'
  | 'soft_marimba'
  | 'zen_drop'
  | 'subtle_pop'
  | 'stellar_chime'
  | 'gentle_bell'
  | 'neural_ping'
  | 'quantum_chime'
  | 'cyber_glitch'
  | 'glitch_ping'
  | 'laser_blip'
  | 'sub_thud'
  | 'matrix_chime';

export interface SoundSettings {
  soundEnabled: boolean;
  masterVolume: number; // 0.0 to 1.0
  volume?: number;
  ringtone: RingtoneType;
  ringtonePreset?: RingtoneType;
  messageSound: MessageSoundType;
  notificationPreset?: MessageSoundType;
  audioPreset: 'opus_hd' | 'standard' | 'eco';
  videoQuality: '1080p' | '720p' | '480p';
  noiseSuppression: boolean;
  echoCancellation: boolean;
  autoGainControl: boolean;
  studioVoiceGate?: boolean;
}

const DEFAULT_SETTINGS: SoundSettings = {
  soundEnabled: true,
  masterVolume: 0.75,
  volume: 0.75,
  ringtone: 'crystal_pulse',
  ringtonePreset: 'crystal_pulse',
  messageSound: 'crystal_glass',
  notificationPreset: 'crystal_glass',
  audioPreset: 'opus_hd',
  videoQuality: '1080p',
  noiseSuppression: true,
  echoCancellation: true,
  autoGainControl: true,
  studioVoiceGate: true,
};

const STORAGE_KEY = 'scryptchat_audio_settings';

export function getSoundSettings(): SoundSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        ...DEFAULT_SETTINGS,
        ...parsed,
        volume: parsed.volume ?? parsed.masterVolume ?? 0.75,
        masterVolume: parsed.masterVolume ?? parsed.volume ?? 0.75,
        ringtone: parsed.ringtone ?? parsed.ringtonePreset ?? 'crystal_pulse',
        ringtonePreset: parsed.ringtonePreset ?? parsed.ringtone ?? 'crystal_pulse',
        messageSound: parsed.messageSound ?? parsed.notificationPreset ?? 'crystal_glass',
        notificationPreset: parsed.notificationPreset ?? parsed.messageSound ?? 'crystal_glass',
      };
    }
  } catch {}
  return { ...DEFAULT_SETTINGS };
}

export function saveSoundSettings(settings: SoundSettings): void {
  try {
    const vol = settings.volume ?? settings.masterVolume ?? 0.75;
    const ring = settings.ringtonePreset ?? settings.ringtone ?? 'crystal_pulse';
    const msg = settings.notificationPreset ?? settings.messageSound ?? 'crystal_glass';
    const normalized = {
      ...settings,
      masterVolume: vol,
      volume: vol,
      ringtone: ring,
      ringtonePreset: ring,
      messageSound: msg,
      notificationPreset: msg,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  } catch {}
}

class CyberSoundEngine {
  private ctx: AudioContext | null = null;
  private ringInterval: any = null;
  private isRingingActive = false;

  private async getContext(): Promise<AudioContext | null> {
    try {
      if (!this.ctx || this.ctx.state === 'closed') {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioCtx) {
          this.ctx = new AudioCtx();
        }
      }
      if (this.ctx && this.ctx.state === 'suspended') {
        await this.ctx.resume().catch(() => {});
      }
      return this.ctx;
    } catch {
      return null;
    }
  }

  // --- Sound Effects ---

  public async playMessageSound(customSound?: MessageSoundType) {
    const settings = getSoundSettings();
    if (!settings.soundEnabled || settings.masterVolume <= 0) return;

    const ctx = await this.getContext();
    if (!ctx) return;

    const soundType = customSound || settings.messageSound || 'crystal_glass';
    const vol = Math.max(0.1, Math.min(1.0, settings.masterVolume));
    const t = ctx.currentTime + 0.01;

    if (soundType === 'soft_marimba') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(783.99, t);
      osc.frequency.exponentialRampToValueAtTime(392.0, t + 0.15);
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.3 * vol, t + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.3);
    } else if (soundType === 'zen_drop') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, t);
      osc.frequency.exponentialRampToValueAtTime(1760, t + 0.08);
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.25 * vol, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.36);
    } else if (soundType === 'subtle_pop') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(650, t);
      osc.frequency.exponentialRampToValueAtTime(220, t + 0.04);
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.2 * vol, t + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.09);
    } else {
      // Pleasant two-tone crystal glass chime (C6 -> G6)
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();

      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(1046.5, t);
      osc1.frequency.setValueAtTime(1567.98, t + 0.07);

      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(2093.0, t);
      osc2.frequency.setValueAtTime(3135.96, t + 0.07);

      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.28 * vol, t + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(ctx.destination);

      osc1.start(t);
      osc2.start(t);
      osc1.stop(t + 0.46);
      osc2.stop(t + 0.46);
    }
  }

  public async playMessageReceived(preset?: MessageSoundType) {
    return this.playMessageSound(preset);
  }

  public async playSentMessageSound() {
    const settings = getSoundSettings();
    if (!settings.soundEnabled || settings.masterVolume <= 0) return;

    const ctx = await this.getContext();
    if (!ctx) return;

    const vol = Math.max(0.1, settings.masterVolume);
    const t = ctx.currentTime + 0.005;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(1200, t);
    osc.frequency.exponentialRampToValueAtTime(800, t + 0.035);

    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.12 * vol, t + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(t);
    osc.stop(t + 0.07);
  }

  public async playMessageSent() {
    return this.playSentMessageSound();
  }

  public async playActionPing() {
    return this.playSentMessageSound();
  }

  public async startRingtoneLoop(isOutgoing = false) {
    if (this.isRingingActive) return;
    this.isRingingActive = true;

    const playChime = async () => {
      if (!this.isRingingActive) return;
      const ctx = await this.getContext();
      if (!ctx) return;

      const settings = getSoundSettings();
      if (!settings.soundEnabled || settings.masterVolume <= 0) return;
      const vol = Math.max(0.1, settings.masterVolume);

      const t = ctx.currentTime + 0.01;

      if (isOutgoing) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(440, t);
        osc.frequency.setValueAtTime(480, t);

        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(0.12 * vol, t + 0.03);
        gain.gain.setValueAtTime(0.12 * vol, t + 0.6);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.75);
      } else {
        const notes = [523.25, 659.25, 783.99];
        notes.forEach((freq, idx) => {
          const noteTime = t + idx * 0.12;
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();

          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, noteTime);

          gain.gain.setValueAtTime(0, noteTime);
          gain.gain.linearRampToValueAtTime(0.2 * vol, noteTime + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.0001, noteTime + 0.45);

          osc.connect(gain);
          gain.connect(ctx.destination);

          osc.start(noteTime);
          osc.stop(noteTime + 0.5);
        });
      }
    };

    playChime();
    this.ringInterval = setInterval(() => {
      if (!this.isRingingActive) {
        clearInterval(this.ringInterval);
        return;
      }
      playChime();
    }, isOutgoing ? 2500 : 2000);
  }

  public async startIncomingRingtone(ringtonePreset?: RingtoneType) {
    return this.startRingtoneLoop(false);
  }

  public stopRingtoneLoop() {
    this.isRingingActive = false;
    if (this.ringInterval) {
      clearInterval(this.ringInterval);
      this.ringInterval = null;
    }
  }

  public stopRingtone() {
    this.stopRingtoneLoop();
  }

  public async playCallConnected() {
    const ctx = await this.getContext();
    if (!ctx) return;
    const settings = getSoundSettings();
    if (!settings.soundEnabled) return;
    const vol = Math.max(0.1, settings.masterVolume);
    const t = ctx.currentTime + 0.01;

    [880, 1108.73, 1318.51].forEach((freq, idx) => {
      const noteTime = t + idx * 0.08;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, noteTime);
      gain.gain.setValueAtTime(0, noteTime);
      gain.gain.linearRampToValueAtTime(0.2 * vol, noteTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, noteTime + 0.25);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(noteTime);
      osc.stop(noteTime + 0.28);
    });
  }

  public async playCallEnded() {
    const ctx = await this.getContext();
    if (!ctx) return;
    const settings = getSoundSettings();
    if (!settings.soundEnabled) return;
    const vol = Math.max(0.1, settings.masterVolume);
    const t = ctx.currentTime + 0.01;

    [659.25, 523.25].forEach((freq, idx) => {
      const noteTime = t + idx * 0.1;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, noteTime);
      gain.gain.setValueAtTime(0, noteTime);
      gain.gain.linearRampToValueAtTime(0.18 * vol, noteTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, noteTime + 0.3);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(noteTime);
      osc.stop(noteTime + 0.32);
    });
  }

  public async playFileTransferDone() {
    this.playMessageSound('zen_drop');
  }

  public async playSecurityVerified() {
    this.playCallConnected();
  }
}

export const soundEngine = new CyberSoundEngine();
