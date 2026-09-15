import React, { useEffect, useRef, useState } from 'react';
import { IdentityRecord } from '../types/index';
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

  const initial = (identity?.displayName || 'U').charAt(0).toUpperCase();

  return (
    <header className="shrink-0 px-3 sm:px-5 h-14 flex items-center justify-between gap-2 select-none">
      {/* Brand */}
      <div className="flex items-center gap-2 min-w-0">
        <ScryptChatLogo size={24} className="shrink-0" />
        <span className="wordmark truncate">scryptChat</span>
      </div>

      {/* Mobile tab switcher */}
      <div className="flex md:hidden items-center gap-1 p-1 rounded-full border border-zinc-800 bg-zinc-900">
        <button
          onClick={() => onMobileTabChange('peers')}
          className={`px-3 py-1 rounded-full text-[11px] font-medium transition-colors ${
            currentMobileTab === 'peers' ? 'bg-zinc-950 text-white' : 'text-zinc-500'
          }`}
        >
          Chats
        </button>
        <button
          onClick={() => onMobileTabChange('chat')}
          className={`px-3 py-1 rounded-full text-[11px] font-medium transition-colors ${
            currentMobileTab === 'chat' ? 'bg-zinc-950 text-white' : 'text-zinc-500'
          }`}
        >
          Chat
        </button>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1.5">
        <button
          onClick={onOpenPairing}
          className="p-2 rounded-full text-zinc-400 hover:text-white hover:bg-zinc-900 transition-colors cursor-pointer"
          title="Pair a device"
          aria-label="Pair a device"
        >
          <Plus className="w-4 h-4" />
        </button>

        <button
          onClick={toggleTheme}
          className="p-2 rounded-full text-zinc-400 hover:text-white hover:bg-zinc-900 transition-colors cursor-pointer"
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          aria-label="Toggle theme"
        >
          {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>

        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setIsMenuOpen((open) => !open)}
            className="flex items-center gap-1.5 pl-1 pr-1.5 py-1 rounded-full hover:bg-zinc-900 transition-colors cursor-pointer"
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
            <ChevronDown className="w-3.5 h-3.5 text-zinc-500" />
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
                  onOpenProfile();
                }}
                className="w-full flex items-center gap-2 px-2.5 py-2 rounded-xl text-xs text-zinc-300 hover:text-white hover:bg-zinc-900 transition-colors cursor-pointer"
              >
                <User className="w-3.5 h-3.5" />
                <span>Edit profile</span>
              </button>
              <button
                onClick={() => {
                  setIsMenuOpen(false);
                  onOpenSecurity();
                }}
                className="w-full flex items-center gap-2 px-2.5 py-2 rounded-xl text-xs text-zinc-300 hover:text-white hover:bg-zinc-900 transition-colors cursor-pointer"
              >
                <Shield className="w-3.5 h-3.5" />
                <span>Safety number</span>
              </button>
              <button
                onClick={() => {
                  setIsMenuOpen(false);
                  onOpenSettings();
                }}
                className="w-full flex items-center gap-2 px-2.5 py-2 rounded-xl text-xs text-zinc-300 hover:text-white hover:bg-zinc-900 transition-colors cursor-pointer"
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
                className="w-full flex items-center gap-2 px-2.5 py-2 rounded-xl text-xs text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
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
