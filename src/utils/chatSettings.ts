/**
 * Per-chat local settings.
 *
 * These only affect this device (your own notification sound, whether you want
 * calls from a contact blocked, ...). Nothing here is ever sent anywhere.
 *
 * Reads are synchronous because the chat, the settings screen and the call
 * manager all need a value immediately; writes are mirrored into a module-level
 * cache so the app behaves identically on browsers that block storage.
 */

import { getSafeLocalStorage } from '../db/storage';
import type { MessageSoundType, RingtoneType } from './cyberSoundEngine';

export type { MessageSoundType, RingtoneType };

export interface ChatCustomSettings {
  blurMedia: boolean;
  autoDownloadMedia: boolean;
  muteNotifications: boolean;
  customSound: MessageSoundType | 'default';
  /** 0 = off, 3600 = 1h, 86400 = 24h, 604800 = 7d */
  disappearingTimerSeconds: number;
  privateNotes: string;
  blockVoiceCalls: boolean;
  blockVideoCalls: boolean;
}

export const DEFAULT_CHAT_SETTINGS: ChatCustomSettings = {
  blurMedia: false,
  autoDownloadMedia: true,
  muteNotifications: false,
  customSound: 'default',
  disappearingTimerSeconds: 0,
  privateNotes: '',
  blockVoiceCalls: false,
  blockVideoCalls: false,
};

const STORAGE_KEY = 'scryptchat_chat_settings_v2';

/** Last known values, authoritative while the page is open. */
let cache: Record<string, ChatCustomSettings> | null = null;

function normalize(raw: any): ChatCustomSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_CHAT_SETTINGS };
  return { ...DEFAULT_CHAT_SETTINGS, ...raw };
}

function load(): Record<string, ChatCustomSettings> {
  if (cache) return cache;
  cache = {};
  const store = getSafeLocalStorage();
  if (store) {
    try {
      const raw = store.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          for (const [deviceId, value] of Object.entries(parsed)) {
            cache[deviceId] = normalize(value);
          }
        }
      }
    } catch {
      /* corrupt payload: fall back to defaults */
    }
  }
  return cache;
}

function persist() {
  const store = getSafeLocalStorage();
  if (!store || !cache) return;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    /* quota or revoked storage: the in-memory cache still serves reads */
  }
}

/** Current settings for a contact. Always returns a complete object. */
export function getChatSettings(peerDeviceId: string): ChatCustomSettings {
  if (!peerDeviceId) return { ...DEFAULT_CHAT_SETTINGS };
  const map = load();
  return { ...(map[peerDeviceId] || DEFAULT_CHAT_SETTINGS) };
}

/** Merges `settings` into the stored entry and returns the merged result. */
export function saveChatSettings(
  peerDeviceId: string,
  settings: Partial<ChatCustomSettings>
): ChatCustomSettings {
  if (!peerDeviceId) return { ...DEFAULT_CHAT_SETTINGS, ...settings };
  const map = load();
  const merged = normalize({ ...map[peerDeviceId], ...settings });
  map[peerDeviceId] = merged;
  persist();
  return { ...merged };
}

/** Settings for a whole contact list, keyed by deviceId. */
export function loadContactSettingsMap(
  contacts: { deviceId: string }[]
): Record<string, ChatCustomSettings> {
  const map = load();
  const out: Record<string, ChatCustomSettings> = {};
  for (const contact of contacts) {
    out[contact.deviceId] = { ...(map[contact.deviceId] || DEFAULT_CHAT_SETTINGS) };
  }
  return out;
}

/** Drops all per-chat settings (used by the local data wipe). */
export function resetChatSettings() {
  cache = {};
  const store = getSafeLocalStorage();
  try {
    store?.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
