import { ContactRecord } from '../types/index';

export type PresenceState =
  /** Direct peer link is up (data channel open). */
  | 'connected'
  /** Relay reports the device as online (it can still receive). */
  | 'online'
  /** Same network, talking host-to-host, no internet needed. */
  | 'lan'
  | 'offline';

export interface PresenceInfo {
  state: PresenceState;
  /** Short label for chips and headers. */
  label: string;
  /** Longer, plain-language description for tooltips and detail views. */
  detail: string;
  isOnline: boolean;
}

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

/**
 * Turns the raw presence fields of a contact into wording that actually means
 * something to a person:
 *
 * - `Online · LAN`  both devices are on the same network and talk directly,
 *                   so messages and files never touch the internet.
 * - `Online`        the relay can still reach the device.
 * - `Last seen …`   the relay knows the device, it just is not on the site now.
 * - `Offline`       we have never seen it, or it has been gone for over a day.
 */
export function describePresence(
  contact?: Pick<ContactRecord, 'isOnline' | 'lastSeenAt' | 'isLan'> | null,
  connected = false
): PresenceInfo {
  const isLan = connected && !!contact?.isLan;
  if (isLan) {
    return {
      state: 'lan',
      label: 'LAN',
      detail: 'Direct local network link — everything travels inside your network.',
      isOnline: true,
    };
  }
  if (connected) {
    return {
      state: 'connected',
      label: 'Online',
      detail: 'Direct peer-to-peer link is open.',
      isOnline: true,
    };
  }
  if (contact?.isOnline) {
    return {
      state: 'online',
      label: 'Online',
      detail: 'Reachable through the signaling server.',
      isOnline: true,
    };
  }

  const seen = contact?.lastSeenAt || 0;
  if (!seen) {
    return {
      state: 'offline',
      label: 'Offline',
      detail: 'No route to this device right now.',
      isOnline: false,
    };
  }

  const age = Date.now() - seen;
  if (age < MIN) {
    return {
      state: 'offline',
      label: 'Last seen just now',
      detail: 'The device just went offline.',
      isOnline: false,
    };
  }
  if (age < HOUR) {
    const mins = Math.max(1, Math.round(age / MIN));
    return {
      state: 'offline',
      label: `Last seen ${mins} min ago`,
      detail: 'Signed out — messages will be delivered when it returns.',
      isOnline: false,
    };
  }
  if (age < DAY) {
    const hours = Math.max(1, Math.round(age / HOUR));
    return {
      state: 'offline',
      label: `Last seen ${hours} h ago`,
      detail: 'Signed out — messages will be delivered when it returns.',
      isOnline: false,
    };
  }
  return {
    state: 'offline',
    label: `Last seen ${new Date(seen).toLocaleDateString()}`,
    detail: 'Signed out — messages will be delivered when it returns.',
    isOnline: false,
  };
}
