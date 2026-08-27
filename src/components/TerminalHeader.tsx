import React, { useState } from 'react';
import { ConnectionState } from '../webrtc/peerManager';
import { ContactRecord, IdentityRecord, RelayStatus } from '../types/index';
import {
  Lock,
  Plus,
  KeyRound,
  Trash2,
  Check,
  Copy,
  MoreVertical,
  Shield,
} from 'lucide-react';

interface TerminalHeaderProps {
  identity: IdentityRecord | null;
  connectionState: ConnectionState;
  relayStatus: RelayStatus;
  activeContact: ContactRecord | null;
  latencyMs: number | null;
  currentMobileTab: 'peers' | 'chat';
  onMobileTabChange: (tab: 'peers' | 'chat') => void;
  onOpenPairing: () => void;
  onOpenSecurity: () => void;
  onOpenProfile: () => void;
  onOpenWipe: () => void;
}

export const TerminalHeader: React.FC<TerminalHeaderProps> = ({
  identity,
  connectionState,
  relayStatus,
  activeContact,
  latencyMs,
  currentMobileTab,
  onMobileTabChange,
  onOpenPairing,
  onOpenSecurity,
  onOpenProfile,
  onOpenWipe,
}) => {
  const isDirect = connectionState === 'CONNECTED';
  const isConnecting = connectionState === 'CONNECTING' || connectionState === 'HANDSHAKING';
  const [copied, setCopied] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const copyId = () => {
    if (!identity?.deviceId) return;
    navigator.clipboard.writeText(identity.deviceId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const initial = (identity?.displayName || 'U').charAt(0).toUpperCase();

  return (
    <header className="border-b border-[#27272a] bg-[#09090b] px-4 sm:px-6 py-3 flex items-center justify-between gap-4 text-sm font-sans select-none z-20">
      {/* Left: Brand Logo & Title */}
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-[#18181b] border border-[#27272a] flex items-center justify-center text-white">
          <Lock className="w-4 h-4" />
        </div>
        <span className="font-semibold text-white text-sm tracking-tight">
          scryptChat
        </span>
      </div>

      {/* Mobile Tab Switcher */}
      <div className="flex md:hidden items-center bg-[#18181b] border border-[#27272a] rounded-lg p-0.5">
        <button
          id="tab-peers-btn"
          onClick={() => onMobileTabChange('peers')}
          className={`px-3 py-1 text-xs rounded-md font-medium transition-colors ${
            currentMobileTab === 'peers'
              ? 'bg-white text-black font-semibold'
              : 'text-[#a1a1aa] hover:text-white'
          }`}
        >
          Chats
        </button>
        <button
          id="tab-chat-btn"
          onClick={() => onMobileTabChange('chat')}
          className={`px-3 py-1 text-xs rounded-md font-medium transition-colors ${
            currentMobileTab === 'chat'
              ? 'bg-white text-black font-semibold'
              : 'text-[#a1a1aa] hover:text-white'
          }`}
        >
          Chat
        </button>
      </div>

      {/* Right: Status, Actions, Profile */}
      <div className="flex items-center gap-2.5">
        {/* Status Pill */}
        <div
          id="p2p-status-indicator"
          className="hidden sm:flex items-center gap-2 px-2.5 py-1 rounded-md bg-[#18181b] border border-[#27272a] text-xs"
        >
          {isDirect ? (
            <>
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              <span className="text-emerald-400 font-medium">Direct P2P</span>
              {latencyMs !== null && (
                <span className="text-[#71717a] font-mono text-[11px] border-l border-[#27272a] pl-2">
                  {latencyMs}ms
                </span>
              )}
            </>
          ) : isConnecting ? (
            <>
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
              <span className="text-amber-300">Connecting P2P...</span>
            </>
          ) : relayStatus === 'ONLINE' ? (
            <>
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              <span className="text-[#e4e4e7] font-medium">Mailbox Online</span>
            </>
          ) : relayStatus === 'CONNECTING' ? (
            <>
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
              <span className="text-amber-300">Connecting Relay...</span>
            </>
          ) : (
            <>
              <span className="w-2 h-2 rounded-full bg-red-400" />
              <span className="text-red-300">Relay Offline</span>
            </>
          )}
        </div>

        {/* Add Contact Button */}
        <button
          id="open-pairing-modal-btn"
          onClick={onOpenPairing}
          className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-neutral-200 text-black font-semibold rounded-lg transition-colors text-xs shadow-sm"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>New Chat</span>
        </button>

        {/* User Profile Avatar */}
        <button
          id="header-profile-btn"
          onClick={onOpenProfile}
          className="p-0.5 rounded-full hover:ring-2 hover:ring-[#3f3f46] transition-all"
          title="Profile & Settings"
        >
          <div
            className="w-7 h-7 rounded-full flex items-center justify-center text-white font-medium text-xs shadow-sm"
            style={{ backgroundColor: identity?.avatarColor || '#3b82f6' }}
          >
            {initial}
          </div>
        </button>

        {/* Options Menu Dropdown */}
        <div className="relative">
          <button
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            className="p-1.5 text-[#a1a1aa] hover:text-white hover:bg-[#18181b] rounded-lg transition-colors"
          >
            <MoreVertical className="w-4 h-4" />
          </button>

          {isMenuOpen && (
            <div
              className="absolute right-0 top-full mt-2 w-44 bg-[#18181b] border border-[#27272a] rounded-xl shadow-xl p-1 space-y-0.5 text-xs z-50 animate-in fade-in duration-100"
              onMouseLeave={() => setIsMenuOpen(false)}
            >
              <button
                onClick={() => {
                  setIsMenuOpen(false);
                  onOpenProfile();
                }}
                className="w-full text-left px-3 py-2 text-[#e4e4e7] hover:text-white hover:bg-[#27272a] rounded-lg transition-colors"
              >
                Profile &amp; Device
              </button>
              <button
                onClick={() => {
                  setIsMenuOpen(false);
                  onOpenSecurity();
                }}
                className="w-full text-left px-3 py-2 text-[#e4e4e7] hover:text-white hover:bg-[#27272a] rounded-lg transition-colors flex items-center justify-between"
              >
                <span>Security</span>
                <Shield className="w-3.5 h-3.5 text-[#a1a1aa]" />
              </button>
              <button
                onClick={() => {
                  copyId();
                  setIsMenuOpen(false);
                }}
                className="w-full text-left px-3 py-2 text-[#e4e4e7] hover:text-white hover:bg-[#27272a] rounded-lg transition-colors flex items-center justify-between"
              >
                <span>{copied ? 'Copied ID' : 'Copy ID'}</span>
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-[#a1a1aa]" />}
              </button>
              <div className="border-t border-[#27272a] my-1" />
              <button
                onClick={() => {
                  setIsMenuOpen(false);
                  onOpenWipe();
                }}
                className="w-full text-left px-3 py-2 text-red-400 hover:bg-red-950/40 rounded-lg transition-colors flex items-center justify-between"
              >
                <span>Delete All Data</span>
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};


