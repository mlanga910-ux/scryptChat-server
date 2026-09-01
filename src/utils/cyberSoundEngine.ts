/**
 * scryptChat High-Fidelity Cyberpunk Web Audio Synthesizer
 * 
 * Zero external audio assets required. All audio synthesis is computed in real-time
 * with crystal clear 48kHz stereo fidelity, zero network latency, and custom cyberpunk timbres.
 */

export type RingtoneType =
  | 'cyber_pulse'
  | 'neon_hologram'
  | 'sub_quantum'
  | 'neural_ping'
  | 'quantum_chime'
  | 'cyber_alert'
  | 'neon_synth';

export type MessageSoundType =
  | 'neural_ping'
  | 'cyber_glitch'
  | 'quantum_chime'
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

const STORAGE_KEY = 'scryptchat_audio_settings';

export function getSoundSettings(): SoundSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        ...DEFAULT_SETTINGS,
        ...parsed,
        volume: parsed.volume ?? parsed.masterVolume ?? 0.85,
        masterVolume: parsed.masterVolume ?? parsed.volume ?? 0.85,
        ringtone: parsed.ringtone ?? parsed.ringtonePreset ?? 'cyber_pulse',
        ringtonePreset: parsed.ringtonePreset ?? parsed.ringtone ?? 'cyber_pulse',
        messageSound: parsed.messageSound ?? parsed.notificationPreset ?? 'neural_ping',
        notificationPreset: parsed.notificationPreset ?? parsed.messageSound ?? 'neural_ping',
      };
    }
  } catch {}
  return { ...DEFAULT_SETTINGS };
}

export function saveSoundSettings(settings: SoundSettings): void {
  try {
    const vol = settings.volume ?? settings.masterVolume ?? 0.85;
    const ring = settings.ringtonePreset ?? settings.ringtone ?? 'cyber_pulse';
    const msg = settings.notificationPreset ?? settings.messageSound ?? 'neural_ping';
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
  private ringtoneInterval: any = null;
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

  /**
   * Incoming message notification ping
   */
  public async playMessageSound(customSound?: MessageSoundType) {
    const settings = getSoundSettings();
    if (!settings.soundEnabled || settings.masterVolume <= 0) return;

    const ctx = await this.getContext();
    if (!ctx) return;

    const soundType = customSound || settings.messageSound || 'neural_ping';
    const vol = Math.max(0.1, settings.masterVolume);
    const t = ctx.currentTime + 0.01;

    if (soundType === 'neural_ping') {
      // Crisp cyber harmonic ping
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();

      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(880, t);
      osc1.frequency.exponentialRampToValueAtTime(1760, t + 0.08);

      osc2.type = 'triangle';
      osc2.frequency.setValueAtTime(1320, t);
      osc2.frequency.exponentialRampToValueAtTime(2640, t + 0.08);

      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.35 * vol, t + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.38);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(ctx.destination);

      osc1.start(t);
      osc2.start(t);
      osc1.stop(t + 0.4);
      osc2.stop(t + 0.4);
    } else if (soundType === 'cyber_glitch' || soundType === 'glitch_ping') {
      // Micro FM frequency flutter
      const carrier = ctx.createOscillator();
      const mod = ctx.createOscillator();
      const modGain = ctx.createGain();
      const mainGain = ctx.createGain();

      carrier.type = 'sawtooth';
      carrier.frequency.setValueAtTime(740, t);
      carrier.frequency.exponentialRampToValueAtTime(1480, t + 0.06);

      mod.type = 'square';
      mod.frequency.setValueAtTime(160, t);
      modGain.gain.setValueAtTime(240, t);

      mod.connect(carrier.frequency);

      mainGain.gain.setValueAtTime(0, t);
      mainGain.gain.linearRampToValueAtTime(0.25 * vol, t + 0.01);
      mainGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);

      carrier.connect(mainGain);
      mainGain.connect(ctx.destination);

      carrier.start(t);
      mod.start(t);
      carrier.stop(t + 0.3);
      mod.stop(t + 0.3);
    } else if (soundType === 'laser_blip') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(2200, t);
      osc.frequency.exponentialRampToValueAtTime(320, t + 0.12);

      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.3 * vol, t + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(t);
      osc.stop(t + 0.22);
    } else if (soundType === 'sub_thud') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(220, t);
      osc.frequency.exponentialRampToValueAtTime(55, t + 0.25);

      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.4 * vol, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(t);
      osc.stop(t + 0.36);
    } else if (soundType === 'matrix_chime') {
      const notes = [880, 1174.66, 1760, 2093];
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const start = t + idx * 0.035;

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, start);

        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(0.2 * vol, start + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.3);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(start);
        osc.stop(start + 0.32);
      });
    } else {
      // Quantum Chime: pure glass resonance (C6, E6, G6)
      const notes = [1046.5, 1318.51, 1567.98];
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const start = t + idx * 0.045;

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, start);

        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime((0.28 / (idx + 1)) * vol, start + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.45);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(start);
        osc.stop(start + 0.46);
      });
    }
  }

  /**
   * Sent message blip
   */
  public async playMessageSent() {
    const settings = getSoundSettings();
    if (!settings.soundEnabled || settings.masterVolume <= 0) return;

    const ctx = await this.getContext();
    if (!ctx) return;

    const t = ctx.currentTime + 0.005;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(1046.5, t);
    osc.frequency.exponentialRampToValueAtTime(1567.98, t + 0.04);

    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.18 * settings.masterVolume, t + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(t);
    osc.stop(t + 0.1);
  }

  /**
   * Outgoing calling audio tone (cyber radar pulse)
   */
  public async startOutgoingRing() {
    this.stopRingtone();
    const settings = getSoundSettings();
    if (!settings.soundEnabled || settings.masterVolume <= 0) return;

    this.isRingingActive = true;
    const pulse = async () => {
      if (!this.isRingingActive) return;
      const ctx = await this.getContext();
      if (!ctx) return;

      const t = ctx.currentTime + 0.01;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(480, t);
      osc.frequency.linearRampToValueAtTime(540, t + 0.4);

      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.15 * settings.masterVolume, t + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.65);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(t);
      osc.stop(t + 0.7);
    };

    await pulse();
    this.ringtoneInterval = setInterval(pulse, 2400);
  }

  /**
   * Incoming call ringtone loop
   */
  public async startIncomingRingtone(customRingtone?: RingtoneType) {
    this.stopRingtone();
    const settings = getSoundSettings();
    if (!settings.soundEnabled || settings.masterVolume <= 0) return;

    const ringType = customRingtone || settings.ringtone || 'cyber_pulse';
    const vol = Math.max(0.1, settings.masterVolume);
    this.isRingingActive = true;

    const ringPattern = async () => {
      if (!this.isRingingActive) return;
      const ctx = await this.getContext();
      if (!ctx) return;

      const t = ctx.currentTime + 0.01;

      if (ringType === 'cyber_pulse') {
        // High-tech arpeggio pattern [A5, C6, E6, G6, A6]
        const freqs = [880, 1046.5, 1318.5, 1567.98, 1760];
        freqs.forEach((freq, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          const noteTime = t + idx * 0.085;

          osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(freq, noteTime);

          gain.gain.setValueAtTime(0, noteTime);
          gain.gain.linearRampToValueAtTime(0.22 * vol, noteTime + 0.01);
          gain.gain.exponentialRampToValueAtTime(0.0001, noteTime + 0.24);

          osc.connect(gain);
          gain.connect(ctx.destination);

          osc.start(noteTime);
          osc.stop(noteTime + 0.25);
        });
      } else if (ringType === 'neon_hologram' || ringType === 'neon_synth') {
        // Futuristic dual-chord swell
        const chords = [
          [523.25, 659.25, 783.99, 1046.5], // C Major 7th
          [587.33, 739.99, 880.0, 1174.66], // D Major 7th
        ];
        chords.forEach((chord, chordIdx) => {
          chord.forEach((freq) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            const start = t + chordIdx * 0.35;

            osc.type = 'triangle';
            osc.frequency.setValueAtTime(freq, start);

            gain.gain.setValueAtTime(0, start);
            gain.gain.linearRampToValueAtTime(0.12 * vol, start + 0.04);
            gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.55);

            osc.connect(gain);
            gain.connect(ctx.destination);

            osc.start(start);
            osc.stop(start + 0.58);
          });
        });
      } else if (ringType === 'cyber_alert') {
        const notes = [1200, 1600, 1200, 1600];
        notes.forEach((freq, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          const noteTime = t + idx * 0.12;

          osc.type = 'square';
          osc.frequency.setValueAtTime(freq, noteTime);

          gain.gain.setValueAtTime(0, noteTime);
          gain.gain.linearRampToValueAtTime(0.18 * vol, noteTime + 0.01);
          gain.gain.exponentialRampToValueAtTime(0.0001, noteTime + 0.1);

          osc.connect(gain);
          gain.connect(ctx.destination);

          osc.start(noteTime);
          osc.stop(noteTime + 0.11);
        });
      } else {
        // Sub-Quantum / Neural Ping: Bass pulse with harmonic
        const oscLow = ctx.createOscillator();
        const oscHigh = ctx.createOscillator();
        const gain = ctx.createGain();

        oscLow.type = 'sine';
        oscLow.frequency.setValueAtTime(180, t);
        oscLow.frequency.exponentialRampToValueAtTime(90, t + 0.6);

        oscHigh.type = 'sine';
        oscHigh.frequency.setValueAtTime(1320, t);
        oscHigh.frequency.exponentialRampToValueAtTime(660, t + 0.6);

        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(0.3 * vol, t + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.75);

        oscLow.connect(gain);
        oscHigh.connect(gain);
        gain.connect(ctx.destination);

        oscLow.start(t);
        oscHigh.start(t);
        oscLow.stop(t + 0.78);
        oscHigh.stop(t + 0.78);
      }
    };

    await ringPattern();
    this.ringtoneInterval = setInterval(ringPattern, 2200);
  }

  public stopRingtone() {
    this.isRingingActive = false;
    if (this.ringtoneInterval) {
      clearInterval(this.ringtoneInterval);
      this.ringtoneInterval = null;
    }
  }

  /**
   * Preview a ringtone sound once for testing in Settings
   */
  public async previewRingtone(ringType: RingtoneType) {
    await this.startIncomingRingtone(ringType);
    setTimeout(() => {
      this.stopRingtone();
    }, 2000);
  }

  /**
   * Call connected chime
   */
  public async playCallConnected() {
    const settings = getSoundSettings();
    if (!settings.soundEnabled || settings.masterVolume <= 0) return;
    const ctx = await this.getContext();
    if (!ctx) return;

    const t = ctx.currentTime + 0.01;
    const notes = [587.33, 880, 1174.66]; // D5, A5, D6
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const start = t + idx * 0.06;

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, start);

      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.24 * settings.masterVolume, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.38);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(start);
      osc.stop(start + 0.4);
    });
  }

  /**
   * Call disconnected sound
   */
  public async playCallEnded() {
    const settings = getSoundSettings();
    if (!settings.soundEnabled || settings.masterVolume <= 0) return;
    const ctx = await this.getContext();
    if (!ctx) return;

    const t = ctx.currentTime + 0.01;
    const notes = [880, 587.33, 440];
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const start = t + idx * 0.07;

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, start);

      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.2 * settings.masterVolume, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.32);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(start);
      osc.stop(start + 0.35);
    });
  }

  /**
   * Pairing success sound
   */
  public async playPairingSuccess() {
    const settings = getSoundSettings();
    if (!settings.soundEnabled || settings.masterVolume <= 0) return;
    const ctx = await this.getContext();
    if (!ctx) return;

    const t = ctx.currentTime + 0.01;
    const notes = [523.25, 659.25, 783.99, 1046.5]; // C E G C
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const start = t + idx * 0.08;

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, start);

      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.25 * settings.masterVolume, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.48);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(start);
      osc.stop(start + 0.5);
    });
  }

  public playMessageReceived() {
    this.playMessageSound();
  }

  public playActionPing() {
    this.playMessageSent();
  }

  public previewNotification(soundType: MessageSoundType) {
    this.playMessageSound(soundType);
  }
}

export const soundEngine = new CyberSoundEngine();
