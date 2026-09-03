/**
 * Per-Chat Advanced Local Settings for scryptChat
 * 
 * Stored locally per contact device ID. These settings only affect the local device
 * and do not restrict or alter the remote peer's settings.
 */

import { MessageSoundType } from './cyberSoundEngine';

export interface ChatCustomSettings {
  blurMedia: boolean;
  autoDownloadMedia: boolean;
  muteNotifications: boolean;
  customSound: MessageSoundType | 'default';
  disappearingTimerSeconds: number; // 0 = off, 3600 = 1h, 86400 = 24h, 604800 = 7d
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

const STORAGE_PREFIX = 'scryptchat_chat_settings_';

export function getChatSettings(peerDeviceId: string): ChatCustomSettings {
  if (!peerDeviceId) return { ...DEFAULT_CHAT_SETTINGS };
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${peerDeviceId}`);
    if (raw) {
      return { ...DEFAULT_CHAT_SETTINGS, ...JSON.parse(raw) };
    }
  } catch {}
  return { ...DEFAULT_CHAT_SETTINGS };
}

export function saveChatSettings(peerDeviceId: string, settings: Partial<ChatCustomSettings>): ChatCustomSettings {
  if (!peerDeviceId) return { ...DEFAULT_CHAT_SETTINGS };
  try {
    const current = getChatSettings(peerDeviceId);
    const updated = { ...current, ...settings };
    localStorage.setItem(`${STORAGE_PREFIX}${peerDeviceId}`, JSON.stringify(updated));
    return updated;
  } catch {
    return { ...DEFAULT_CHAT_SETTINGS, ...settings };
  }
}
