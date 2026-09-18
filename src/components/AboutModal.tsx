import React from 'react';
import { X, Info, ExternalLink } from 'lucide-react';
import { ScryptChatLogo } from './ScryptChatLogo';

/**
 * Everything shown in the About window. Update these values to change the
 * release information without touching the layout.
 */
export const APP_INFO = {
  name: 'scryptChat',
  version: 'v0.5.0 beta',
  tagline: 'Built with love and precision by the developer.',
  developer: 'MakLanDEV',
  portfolioUrl: 'https://maklandev.vercel.app/index.html',
  portfolioLabel: 'maklandev.vercel.app',
  license: `© ${new Date().getFullYear()} MakLanDEV. All rights reserved.`,
};

interface AboutModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Optional one-line runtime status shown at the very bottom. */
  statusLine?: string;
}

/**
 * About window: one screen, centred, no scrolling. The logo scales to fill the
 * space between the header and the credits.
 */
export const AboutModal: React.FC<AboutModalProps> = ({ isOpen, onClose, statusLine }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 select-none font-sans text-xs animate-in fade-in duration-150">
      <div className="w-full max-w-sm h-[min(600px,92vh)] panel-surface border border-zinc-800 rounded-3xl shadow-[var(--sc-shadow-lg)] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="shrink-0 px-4 py-3.5 flex items-center gap-3 border-b border-zinc-800">
          <div className="grid place-items-center h-8 w-8 rounded-xl border border-zinc-800 bg-zinc-900 text-zinc-300">
            <Info className="w-4 h-4" />
          </div>
          <h2 className="text-sm font-semibold text-white tracking-tight flex-1">About</h2>
          <button
            onClick={onClose}
            className="grid place-items-center h-8 w-8 rounded-full text-zinc-500 hover:text-white hover:bg-zinc-900 transition-colors cursor-pointer"
            aria-label="Close about"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 px-6 py-4 flex flex-col items-center text-center">
          {/* Brand mark fills the free space */}
          <div className="flex-1 min-h-0 w-full grid place-items-center">
            <ScryptChatLogo size={148} />
          </div>

          <div className="flex flex-col items-center gap-2 pb-1">
            <h3 className="text-xl font-semibold tracking-tight text-white">{APP_INFO.name}</h3>
            <span className="text-[11px] font-medium px-2.5 py-0.5 rounded-full border border-zinc-800 bg-zinc-900 text-zinc-400 tabular-nums">
              {APP_INFO.version}
            </span>
            <p className="text-[11px] text-zinc-500 max-w-[240px] leading-relaxed pt-1">
              {APP_INFO.tagline}
            </p>
          </div>

          {/* Developer + links */}
          <div className="flex flex-col items-center gap-2.5 pt-4">
            <span
              className="text-[28px] font-semibold tracking-tight text-white"
              style={{ letterSpacing: '-0.02em' }}
            >
              {APP_INFO.developer}
            </span>
            <a
              href={APP_INFO.portfolioUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1.5 text-[11px] font-medium px-3 py-1.5 rounded-full border border-zinc-800 bg-zinc-900 text-zinc-300 hover:text-white hover:border-zinc-700 transition-colors"
            >
              <span>{APP_INFO.portfolioLabel}</span>
              <ExternalLink className="w-3 h-3" />
            </a>
            <p className="text-[10px] text-zinc-600 pt-1">{APP_INFO.license}</p>
          </div>
        </div>

        {statusLine && (
          <div className="shrink-0 px-4 py-2.5 border-t border-zinc-800 text-center text-[10px] text-zinc-600 tabular-nums">
            {statusLine}
          </div>
        )}
      </div>
    </div>
  );
};
