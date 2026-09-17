import React, { useEffect, useRef, useState } from 'react';
import { ConnectionState } from '../webrtc/peerManager';
import { ContactRecord, IdentityRecord, RelayStatus } from '../types/index';
import {
  Check,
  ChevronDown,
  Copy,
  Moon,
  Plus,
  Shield,
  Sliders,
  Sun,
  Trash2,
  User,
} from 'lucide-react';
import { ScryptChatLogo } from './ScryptChatLogo';
import { useTheme } from '../utils/theme';

interface TerminalHeaderProps {
  identity: IdentityRecord | null;
  connectionState: ConnectionState;
  relayStatus: RelayStatus;
  relayPingMs?: number | null;
  relayErrorReason?: string | null;
  onRetryRelay: () => void;
  activeContact: ContactRecord | null;
  latencyMs: number | null;
  currentMobileTab: 'peers' | 'chat';
  onMobileTabChange: (tab: 'peers' | 'chat') => void;
  onOpenPairing: () => void;
  onOpenSecurity: () => void;
  onOpenProfile: () => void;
  onOpenSettings: () => void;
  onOpenWipe: () => void;
}

export const TerminalHeader: React.FC<TerminalHeaderProps> = ({
  identity,
  connectionState,
  relayStatus,
  relayPingMs,
  relayErrorReason,
  onRetryRelay,
  activeContact,
  latencyMs,
  currentMobileTab,
  onMobileTabChange,
  onOpenPairing,
  onOpenSecurity,
  onOpenProfile,
  onOpenSettings,
  onOpenWipe,
}) => {
  const { theme, toggleTheme } = useTheme();
  const [copied, setCopied] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isMenuOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isMenuOpen]);

  const copyId = () => {
    if (!identity?.deviceId) return;
    navigator.clipboard.writeText(identity.deviceId);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const status = (() => {
    if (connectionState === 'CONNECTED') {
      return {
        label:
          latencyMs !== null && latencyMs !== undefined
            ? `Connected · ${latencyMs}ms`
            : 'Connected',
        dot: 'bg-[var(--sc-e400)]',
        tone: 'text-[var(--sc-e400)]',
        hint: 'Direct peer connection is open',
      };
    }
    if (connectionState === 'CONNECTING' || connectionState === 'HANDSHAKING') {
      return {
        label: 'Connecting',
        dot: 'bg-amber-400 animate-pulse',
        tone: 'text-amber-500',
        hint: activeContact
          ? `Linking with ${activeContact.alias || activeContact.deviceId}`
          : 'Negotiating a direct peer connection',
      };
    }
    if (relayStatus === 'ONLINE') {
      return {
        label:
          relayPingMs !== null && relayPingMs !== undefined
            ? `Online · ${relayPingMs}ms`
            : 'Online',
        dot: 'bg-[var(--sc-e400)]',
        tone: 'text-[var(--sc-e400)]',
        hint: 'Signaling server reachable — ready to pair and receive',
      };
    }
    if (relayStatus === 'OFFLINE') {
      return {
        label: 'Server offline',
        dot: 'bg-rose-500',
        tone: 'text-rose-500',
        hint: relayErrorReason
          ? `${relayErrorReason} — local chats, history and profile still work. Tap to retry.`
          : 'Signaling server unreachable — tap to retry',
      };
    }
    if (relayStatus === 'RESTARTING') {
      return {
        label: 'Restarting',
        dot: 'bg-amber-400 animate-pulse',
        tone: 'text-amber-500',
        hint: 'Signaling server restarting',
      };
    }
    return {
      label: 'Connecting…',
      dot: 'bg-amber-400 animate-pulse',
      tone: 'text-zinc-500',
      hint: 'Checking the signaling server',
    };
  })();

  const initial = (identity?.displayName || 'U').charAt(0).toUpperCase();

  const menuItem = 'w-full flex items-center gap-2 px-2.5 py-2 rounded-xl text-xs transition-colors cursor-pointer';

  return (
    <header className="shrink-0 h-12 sm:h-14 px-2.5 sm:px-5 flex items-center justify-between gap-2 select-none">
      {/* Brand */}
      <div className="flex items-center gap-2 min-w-0 shrink">
        <ScryptChatLogo size={22} />
        <span className="wordmark truncate hidden xs:inline">scryptChat</span>
      </div>

      {/* Phone/tablet switcher (tablets only: phones navigate with the back arrow) */}
      <div className="hidden sm:flex lg:hidden items-center gap-0.5 p-1 rounded-full border border-zinc-800 bg-zinc-900 shrink-0">
        <button
          onClick={() => onMobileTabChange('peers')}
          className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${
            currentMobileTab === 'peers' ? 'bg-zinc-950 text-white' : 'text-zinc-500'
          }`}
        >
          Chats
        </button>
        <button
          onClick={() => onMobileTabChange('chat')}
          className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${
            currentMobileTab === 'chat' ? 'bg-zinc-950 text-white' : 'text-zinc-500'
          }`}
        >
          Chat
        </button>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
        <button
          onClick={onRetryRelay}
          className="flex items-center justify-center gap-1.5 rounded-full border border-zinc-800 h-8 w-8 sm:h-auto sm:w-auto sm:px-2.5 sm:py-1.5 text-[11px] text-zinc-500 transition-colors hover:border-zinc-700 hover:text-white cursor-pointer shrink-0"
          title={status.hint ? `${status.hint} · tap to retry` : 'Tap to retry'}
          aria-label={`Signaling server: ${status.label}. Tap to retry.`}
        >
          <span className={`h-2 w-2 sm:h-1.5 sm:w-1.5 shrink-0 rounded-full ${status.dot}`} />
          <span className={`hidden sm:inline tabular-nums ${status.tone}`}>{status.label}</span>
        </button>

        <button
          onClick={onOpenPairing}
          className="hidden sm:grid place-items-center h-9 w-9 rounded-full text-zinc-500 hover:text-white hover:bg-zinc-900 transition-colors cursor-pointer"
          title="Pair a device"
          aria-label="Pair a device"
        >
          <Plus className="w-4 h-4" />
        </button>

        <button
          onClick={toggleTheme}
          className="grid place-items-center h-9 w-9 rounded-full text-zinc-500 hover:text-white hover:bg-zinc-900 transition-colors cursor-pointer"
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          aria-label="Toggle color theme"
        >
          {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>

        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setIsMenuOpen((open) => !open)}
            className="flex items-center gap-1 pl-0.5 pr-1 sm:pl-1 sm:pr-1.5 py-1 rounded-full hover:bg-zinc-900 transition-colors cursor-pointer"
            aria-label="Account menu"
          >
            {identity?.avatarUrl ? (
              <img
                src={identity.avatarUrl}
                alt=""
                className="w-7 h-7 rounded-full object-cover"
              />
            ) : (
              <span
                className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-medium text-white"
                style={{ backgroundColor: identity?.avatarColor || '#3f3f46' }}
              >
                {initial}
              </span>
            )}
            <ChevronDown className="hidden sm:block w-3.5 h-3.5 text-zinc-500" />
          </button>

          {isMenuOpen && (
            <div className="absolute right-0 top-full mt-2 w-56 p-1.5 rounded-2xl border border-zinc-800 bg-zinc-950 shadow-xl z-50 animate-in animate-scale-in">
              <div className="px-2.5 py-2">
                <p className="text-xs font-medium text-white truncate">
                  {identity?.displayName || 'Unnamed device'}
                </p>
                <button
                  onClick={copyId}
                  className="mt-0.5 flex items-center gap-1 text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors"
                  title="Copy device ID"
                >
                  {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  <span className="truncate max-w-[150px]">{identity?.deviceId}</span>
                </button>
              </div>
              <div className="my-1 h-px bg-zinc-800" />
              <button
                onClick={() => {
                  setIsMenuOpen(false);
                  onOpenPairing();
                }}
                className={`${menuItem} text-zinc-300 hover:text-white hover:bg-zinc-900 sm:hidden`}
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Pair a device</span>
              </button>
              <button
                onClick={() => {
                  setIsMenuOpen(false);
                  onOpenProfile();
                }}
                className={`${menuItem} text-zinc-300 hover:text-white hover:bg-zinc-900`}
              >
                <User className="w-3.5 h-3.5" />
                <span>Edit profile</span>
              </button>
              <button
                onClick={() => {
                  setIsMenuOpen(false);
                  onOpenSecurity();
                }}
                className={`${menuItem} text-zinc-300 hover:text-white hover:bg-zinc-900`}
              >
                <Shield className="w-3.5 h-3.5" />
                <span>Safety number</span>
              </button>
              <button
                onClick={() => {
                  setIsMenuOpen(false);
                  onOpenSettings();
                }}
                className={`${menuItem} text-zinc-300 hover:text-white hover:bg-zinc-900`}
              >
                <Sliders className="w-3.5 h-3.5" />
                <span>Settings</span>
              </button>
              <div className="my-1 h-px bg-zinc-800" />
              <button
                onClick={() => {
                  setIsMenuOpen(false);
                  onOpenWipe();
                }}
                className={`${menuItem} text-rose-500 hover:bg-rose-500/10`}
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Erase local data</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
