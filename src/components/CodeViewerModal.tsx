import React, { useState } from 'react';
import {
  X,
  Copy,
  Check,
  Download,
  FileCode,
  Search,
} from 'lucide-react';
import { CodeSnippet } from '../types/index';

interface CodeViewerModalProps {
  isOpen: boolean;
  snippet: CodeSnippet | null;
  onClose: () => void;
}

export const CodeViewerModal: React.FC<CodeViewerModalProps> = ({
  isOpen,
  snippet,
  onClose,
}) => {
  const [copied, setCopied] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [wrapLines, setWrapLines] = useState(false);

  if (!isOpen || !snippet) return null;

  const lines = snippet.code.split('\n');
  const filteredIndices = searchQuery.trim()
    ? lines
        .map((line, idx) => (line.toLowerCase().includes(searchQuery.toLowerCase()) ? idx : -1))
        .filter((idx) => idx !== -1)
    : null;

  const handleCopy = () => {
    navigator.clipboard.writeText(snippet.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const filename = snippet.title || `snippet_${Date.now()}.${getExtension(snippet.language)}`;
    const blob = new Blob([snippet.code], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  function getExtension(lang: string): string {
    const map: Record<string, string> = {
      typescript: 'ts',
      javascript: 'js',
      python: 'py',
      rust: 'rs',
      go: 'go',
      cpp: 'cpp',
      c: 'c',
      csharp: 'cs',
      java: 'java',
      html: 'html',
      css: 'css',
      json: 'json',
      sql: 'sql',
      bash: 'sh',
      shell: 'sh',
      markdown: 'md',
      yaml: 'yaml',
      xml: 'xml',
      text: 'txt',
    };
    return map[lang.toLowerCase()] || 'txt';
  }

  return (
    <div
      id="code-viewer-modal-backdrop"
      className="fixed inset-0 z-50 bg-[#0a0a0b]/95 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 select-none font-sans text-xs animate-in fade-in duration-150"
    >
      <div className="w-full max-w-3xl h-[620px] max-h-[92vh] bg-[#0c0c0e] border border-[#27272a]/60 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-[#27272a]/60 bg-[#0a0a0b]/80 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-[#111114] border border-[#27272a]/60 flex items-center justify-center text-white shrink-0">
              <FileCode className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-white tracking-tight truncate">
                  {snippet.title || 'Code Snippet'}
                </h3>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono uppercase bg-[#111114] border border-[#27272a]/60 text-emerald-400 font-semibold">
                  {snippet.language || 'text'}
                </span>
              </div>
              <p className="text-[11px] text-[#71717a] font-mono">
                {lines.length} lines • {snippet.code.length} characters
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => setWrapLines(!wrapLines)}
              className={`px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                wrapLines
                  ? 'bg-white text-black border-white'
                  : 'bg-[#111114] text-[#a1a1aa] border-[#27272a]/60 hover:text-white'
              }`}
              title="Toggle Word Wrap"
              aria-label={wrapLines ? 'Disable word wrap' : 'Enable word wrap'}
            >
              Wrap
            </button>
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#111114] hover:bg-[#27272a] border border-[#27272a]/60 text-white rounded-lg text-xs font-medium transition-colors"
              title="Copy to clipboard"
              aria-label="Copy to clipboard"
            >
              {copied ? (
                <Check className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
              <span>{copied ? 'Copied' : 'Copy'}</span>
            </button>
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                handleDownload();
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-neutral-200 text-black font-semibold rounded-lg text-xs transition-colors shadow-sm"
              title="Download file"
              aria-label="Download snippet"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download</span>
            </a>
            <button
              onClick={onClose}
              className="p-1.5 text-[#71717a] hover:text-white hover:bg-[#27272a] rounded-lg transition-colors ml-1"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Search Toolbar */}
        <div className="px-5 py-2 border-b border-[#27272a]/60 bg-[#0a0a0b]/80 flex items-center justify-between gap-3 shrink-0">
          <div className="relative flex-1 max-w-sm">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[#71717a]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search in code snippet..."
              className="w-full pl-8 pr-3 py-1 bg-[#111114] border border-[#27272a]/60 rounded-lg text-xs text-white placeholder-[#71717a] focus:outline-none focus:border-neutral-400"
              aria-label="Search in code snippet"
            />
          </div>
          {searchQuery && filteredIndices && (
            <span className="text-[11px] text-[#a1a1aa] font-mono">
              {filteredIndices.length} match{filteredIndices.length === 1 ? '' : 'es'} found
            </span>
          )}
        </div>

        {/* Code Content View */}
        <div className="flex-1 overflow-auto bg-[#070709] p-4 font-mono text-[12px] leading-relaxed select-text">
          <table className="w-full border-collapse">
            <tbody>
              {lines.map((lineText, idx) => {
                const isMatch = filteredIndices ? filteredIndices.includes(idx) : false;
                return (
                  <tr
                    key={idx}
                    className={`hover:bg-[#141418] transition-colors ${
                      isMatch ? 'bg-amber-500/15' : ''
                    }`}
                  >
                    <td className="w-12 text-right pr-4 text-[#52525b] select-none align-top font-mono text-[11px] py-0.5 border-r border-[#27272a]/60">
                      {idx + 1}
                    </td>
                    <td
                      className={`pl-4 py-0.5 text-[#e4e4e7] ${
                        wrapLines ? 'whitespace-pre-wrap break-all' : 'whitespace-pre'
                      }`}
                    >
                      {lineText || ' '}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
