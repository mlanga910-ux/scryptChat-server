import React, { useState, useRef, useEffect } from 'react';
import { ConnectionState } from '../webrtc/peerManager';
import { ContactRecord, IdentityRecord, RelayStatus } from '../types/index';
import {
  Lock,
  Trash2,
  Check,
  Copy,
  Shield,
  User,
  Sliders,
  QrCode,
  ChevronDown,
  Menu,
} from 'lucide-react';

interface TerminalHeaderProps {
  identity: IdentityRecord | null;
  connectionState: ConnectionState;
  relayStatus: RelayStatus;
  relayPingMs?: number | null;
  relayErrorReason?: string | null;
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
  const isDirect = connectionState === 'CONNECTED';
  const isConnecting = connectionState === 'CONNECTING' || connectionState === 'HANDSHAKING';
  const [copied, setCopied] = useState(false);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        profileMenuRef.current &&
        !profileMenuRef.current.contains(event.target as Node)
      ) {
        setIsProfileMenuOpen(false);
      }
    };
    if (isProfileMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isProfileMenuOpen]);

  const copyId = () => {
    if (!identity?.deviceId) return;
    navigator.clipboard.writeText(identity.deviceId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const initial = (identity?.displayName || 'U').charAt(0).toUpperCase();

  const getStatusConfig = () => {
    if (isDirect) {
      return {
        dotColor: 'bg-emerald-400',
        text: 'Direct P2P',
        textColor: 'text-emerald-400',
        subText: latencyMs !== null ? `${latencyMs}ms` : undefined,
      };
    }
    if (isConnecting && activeContact) {
      return {
        dotColor: 'bg-amber-400 animate-pulse',
        text: 'Connecting P2P...',
        textColor: 'text-amber-300',
      };
    }
    if (relayStatus === 'ONLINE') {
      return {
        dotColor: 'bg-emerald-400',
        text: 'Signaling Online',
        textColor: 'text-zinc-300',
        subText: relayPingMs !== null && relayPingMs !== undefined ? `${relayPingMs}ms` : undefined,
      };
    }
    return {
      dotColor: 'bg-amber-400 animate-pulse',
      text: 'Connecting...',
      textColor: 'text-amber-300',
    };
  };

  const status = getStatusConfig();

  return (
    <header className="border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-sm px-4 sm:px-6 py-3 flex items-center justify-between gap-4 text-sm font-sans select-none z-30 relative">
      {/* Left: Brand Logo & Title */}
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-white shadow-sm">
          <Lock className="w-4 h-4 text-emerald-400" />
        </div>
        <div className="flex flex-col">
          <span className="font-semibold text-white text-sm tracking-tight leading-tight">
            scryptChat
          </span>
          <span className="text-[10px] text-zinc-500 font-mono leading-none">
            E2EE P2P
          </span>
        </div>
      </div>

      {/* Mobile Tab Switcher */}
      <div className="flex md:hidden items-center bg-zinc-900 border border-zinc-800 rounded-xl p-0.5">
        <button
          id="tab-peers-btn"
          onClick={() => onMobileTabChange('peers')}
          className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors ${
            currentMobileTab === 'peers'
              ? 'bg-white text-black font-semibold shadow-sm'
              : 'text-zinc-400 hover:text-white'
          }`}
        >
          Contacts
        </button>
        <button
          id="tab-chat-btn"
          onClick={() => onMobileTabChange('chat')}
          className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors ${
            currentMobileTab === 'chat'
              ? 'bg-white text-black font-semibold shadow-sm'
              : 'text-zinc-400 hover:text-white'
          }`}
        >
          Chat
        </button>
      </div>

      {/* Right: Status, Profile & Menu */}
      <div className="flex items-center gap-2">
        {/* Status Pill Indicator */}
        <div
          id="p2p-status-indicator"
          className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-zinc-900 border border-zinc-800 text-xs select-none hidden sm:flex"
        >
          <span className={`w-1.5 h-1.5 rounded-full ${status.dotColor}`} />
          <span className={`font-medium ${status.textColor}`}>{status.text}</span>
          {status.subText && (
            <span className="text-zinc-500 font-mono text-[10px] border-l border-zinc-800 pl-2">
              {status.subText}
            </span>
          )}
        </div>

        {/* Mobile Status Compact */}
        <div className="sm:hidden flex items-center gap-1.5 px-2 py-1 rounded-lg bg-zinc-900 border border-zinc-800">
          <span className={`w-1.5 h-1.5 rounded-full ${status.dotColor}`} />
          <span className={`font-medium ${status.textColor} text-xs`}>
            {isDirect ? 'P2P' : isConnecting ? 'Connecting' : relayStatus === 'ONLINE' ? 'Online' : 'Connecting'}
          </span>
        </div>

        {/* Pair Button - Mobile Only */}
        <button
          className="sm:hidden p-2 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
          onClick={onOpenPairing}
          aria-label="Pair Device"
        >
          <QrCode className="w-5 h-5" />
        </button>

        {/* User Profile Popover Button */}
        <div className="relative" ref={profileMenuRef}>
          <button
            id="header-profile-btn"
            onClick={() => setIsProfileMenuOpen(!isProfileMenuOpen)}
            className="flex items-center gap-2 p-1.5 pr-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 transition-all cursor-pointer"
            title="Profile & Settings"
            aria-expanded={isProfileMenuOpen}
            aria-haspopup="true"
          >
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center text-white font-semibold text-xs shadow-sm"
              style={{ backgroundColor: identity?.avatarColor || '#2563eb' }}
            >
              {initial}
            </div>
            <span className="font-medium text-white text-xs max-w-[100px] truncate hidden sm:inline">
              {identity?.displayName || 'User'}
            </span>
            <ChevronDown className="w-3.5 h-3.5 text-zinc-400 hidden sm:block" />
          </button>

          {/* Top-Right Profile Dropdown Popover */}
          {isProfileMenuOpen && (
            <div
              id="profile-dropdown-menu"
              className="absolute right-0 top-full mt-2 w-56 bg-zinc-950 border border-zinc-800 rounded-2xl shadow-xl p-1.5 space-y-0.5 text-xs z-50 animate-in animate-scale-in"
            >
              {/* User Identity Header Card */}
              <div className="p-3 bg-zinc-950/50 border border-zinc-800 rounded-xl mb-1">
                <div className="font-medium text-white text-xs truncate">
                  {identity?.displayName || 'Anonymous User'}
                </div>
                <div className="text-[10px] text-zinc-500 font-mono truncate mt-0.5">
                  {identity?.deviceId}
                </div>
              </div>

              {/* Profile */}
              <button
                id="menu-profile-btn"
                onClick={() => {
                  setIsProfileMenuOpen(false);
                  onOpenProfile();
                }}
                className="w-full text-left px-3 py-2.5 text-zinc-300 hover:text-white hover:bg-zinc-800 rounded-xl transition-colors flex items-center gap-2"
              >
                <User className="w-4 h-4 text-zinc-400" />
                <span className="font-medium">Profile & Identity</span>
              </button>

              {/* Settings */}
              <button
                id="menu-settings-btn"
                onClick={() => {
                  setIsProfileMenuOpen(false);
                  onOpenSettings();
                }}
                className="w-full text-left px-3 py-2.5 text-zinc-300 hover:text-white hover:bg-zinc-800 rounded-xl transition-colors flex items-center gap-2"
              >
                <Sliders className="w-4 h-4 text-zinc-400" />
                <span className="font-medium">Settings</span>
              </button>

              {/* Security & Safety Numbers */}
              <button
                id="menu-security-btn"
                onClick={() => {
                  setIsProfileMenuOpen(false);
                  onOpenSecurity();
                }}
                className="w-full text-left px-3 py-2.5 text-zinc-300 hover:text-white hover:bg-zinc-800 rounded-xl transition-colors flex items-center gap-2"
              >
                <Shield className="w-4 h-4 text-zinc-400" />
                <span className="font-medium">Security & Keys</span>
              </button>

              {/* Pair Device */}
              <button
                id="menu-pair-btn"
                onClick={() => {
                  setIsProfileMenuOpen(false);
                  onOpenPairing();
                }}
                className="w-full text-left px-3 py-2.5 text-zinc-300 hover:text-white hover:bg-zinc-800 rounded-xl transition-colors flex items-center gap-2"
              >
                <QrCode className="w-4 h-4 text-zinc-400" />
                <span className="font-medium">Pair Device</span>
              </button>

              {/* Copy Device ID */}
              <button
                id="menu-copy-id-btn"
                onClick={() => {
                  copyId();
                  setIsProfileMenuOpen(false);
                }}
                className="w-full text-left px-3 py-2.5 text-zinc-300 hover:text-white hover:bg-zinc-800 rounded-xl transition-colors flex items-center justify-between"
              >
                <div className="flex items-center gap-2">
                  <Copy className="w-4 h-4 text-zinc-400" />
                  <span>{copied ? 'Copied ID' : 'Copy Device ID'}</span>
                </div>
                {copied && <Check className="w-3.5 h-3.5 text-emerald-400" />}
              </button>

              <div className="border-t border-zinc-800 my-1" />

              {/* Clear All Data */}
              <button
                id="menu-wipe-btn"
                onClick={() => {
                  setIsProfileMenuOpen(false);
                  onOpenWipe();
                }}
                className="w-full text-left px-3 py-2.5 text-rose-400 hover:bg-rose-950/30 rounded-xl transition-colors flex items-center gap-2"
              >
                <Trash2 className="w-4 h-4 text-rose-400" />
                <span className="font-medium">Clear All Data</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};