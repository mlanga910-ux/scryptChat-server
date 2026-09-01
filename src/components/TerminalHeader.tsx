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

  return (
    <header className="border-b border-[#27272a] bg-[#09090b] px-4 sm:px-6 py-2.5 flex items-center justify-between gap-4 text-sm font-sans select-none z-30 relative">
      {/* Left: Brand Logo & Title */}
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-xl bg-[#18181b] border border-[#27272a] flex items-center justify-center text-white shadow-sm">
          <Lock className="w-4 h-4" />
        </div>
        <div className="flex flex-col">
          <span className="font-semibold text-white text-sm tracking-tight leading-tight">
            scryptChat
          </span>
          <span className="text-[10px] text-[#71717a] font-mono leading-none">
            E2EE P2P
          </span>
        </div>
      </div>

      {/* Mobile Tab Switcher */}
      <div className="flex md:hidden items-center bg-[#18181b] border border-[#27272a] rounded-xl p-0.5">
        <button
          id="tab-peers-btn"
          onClick={() => onMobileTabChange('peers')}
          className={`px-3 py-1 text-xs rounded-lg font-medium transition-colors ${
            currentMobileTab === 'peers'
              ? 'bg-white text-black font-semibold'
              : 'text-[#a1a1aa] hover:text-white'
          }`}
        >
          Contacts
        </button>
        <button
          id="tab-chat-btn"
          onClick={() => onMobileTabChange('chat')}
          className={`px-3 py-1 text-xs rounded-lg font-medium transition-colors ${
            currentMobileTab === 'chat'
              ? 'bg-white text-black font-semibold'
              : 'text-[#a1a1aa] hover:text-white'
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
          className="flex items-center gap-2 px-2.5 py-1 rounded-xl bg-[#18181b] border border-[#27272a] text-xs select-none"
        >
          {isDirect ? (
            <>
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              <span className="text-emerald-400 font-medium">Direct P2P</span>
              {latencyMs !== null && (
                <span className="text-[#71717a] font-mono text-[11px] border-l border-[#27272a] pl-2 hidden sm:inline">
                  {latencyMs}ms
                </span>
              )}
            </>
          ) : isConnecting && activeContact ? (
            <>
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
              <span className="text-amber-300">Connecting P2P...</span>
            </>
          ) : relayStatus === 'ONLINE' ? (
            <>
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              <span className="text-[#e4e4e7] font-medium hidden sm:inline">Signaling Online</span>
              <span className="text-[#e4e4e7] font-medium sm:hidden">Online</span>
              {relayPingMs !== null && relayPingMs !== undefined && (
                <span className="text-[#71717a] font-mono text-[11px] border-l border-[#27272a] pl-2 hidden sm:inline">
                  {relayPingMs}ms
                </span>
              )}
            </>
          ) : (
            <>
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
              <span className="text-amber-300">Connecting...</span>
            </>
          )}
        </div>

        {/* User Profile Popover Button */}
        <div className="relative" ref={profileMenuRef}>
          <button
            id="header-profile-btn"
            onClick={() => setIsProfileMenuOpen(!isProfileMenuOpen)}
            className="flex items-center gap-1.5 p-1 pr-2 rounded-xl bg-[#18181b] hover:bg-[#27272a] border border-[#27272a] transition-all cursor-pointer"
            title="Profile & Settings"
          >
            <div
              className="w-6 h-6 rounded-lg flex items-center justify-center text-white font-semibold text-xs shadow-sm"
              style={{ backgroundColor: identity?.avatarColor || '#2563eb' }}
            >
              {initial}
            </div>
            <span className="font-medium text-white text-xs max-w-[80px] truncate hidden sm:inline">
              {identity?.displayName || 'User'}
            </span>
            <ChevronDown className="w-3 h-3 text-[#a1a1aa]" />
          </button>

          {/* Top-Right Profile Dropdown Popover */}
          {isProfileMenuOpen && (
            <div
              id="profile-dropdown-menu"
              className="absolute right-0 top-full mt-2 w-56 bg-[#18181b] border border-[#27272a] rounded-2xl shadow-2xl p-1.5 space-y-0.5 text-xs z-50 animate-in fade-in zoom-in-95 duration-100"
            >
              {/* User Identity Header Card */}
              <div className="p-2.5 bg-[#09090b] border border-[#27272a] rounded-xl mb-1">
                <div className="font-medium text-white text-xs truncate">
                  {identity?.displayName || 'Anonymous User'}
                </div>
                <div className="text-[10px] text-[#71717a] font-mono truncate mt-0.5">
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
                className="w-full text-left px-3 py-2 text-[#e4e4e7] hover:text-white hover:bg-[#27272a] rounded-xl transition-colors flex items-center gap-2"
              >
                <User className="w-4 h-4 text-[#a1a1aa]" />
                <span className="font-medium">Profile &amp; Identity</span>
              </button>

              {/* Settings */}
              <button
                id="menu-settings-btn"
                onClick={() => {
                  setIsProfileMenuOpen(false);
                  onOpenSettings();
                }}
                className="w-full text-left px-3 py-2 text-[#e4e4e7] hover:text-white hover:bg-[#27272a] rounded-xl transition-colors flex items-center gap-2"
              >
                <Sliders className="w-4 h-4 text-[#a1a1aa]" />
                <span className="font-medium">Settings</span>
              </button>

              {/* Security & Safety Numbers */}
              <button
                id="menu-security-btn"
                onClick={() => {
                  setIsProfileMenuOpen(false);
                  onOpenSecurity();
                }}
                className="w-full text-left px-3 py-2 text-[#e4e4e7] hover:text-white hover:bg-[#27272a] rounded-xl transition-colors flex items-center gap-2"
              >
                <Shield className="w-4 h-4 text-[#a1a1aa]" />
                <span className="font-medium">Security &amp; Keys</span>
              </button>

              {/* Pair Device */}
              <button
                id="menu-pair-btn"
                onClick={() => {
                  setIsProfileMenuOpen(false);
                  onOpenPairing();
                }}
                className="w-full text-left px-3 py-2 text-[#e4e4e7] hover:text-white hover:bg-[#27272a] rounded-xl transition-colors flex items-center gap-2"
              >
                <QrCode className="w-4 h-4 text-[#a1a1aa]" />
                <span className="font-medium">Pair Device</span>
              </button>

              {/* Copy Device ID */}
              <button
                id="menu-copy-id-btn"
                onClick={() => {
                  copyId();
                  setIsProfileMenuOpen(false);
                }}
                className="w-full text-left px-3 py-2 text-[#e4e4e7] hover:text-white hover:bg-[#27272a] rounded-xl transition-colors flex items-center justify-between"
              >
                <div className="flex items-center gap-2">
                  <Copy className="w-4 h-4 text-[#a1a1aa]" />
                  <span>{copied ? 'Copied ID' : 'Copy Device ID'}</span>
                </div>
                {copied && <Check className="w-3.5 h-3.5 text-emerald-400" />}
              </button>

              <div className="border-t border-[#27272a] my-1" />

              {/* Clear All Data */}
              <button
                id="menu-wipe-btn"
                onClick={() => {
                  setIsProfileMenuOpen(false);
                  onOpenWipe();
                }}
                className="w-full text-left px-3 py-2 text-red-400 hover:bg-red-950/40 rounded-xl transition-colors flex items-center gap-2"
              >
                <Trash2 className="w-4 h-4 text-red-400" />
                <span className="font-medium">Clear All Data</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
