/**
 * scryptChat Sound Engine
 *
 * Three distinct, pleasant notification tones and three distinct ringtones,
 * synthesized in real time with the Web Audio API. No audio files, no harsh
 * glitches, and every preset sounds noticeably different.
 */

export type MessageSoundType =
  | 'crystal_glass'
  | 'soft_marimba'
  | 'subtle_pop'
  // Legacy ids kept so settings saved by older builds still resolve.
  | 'zen_drop'
  | 'stellar_chime'
  | 'gentle_bell'
  | 'neural_ping'
  | 'quantum_chime'
  | 'cyber_glitch'
  | 'glitch_ping'
  | 'laser_blip'
  | 'sub_thud'
  | 'matrix_chime';

export type RingtoneType =
  | 'crystal_pulse'
  | 'cyber_pulse'
  | 'zen_chime'
  // Legacy ids kept so settings saved by older builds still resolve.
  | 'harmonic_ring'
  | 'subtle_orbit'
  | 'gentle_bell'
  | 'neon_hologram'
  | 'sub_quantum'
  | 'cyber_alert'
  | 'neon_synth';

/** The only message tones offered in the UI. */
export type MessageToneId = 'crystal_glass' | 'soft_marimba' | 'subtle_pop';
/** The only ringtones offered in the UI. */
export type RingtoneId = 'crystal_pulse' | 'cyber_pulse' | 'zen_chime';

export const MESSAGE_TONES: { id: MessageToneId; label: string; desc: string }[] = [
  { id: 'crystal_glass', label: 'Crystal', desc: 'Bright glass chime' },
  { id: 'soft_marimba', label: 'Marimba', desc: 'Warm wooden note' },
  { id: 'subtle_pop', label: 'Pop', desc: 'Soft modern blip' },
];

export const RINGTONE_PRESETS: { id: RingtoneId; label: string; desc: string }[] = [
  { id: 'crystal_pulse', label: 'Aurora', desc: 'Melodic ascending chord' },
  { id: 'cyber_pulse', label: 'Pulse', desc: 'Rhythmic digital double-tap' },
  { id: 'zen_chime', label: 'Zen', desc: 'Slow bell with long decay' },
];

const MESSAGE_TONE_ALIASES: Record<string, MessageToneId> = {
  crystal_glass: 'crystal_glass',
  zen_drop: 'crystal_glass',
  stellar_chime: 'crystal_glass',
  neural_ping: 'crystal_glass',
  quantum_chime: 'crystal_glass',
  soft_marimba: 'soft_marimba',
  gentle_bell: 'soft_marimba',
  matrix_chime: 'soft_marimba',
  subtle_pop: 'subtle_pop',
  cyber_glitch: 'subtle_pop',
  glitch_ping: 'subtle_pop',
  laser_blip: 'subtle_pop',
  sub_thud: 'subtle_pop',
};

const RINGTONE_ALIASES: Record<string, RingtoneId> = {
  crystal_pulse: 'crystal_pulse',
  harmonic_ring: 'crystal_pulse',
  neon_synth: 'crystal_pulse',
  subtle_orbit: 'crystal_pulse',
  cyber_pulse: 'cyber_pulse',
  cyber_alert: 'cyber_pulse',
  neon_hologram: 'cyber_pulse',
  sub_quantum: 'cyber_pulse',
  zen_chime: 'zen_chime',
  gentle_bell: 'zen_chime',
};

export function normalizeMessageTone(id?: string | null): MessageToneId {
  return (id && MESSAGE_TONE_ALIASES[id]) || 'crystal_glass';
}

export function normalizeRingtone(id?: string | null): RingtoneId {
  return (id && RINGTONE_ALIASES[id]) || 'crystal_pulse';
}

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
        ringtone: normalizeRingtone(parsed.ringtone ?? parsed.ringtonePreset),
        ringtonePreset: normalizeRingtone(parsed.ringtonePreset ?? parsed.ringtone),
        messageSound: normalizeMessageTone(parsed.messageSound ?? parsed.notificationPreset),
        notificationPreset: normalizeMessageTone(parsed.notificationPreset ?? parsed.messageSound),
      };
    }
  } catch {
    /* storage blocked: fall back to defaults */
  }
  return { ...DEFAULT_SETTINGS };
}

export function saveSoundSettings(settings: SoundSettings): void {
  try {
    const vol = settings.volume ?? settings.masterVolume ?? 0.75;
    const ring = normalizeRingtone(settings.ringtonePreset ?? settings.ringtone);
    const msg = normalizeMessageTone(settings.notificationPreset ?? settings.messageSound);
    const normalized: SoundSettings = {
      ...settings,
      masterVolume: vol,
      volume: vol,
      ringtone: ring,
      ringtonePreset: ring,
      messageSound: msg,
      notificationPreset: msg,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    /* storage blocked: the in-memory defaults still apply */
  }
}

interface Note {
  freq: number;
  /** Seconds the note rings for. */
  duration: number;
  /** Seconds of silence before the next note. */
  gap?: number;
}

class ScryptSoundEngine {
  private ctx: AudioContext | null = null;
  private ringInterval: ReturnType<typeof setInterval> | null = null;
  private isRingingActive = false;
  private activeRingtone: RingtoneId = 'crystal_pulse';

  private async getContext(): Promise<AudioContext | null> {
    try {
      if (!this.ctx || this.ctx.state === 'closed') {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioCtx) this.ctx = new AudioCtx();
      }
      if (this.ctx && this.ctx.state === 'suspended') {
        await this.ctx.resume().catch(() => {});
      }
      return this.ctx;
    } catch {
      return null;
    }
  }

  private volume(ctx: AudioContext): number {
    const settings = getSoundSettings();
    if (!settings.soundEnabled) return 0;
    return Math.max(0.08, Math.min(1, settings.masterVolume || 0.75));
  }

  /** Plays a single note with a soft attack and an exponential release. */
  private playNote(
    ctx: AudioContext,
    at: number,
    freq: number,
    duration: number,
    peak: number,
    type: OscillatorType = 'sine',
    harmonic = 0
  ) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, at);
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(peak, at + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(at);
    osc.stop(at + duration + 0.03);

    if (harmonic > 0) {
      const over = ctx.createOscillator();
      const overGain = ctx.createGain();
      over.type = 'sine';
      over.frequency.setValueAtTime(freq * 2, at);
      overGain.gain.setValueAtTime(0, at);
      overGain.gain.linearRampToValueAtTime(peak * harmonic, at + 0.012);
      overGain.gain.exponentialRampToValueAtTime(0.0001, at + duration * 0.75);
      over.connect(overGain);
      overGain.connect(ctx.destination);
      over.start(at);
      over.stop(at + duration + 0.03);
    }
  }

  private playSequence(
    ctx: AudioContext,
    notes: Note[],
    peak: number,
    type: OscillatorType,
    harmonic = 0
  ) {
    let at = ctx.currentTime + 0.01;
    for (const note of notes) {
      this.playNote(ctx, at, note.freq, note.duration, peak, type, harmonic);
      at += note.duration + (note.gap || 0);
    }
  }

  // --- Message tones ------------------------------------------------------

  public async playMessageSound(customSound?: MessageSoundType) {
    const ctx = await this.getContext();
    if (!ctx) return;
    const vol = this.volume(ctx);
    if (vol <= 0) return;

    const tone = normalizeMessageTone(customSound || getSoundSettings().messageSound);

    if (tone === 'soft_marimba') {
      // Warm, wooden note that falls away quickly.
      this.playSequence(
        ctx,
        [
          { freq: 783.99, duration: 0.16, gap: 0.02 },
          { freq: 587.33, duration: 0.34 },
        ],
        0.26 * vol,
        'sine',
        0.12
      );
      return;
    }

    if (tone === 'subtle_pop') {
      // Short, dry blip: a fast downward sweep.
      const at = ctx.currentTime + 0.01;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(660, at);
      osc.frequency.exponentialRampToValueAtTime(300, at + 0.05);
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(0.22 * vol, at + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.11);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(at);
      osc.stop(at + 0.13);
      return;
    }

    // Crystal: bright two-tone glass chime.
    this.playSequence(
      ctx,
      [
        { freq: 1046.5, duration: 0.1, gap: 0.01 },
        { freq: 1567.98, duration: 0.4 },
      ],
      0.24 * vol,
      'sine',
      0.18
    );
  }

  public async playMessageReceived(preset?: MessageSoundType) {
    return this.playMessageSound(preset);
  }

  public async playSentMessageSound() {
    const ctx = await this.getContext();
    if (!ctx) return;
    const vol = this.volume(ctx);
    if (vol <= 0) return;
    this.playNote(ctx, ctx.currentTime + 0.01, 1150, 0.07, 0.1 * vol, 'sine');
  }

  public async playMessageSent() {
    return this.playSentMessageSound();
  }

  public async playActionPing() {
    return this.playSentMessageSound();
  }

  // --- Ringtones ----------------------------------------------------------

  private ringtoneNotes(preset: RingtoneId): Note[] {
    if (preset === 'cyber_pulse') {
      // Rhythmic digital double-tap.
      return [
        { freq: 587.33, duration: 0.1, gap: 0.06 },
        { freq: 880, duration: 0.12, gap: 0.22 },
        { freq: 587.33, duration: 0.1, gap: 0.06 },
        { freq: 880, duration: 0.22 },
      ];
    }
    if (preset === 'zen_chime') {
      // Slow bell with a long decay.
      return [
        { freq: 659.25, duration: 1.1, gap: 0.15 },
        { freq: 987.77, duration: 1.6 },
      ];
    }
    // Aurora: melodic ascending chord (default).
    return [
      { freq: 523.25, duration: 0.14, gap: 0.05 },
      { freq: 659.25, duration: 0.14, gap: 0.05 },
      { freq: 783.99, duration: 0.2, gap: 0.09 },
      { freq: 1046.5, duration: 0.32, gap: 0.16 },
      { freq: 783.99, duration: 0.16, gap: 0.05 },
      { freq: 1046.5, duration: 0.4 },
    ];
  }

  private ringtoneInterval(preset: RingtoneId): number {
    if (preset === 'cyber_pulse') return 1600;
    if (preset === 'zen_chime') return 3600;
    return 2400;
  }

  private ringtoneWave(preset: RingtoneId): OscillatorType {
    if (preset === 'cyber_pulse') return 'triangle';
    return 'sine';
  }

  public async startRingtoneLoop(isOutgoing = false, preset?: RingtoneType) {
    if (this.isRingingActive) return;
    this.isRingingActive = true;
    this.activeRingtone = normalizeRingtone(preset || getSoundSettings().ringtone);

    const playTone = async () => {
      if (!this.isRingingActive) return;
      const ctx = await this.getContext();
      if (!ctx) return;
      const vol = this.volume(ctx);
      if (vol <= 0) return;

      if (isOutgoing) {
        // Standard 440 + 480 Hz ringback: what an outgoing call should sound like.
        this.playNote(ctx, ctx.currentTime + 0.02, 440, 1.15, 0.12 * vol, 'sine');
        this.playNote(ctx, ctx.currentTime + 0.02, 480, 1.15, 0.12 * vol, 'sine');
        return;
      }

      const notes = this.ringtoneNotes(this.activeRingtone);
      const wave = this.ringtoneWave(this.activeRingtone);
      const peak = this.activeRingtone === 'zen_chime' ? 0.2 * vol : 0.24 * vol;
      this.playSequence(ctx, notes, peak, wave, this.activeRingtone === 'crystal_pulse' ? 0.18 : 0.05);
    };

    await playTone();
    this.ringInterval = setInterval(() => {
      if (!this.isRingingActive) {
        this.stopRingtoneLoop();
        return;
      }
      void playTone();
    }, isOutgoing ? 3000 : this.ringtoneInterval(this.activeRingtone));
  }

  public async startIncomingRingtone(ringtonePreset?: RingtoneType) {
    return this.startRingtoneLoop(false, ringtonePreset);
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

  // --- Call feedback ------------------------------------------------------

  public async playCallConnected() {
    const ctx = await this.getContext();
    if (!ctx) return;
    const vol = this.volume(ctx);
    if (vol <= 0) return;
    this.playSequence(
      ctx,
      [
        { freq: 880, duration: 0.24, gap: 0.06 },
        { freq: 1108.73, duration: 0.24, gap: 0.06 },
        { freq: 1318.51, duration: 0.3 },
      ],
      0.18 * vol,
      'sine',
      0.08
    );
  }

  public async playCallEnded() {
    const ctx = await this.getContext();
    if (!ctx) return;
    const vol = this.volume(ctx);
    if (vol <= 0) return;
    this.playSequence(
      ctx,
      [
        { freq: 659.25, duration: 0.28, gap: 0.04 },
        { freq: 523.25, duration: 0.34 },
      ],
      0.16 * vol,
      'sine'
    );
  }

  public async playFileTransferDone() {
    this.playMessageSound('subtle_pop');
  }

  public async playSecurityVerified() {
    this.playCallConnected();
  }
}

export const soundEngine = new ScryptSoundEngine();
