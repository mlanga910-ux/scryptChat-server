import React, { useState } from 'react';
import {
  FileCode,
  Copy,
  Check,
  Download,
  Search,
  Maximize2,
  ChevronDown,
  ChevronUp,
  Code2,
} from 'lucide-react';
import { CodeSnippet } from '../types/index';
import { downloadCodeSnippet, getCodeFileExtension } from '../utils/codeHelper';

interface CodeBlockCardProps {
  code: string;
  language?: string;
  title?: string;
  lineCount?: number;
  onOpenModal?: (snippet: CodeSnippet) => void;
  defaultExpanded?: boolean;
}

export const CodeBlockCard: React.FC<CodeBlockCardProps> = ({
  code,
  language = 'text',
  title,
  lineCount,
  onOpenModal,
  defaultExpanded = false,
}) => {
  const [copied, setCopied] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  const lines = code.split('\n');
  const totalLines = lineCount || lines.length;
  const ext = getCodeFileExtension(language);
  const displayTitle = title || `snippet.${ext}`;

  const filteredLineIndices = searchQuery.trim()
    ? lines
        .map((l, idx) => (l.toLowerCase().includes(searchQuery.toLowerCase()) ? idx : -1))
        .filter((idx) => idx !== -1)
    : null;

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation();
    downloadCodeSnippet(code, language, displayTitle);
  };

  const handleOpenFullscreen = (e: React.MouseEvent) => {
    e.stopPropagation();
    onOpenModal?.({
      code,
      language,
      title: displayTitle,
      lineCount: totalLines,
    });
  };

  const visibleLines = isExpanded ? lines : lines.slice(0, 12);

  return (
    <div className="w-full min-w-0 sm:min-w-[320px] max-w-full bg-zinc-950 border border-zinc-800 rounded-xl overflow-hidden font-mono text-xs shadow-sm my-1 select-text">
      {/* Top Header Bar */}
      <div className="px-3 py-2 bg-zinc-950 border-b border-zinc-800 flex items-center justify-between gap-2 select-none">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-6 h-6 rounded-md bg-zinc-900 border border-zinc-800 flex items-center justify-center shrink-0">
            <FileCode className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <span className="text-white font-medium text-[11px] truncate tracking-tight">
            {displayTitle}
          </span>
          <span className="px-1.5 py-0.5 rounded text-[10px] uppercase font-bold bg-zinc-900 text-emerald-400 border border-zinc-800 shrink-0">
            {language}
          </span>
        </div>

        {/* Quick Action Toolbar */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIsSearchOpen(!isSearchOpen);
            }}
            className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
              isSearchOpen
                ? 'bg-white text-zinc-950'
                : 'text-zinc-500 hover:text-white hover:bg-zinc-900'
            }`}
            title="Search inside code"
            aria-label="Search in code"
            aria-pressed={isSearchOpen}
          >
            <Search className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={handleCopy}
            className="p-1.5 rounded-lg text-zinc-500 hover:text-white hover:bg-zinc-900 transition-colors cursor-pointer flex items-center gap-1 text-[10px] font-sans"
            title="Copy code"
            aria-label="Copy code"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-emerald-400 hidden sm:inline">Copied</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Copy</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={handleDownload}
            className="p-1.5 rounded-lg text-zinc-500 hover:text-white hover:bg-zinc-900 transition-colors cursor-pointer"
            title="Download file"
            aria-label="Download code"
          >
            <Download className="w-3.5 h-3.5" />
          </button>

          {onOpenModal && (
            <button
              type="button"
              onClick={handleOpenFullscreen}
              className="p-1.5 rounded-lg text-zinc-500 hover:text-white hover:bg-zinc-900 transition-colors cursor-pointer"
              title="Fullscreen viewer"
              aria-label="Open fullscreen"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Inline Search Bar */}
      {isSearchOpen && (
        <div className="px-3 py-1.5 bg-zinc-950 border-b border-zinc-800 flex items-center gap-2">
          <Search className="w-3 h-3 text-zinc-500 shrink-0" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter lines..."
            autoFocus
            className="flex-1 bg-transparent text-[11px] text-white placeholder-zinc-500 focus:outline-none"
            aria-label="Search in code"
          />
          {searchQuery && (
            <span className="text-[10px] text-zinc-500 shrink-0">
              {filteredLineIndices ? `${filteredLineIndices.length} matches` : ''}
            </span>
          )}
        </div>
      )}

      {/* Code Lines Body */}
      <div className="p-2.5 sm:p-3 overflow-x-auto max-h-[400px] overflow-y-auto bg-zinc-950 text-[11px] leading-relaxed">
        <table className="w-full border-collapse">
          <tbody>
            {visibleLines.map((lineText, idx) => {
              const lineNumber = idx + 1;
              const isMatch = filteredLineIndices ? filteredLineIndices.includes(idx) : false;
              const isSearchActive = !!searchQuery.trim();

              if (isSearchActive && !isMatch) {
                return null;
              }

              return (
                <tr
                  key={idx}
                  className={`hover:bg-zinc-900/50 transition-colors ${
                    isMatch ? 'bg-amber-400/10' : ''
                  }`}
                >
                  <td className="w-8 pr-3 text-right text-zinc-600 select-none font-mono text-[10px] align-top">
                    {lineNumber}
                  </td>
                  <td className="text-zinc-300 whitespace-pre font-mono select-text break-normal">
                    {lineText || ' '}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Expand / Collapse Footer */}
      {lines.length > 12 && (
        <div className="px-3 py-1.5 bg-zinc-950 border-t border-zinc-800 flex items-center justify-between text-[11px] text-zinc-500 select-none">
          <span className="font-mono text-[10px]">
            {totalLines} lines • {code.length} chars
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsExpanded(!isExpanded)}
              className="flex items-center gap-1 text-emerald-400 hover:text-emerald-300 font-sans font-medium transition-colors cursor-pointer"
              aria-label={isExpanded ? 'Show less' : 'Show all'}
            >
              <span>{isExpanded ? 'Show less' : `Show all (+${lines.length - 12} lines)`}</span>
              {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
            {onOpenModal && (
              <button
                type="button"
                onClick={handleOpenFullscreen}
                className="text-zinc-500 hover:text-white font-sans transition-colors cursor-pointer pl-1 border-l border-zinc-800"
              >
                Open Viewer →
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};