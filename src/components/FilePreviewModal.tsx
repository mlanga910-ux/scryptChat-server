import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  X,
  Download,
  Copy,
  Check,
  Loader2,
  FileText,
  FileCode,
  FileArchive,
  File as FileIcon,
  Folder,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  Image as ImageIcon,
  Film,
  Music,
  ArrowLeft,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Minimize2,
  ExternalLink,
  Info,
  RotateCcw,
  Search,
  WrapText,
  PictureInPicture2,
  Presentation,
  Table2,
  AlertTriangle,
} from 'lucide-react';
import { FileRecord } from '../types/index';
import {
  ArchiveEntry,
  MAX_SHEET_ROWS,
  PreviewKind,
  SheetPreview,
  SlidePreview,
  TEXT_PAGE_LINES,
  codeLanguage,
  countLines,
  delimitedToTable,
  detectPreviewKind,
  docxToHtml,
  extractPdfText,
  extractZipEntry,
  fileExtension,
  findInText,
  formatBytes,
  isTextLike,
  legacyOfficeNotice,
  lineWindow,
  loadPdf,
  previewKindLabel,
  pptxToSlides,
  readZipIndex,
  renderPdfPage,
  textHead,
  xlsxToTable,
  TEXT_PREVIEW_LIMIT,
  ENTRY_TEXT_LIMIT,
  ENTRY_LIST_PAGE,
  MAX_IMAGE_PREVIEW_BYTES,
} from '../utils/filePreview';

interface FilePreviewModalProps {
  isOpen: boolean;
  file: FileRecord | null;
  /** Object URL for the stored blob, when the chat already made one. */
  blobUrl?: string;
  onClose: () => void;
}

interface OpenArchive {
  label: string;
  index: ReturnType<typeof readZipIndex>;
}

interface EntryPreview {
  path: string;
  text?: string;
  imageUrl?: string;
  mediaUrl?: string;
  mediaKind?: 'video' | 'audio';
  size: number;
  truncated?: boolean;
  bytes?: Uint8Array;
}

const iconForKind = (kind: PreviewKind) => {
  switch (kind) {
    case 'image':
      return <ImageIcon className="w-4 h-4" />;
    case 'video':
      return <Film className="w-4 h-4" />;
    case 'audio':
      return <Music className="w-4 h-4" />;
    case 'archive':
      return <FileArchive className="w-4 h-4" />;
    case 'pptx':
      return <Presentation className="w-4 h-4" />;
    case 'sheet':
      return <Table2 className="w-4 h-4" />;
    case 'code':
      return <FileCode className="w-4 h-4" />;
    case 'text':
    case 'pdf':
    case 'docx':
      return <FileText className="w-4 h-4" />;
    default:
      return <FileIcon className="w-4 h-4" />;
  }
};

/** Saves bytes or a blob to the device without keeping a copy in memory. */
function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 8000);
}

const toBlobUrl = (bytes: Uint8Array, type: string) =>
  URL.createObjectURL(new Blob([bytes.slice().buffer as ArrayBuffer], { type }));

const iconClass = 'w-3.5 h-3.5 text-[var(--sc-fg-muted)] shrink-0';

/**
 * Read-only file viewer.
 *
 * Deliberately lean: nothing is rendered that the user is not looking at, long
 * lists fill in as you scroll, big files are read through windows, and PDF
 * pages are rasterised one at a time. Files can be read, copied and downloaded
 * — never edited.
 */
export const FilePreviewModal: React.FC<FilePreviewModalProps> = memo(
  ({ isOpen, file, blobUrl, onClose }) => {
    const kind: PreviewKind = useMemo(
      () => (file ? detectPreviewKind(file.name, file.mimeType) : 'binary'),
      [file?.fileId]
    );

    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [mediaUrl, setMediaUrl] = useState<string | null>(null);

    // text / code
    const [text, setText] = useState('');
    const [visibleLines, setVisibleLines] = useState(TEXT_PAGE_LINES);
    const [isWrapped, setIsWrapped] = useState(false);
    const [findQuery, setFindQuery] = useState('');
    const [isFinding, setIsFinding] = useState(false);

    // pdf
    const [pdfDoc, setPdfDoc] = useState<any>(null);
    const [page, setPage] = useState(1);
    const [pdfText, setPdfText] = useState<string | null>(null);
    const [isExtracting, setIsExtracting] = useState(false);
    const canvasRef = useRef<HTMLCanvasElement>(null);

    // docx
    const [docxHtml, setDocxHtml] = useState('');

    // pptx
    const [slides, setSlides] = useState<SlidePreview[]>([]);
    const [slideWindow, setSlideWindow] = useState(20);

    // spreadsheets
    const [sheet, setSheet] = useState<SheetPreview | null>(null);
    // Rows rendered at once: 16k table cells would stall a weak phone.
    const [sheetRows, setSheetRows] = useState(120);

    // archives
    const [archives, setArchives] = useState<OpenArchive[]>([]);
    const [folder, setFolder] = useState('');
    const [entryQuery, setEntryQuery] = useState('');
    const [visibleEntries, setVisibleEntries] = useState(ENTRY_LIST_PAGE);
    const [entryPreview, setEntryPreview] = useState<EntryPreview | null>(null);
    const [isEntryLoading, setIsEntryLoading] = useState(false);

    // viewing controls
    const [copied, setCopied] = useState<string | null>(null);
    const [zoom, setZoom] = useState(1);
    const [rate, setRate] = useState(1);
    const [isTheatre, setIsTheatre] = useState(false);
    const [mediaEl, setMediaEl] = useState<HTMLMediaElement | null>(null);

    const currentArchive = archives.length > 0 ? archives[archives.length - 1] : null;

    const flashCopied = useCallback((key: string) => {
      setCopied(key);
      setTimeout(() => setCopied((current) => (current === key ? null : current)), 1600);
    }, []);

    /* ------------------------------- loading ------------------------------ */

    useEffect(() => {
      if (!isOpen) return;
      setError(null);
      setNotice(null);
      setIsLoading(true);
      setText('');
      setVisibleLines(TEXT_PAGE_LINES);
      setFindQuery('');
      setIsFinding(false);
      setPdfDoc(null);
      setPage(1);
      setPdfText(null);
      setDocxHtml('');
      setSlides([]);
      setSlideWindow(20);
      setSheet(null);
      setSheetRows(120);
      setArchives([]);
      setFolder('');
      setEntryQuery('');
      setVisibleEntries(ENTRY_LIST_PAGE);
      setEntryPreview(null);
      setMediaUrl(null);
      setZoom(1);
      setRate(1);
      setIsTheatre(false);

      let cancelled = false;

      const run = async () => {
        if (!file) return;

        const legacy = legacyOfficeNotice(file.name);
        if (legacy) {
          if (!cancelled) {
            setNotice(legacy);
            setIsLoading(false);
          }
          return;
        }

        // A chat already handed us a ready object URL for this blob.
        if (blobUrl && (kind === 'image' || kind === 'video' || kind === 'audio')) {
          setMediaUrl(blobUrl);
        }

        let loaded: Blob | null = file.blobRef ?? null;
        if (!loaded && blobUrl) {
          try {
            loaded = await (await fetch(blobUrl)).blob();
          } catch {
            loaded = null;
          }
        }
        if (!loaded) {
          if (!cancelled) {
            setError('This file has not reached this device yet.');
            setIsLoading(false);
          }
          return;
        }

        try {
          if (kind === 'text' || kind === 'code') {
            if (loaded.size > TEXT_PREVIEW_LIMIT) {
              setNotice(
                `Showing the first ${formatBytes(TEXT_PREVIEW_LIMIT)} of ${formatBytes(
                  loaded.size
                )}. Download the file for the rest.`
              );
            }
            const content = await textHead(loaded, TEXT_PREVIEW_LIMIT);
            if (!cancelled) setText(content);
          } else if (kind === 'pdf') {
            const doc = await loadPdf(loaded);
            if (!cancelled) setPdfDoc(doc);
          } else if (kind === 'docx') {
            const html = await docxToHtml(loaded);
            if (!cancelled) setDocxHtml(html);
          } else if (kind === 'pptx') {
            const parsed = await pptxToSlides(loaded);
            if (!cancelled) setSlides(parsed);
          } else if (kind === 'sheet') {
            const ext = fileExtension(file.name);
            const parsed =
              ext === 'csv' || ext === 'tsv'
                ? delimitedToTable(await loaded.text(), ext === 'tsv' ? '\t' : ',')
                : await xlsxToTable(loaded);
            if (!cancelled) setSheet(parsed);
          } else if (kind === 'archive') {
            const index = readZipIndex(await loaded.arrayBuffer());
            if (!cancelled) setArchives([{ label: file.name, index }]);
          } else if (!blobUrl && (kind === 'image' || kind === 'video' || kind === 'audio')) {
            if (!cancelled) setMediaUrl(URL.createObjectURL(loaded));
          }
        } catch (err: any) {
          if (!cancelled) setError(err?.message || 'This file cannot be previewed.');
        } finally {
          if (!cancelled) setIsLoading(false);
        }
      };

      void run();
      return () => {
        cancelled = true;
      };
    }, [isOpen, file?.fileId, kind, blobUrl]);

    // Render the current page only (a 500 page PDF never allocates 500 canvases).
    useEffect(() => {
      if (!pdfDoc || !canvasRef.current) return;
      let cancelled = false;
      // Software-friendly: cap the raster so weak GPUs stay smooth.
      const maxWidth = Math.min(
        860,
        Math.round(window.innerWidth * (window.devicePixelRatio > 2 ? 1 : 1.5))
      );
      renderPdfPage(pdfDoc, page, canvasRef.current, maxWidth).catch(() => {
        if (!cancelled) setError('This page could not be rendered.');
      });
      return () => {
        cancelled = true;
      };
    }, [pdfDoc, page]);

    // Free generated URLs.
    useEffect(() => {
      return () => {
        if (entryPreview?.imageUrl) URL.revokeObjectURL(entryPreview.imageUrl);
        if (entryPreview?.mediaUrl) URL.revokeObjectURL(entryPreview.mediaUrl);
      };
    }, [entryPreview?.imageUrl, entryPreview?.mediaUrl]);

    useEffect(() => {
      return () => {
        if (mediaUrl && mediaUrl !== blobUrl) URL.revokeObjectURL(mediaUrl);
      };
    }, [mediaUrl, blobUrl]);

    // Keyboard: Esc closes, arrows flip PDF pages.
    useEffect(() => {
      if (!isOpen) return;
      const onKey = (event: KeyboardEvent) => {
        if (event.key === 'Escape') onClose();
        if (kind === 'pdf' && pdfDoc) {
          if (event.key === 'ArrowRight' || event.key === 'PageDown') {
            setPage((p) => Math.min(pdfDoc.numPages, p + 1));
          }
          if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
            setPage((p) => Math.max(1, p - 1));
          }
        }
      };
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }, [isOpen, kind, pdfDoc, onClose]);

    // Keep the selected playback speed applied to the media element.
    useEffect(() => {
      if (mediaEl) mediaEl.playbackRate = rate;
    }, [rate, mediaEl]);

    const copyText = useCallback(
      async (value: string, key = 'main') => {
        try {
          await navigator.clipboard.writeText(value);
          flashCopied(key);
        } catch {
          /* clipboard blocked */
        }
      },
      [flashCopied]
    );

    const textWindow = useMemo(
      () => (kind === 'text' || kind === 'code' ? lineWindow(text, 0, visibleLines) : null),
      [kind, text, visibleLines]
    );
    const totalLines = textWindow?.total ?? (text ? countLines(text) : 0);

    const findMatches = useMemo(
      () => (isFinding && (kind === 'text' || kind === 'code') ? findInText(text, findQuery) : []),
      [isFinding, kind, text, findQuery]
    );

    const archiveEntries = currentArchive?.index.entries ?? [];
    const archiveTotals = useMemo(() => {
      let total = 0;
      for (const entry of archiveEntries) total += entry.size;
      return total;
    }, [archiveEntries]);

    const filteredFiles = useMemo(() => {
      if (!currentArchive) return [];
      const query = entryQuery.trim().toLowerCase();
      if (query) {
        return archiveEntries.filter(
          (entry) => !entry.isDirectory && entry.path.toLowerCase().includes(query)
        );
      }
      return archiveEntries.filter((entry) => entry.dir === folder && !entry.isDirectory);
    }, [currentArchive, archiveEntries, entryQuery, folder]);

    const folders = useMemo(() => {
      if (!currentArchive || entryQuery.trim()) return [];
      return Array.from(
        new Set(
          archiveEntries
            .filter((entry) => entry.dir.startsWith(folder) && entry.dir !== folder)
            .map((entry) => entry.dir.slice(folder.length).split('/')[0])
        )
      );
    }, [currentArchive, archiveEntries, folder, entryQuery]);

    if (!isOpen || !file) return null;

    const language = codeLanguage(file.name);
    const hasSource = !!blobUrl || !!file.blobRef;

    /* ------------------------------- actions ------------------------------ */

    const downloadFile = () => {
      const source = blobUrl || mediaUrl;
      if (source) {
        const link = document.createElement('a');
        link.href = source;
        link.download = file.name;
        document.body.appendChild(link);
        link.click();
        link.remove();
        return;
      }
      if (file.blobRef) saveBlob(file.blobRef, file.name);
    };

    const openInNewTab = () => {
      const source = blobUrl || mediaUrl;
      if (source) window.open(source, '_blank', 'noopener');
    };

    const enterPictureInPicture = async () => {
      try {
        const anyEl: any = mediaEl;
        if (anyEl?.requestPictureInPicture && document.pictureInPictureElement !== mediaEl) {
          setIsTheatre(false);
          await anyEl.requestPictureInPicture();
        }
      } catch {
        /* not supported for this stream */
      }
    };

    const extractPdfTextNow = async () => {
      if (!pdfDoc) return;
      setIsExtracting(true);
      try {
        setPdfText(await extractPdfText(pdfDoc));
      } catch (err: any) {
        setError(err?.message || 'Text could not be extracted from this PDF.');
      } finally {
        setIsExtracting(false);
      }
    };

    const resetArchiveView = () => {
      setEntryPreview(null);
      setVisibleEntries(ENTRY_LIST_PAGE);
      setEntryQuery('');
    };

    const openEntry = async (entry: ArchiveEntry) => {
      if (!currentArchive || entry.isDirectory) return;
      setIsEntryLoading(true);
      setNotice(null);
      try {
        const bytes = await extractZipEntry(currentArchive.index, entry);
        const lower = entry.name.toLowerCase();

        // A nested archive (zip inside a zip, or an app/xlsx/docx in a bundle).
        if (/\.(zip|jar|apk|xpi|crx|vsix|ipa|whl|epub|docx|xlsx|pptx|odt|ods|odp)$/i.test(lower)) {
          const nested = readZipIndex(bytes.slice().buffer as ArrayBuffer);
          setArchives((prev) => [...prev, { label: entry.name, index: nested }]);
          setFolder('');
          setEntryPreview(null);
          setVisibleEntries(ENTRY_LIST_PAGE);
          return;
        }

        if (isTextLike(entry.name, '')) {
          const truncated = bytes.length > ENTRY_TEXT_LIMIT;
          const slice = truncated ? bytes.subarray(0, ENTRY_TEXT_LIMIT) : bytes;
          if (truncated) {
            setNotice(
              `Showing the first ${formatBytes(ENTRY_TEXT_LIMIT)} of ${formatBytes(bytes.length)}.`
            );
          }
          setEntryPreview({
            path: entry.path,
            text: new TextDecoder('utf-8', { fatal: false }).decode(slice),
            size: bytes.length,
            truncated,
          });
          return;
        }

        if (/\.(png|jpe?g|gif|webp|avif|bmp|ico|svg)$/i.test(lower)) {
          if (bytes.length > MAX_IMAGE_PREVIEW_BYTES) {
            setEntryPreview({ path: entry.path, size: bytes.length, bytes });
            setNotice('This image is too large to preview here — extract it instead.');
            return;
          }
          const url = toBlobUrl(bytes, /\.svg$/i.test(lower) ? 'image/svg+xml' : 'image/*');
          setEntryPreview({ path: entry.path, imageUrl: url, size: bytes.length, bytes });
          return;
        }

        // Audio/video entries play in place when the browser can decode them.
        if (/\.(mp4|webm|mov|m4v|ogv)$/i.test(lower)) {
          setEntryPreview({
            path: entry.path,
            mediaUrl: toBlobUrl(bytes, 'video/*'),
            mediaKind: 'video',
            size: bytes.length,
            bytes,
          });
          return;
        }
        if (/\.(mp3|wav|ogg|oga|m4a|opus|flac)$/i.test(lower)) {
          setEntryPreview({
            path: entry.path,
            mediaUrl: toBlobUrl(bytes, 'audio/*'),
            mediaKind: 'audio',
            size: bytes.length,
            bytes,
          });
          return;
        }

        // Binary: offer extraction only, and keep the bytes for the button.
        setEntryPreview({ path: entry.path, size: bytes.length, bytes });
      } catch (err: any) {
        setError(err?.message || 'This entry could not be opened.');
      } finally {
        setIsEntryLoading(false);
      }
    };

    const saveEntry = async (entry: ArchiveEntry) => {
      if (!currentArchive) return;
      try {
        const bytes = await extractZipEntry(currentArchive.index, entry);
        saveBlob(new Blob([bytes.slice().buffer as ArrayBuffer]), entry.name);
      } catch (err: any) {
        setError(err?.message || 'This entry could not be extracted.');
      }
    };

    /* -------------------------------- views ------------------------------- */

    /** Read-only code/text view: one text node for the body, one for the gutter. */
    const renderTextView = () => {
      if (!textWindow) return null;
      if (isFinding) {
        return (
          <div className="h-full min-h-0 flex flex-col">
            <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-[var(--sc-border)]">
              <span className="text-[11px] text-[var(--sc-fg-muted)]">
                {findMatches.length > 0
                  ? `${findMatches.length}${findMatches.length >= 200 ? '+' : ''} matches`
                  : 'No matches'}
              </span>
              {findMatches.length >= 200 && (
                <span className="text-[10px] text-[var(--sc-fg-subtle)]">first 200 shown</span>
              )}
            </div>
            <div className="flex-1 min-h-0 overflow-auto divide-y divide-[var(--sc-border)]/60">
              {findMatches.map((match) => (
                <button
                  key={match.line}
                  onClick={() => {
                    setVisibleLines(Math.max(TEXT_PAGE_LINES, match.line + 40));
                    setIsFinding(false);
                  }}
                  className="w-full flex items-start gap-3 px-3 py-2 text-left hover:bg-[var(--sc-surface-2)] transition-colors cursor-pointer"
                >
                  <span className="font-mono text-[10px] text-[var(--sc-fg-subtle)] tabular-nums w-12 shrink-0 text-right">
                    {match.line}
                  </span>
                  <span className="font-mono text-[11px] text-[var(--sc-fg)] truncate">
                    {match.text || ' '}
                  </span>
                </button>
              ))}
            </div>
          </div>
        );
      }

      const gutter = buildLineGutter(textWindow.startLine + 1, textWindow.lines);
      const remaining = textWindow.total - (textWindow.startLine + textWindow.lines.length);

      return (
        <div className="h-full min-h-0 flex flex-col">
          <div className="flex-1 min-h-0 overflow-auto select-text">
            <div className="flex min-w-full items-start">
              <div
                aria-hidden
                className="select-none shrink-0 py-3 pl-3 pr-2 text-right font-mono text-[10px] leading-[1.6] text-[var(--sc-fg-subtle)] bg-[var(--sc-surface-2)]/60 border-r border-[var(--sc-border)] whitespace-pre"
              >
                {gutter}
              </div>
              <pre
                className={`flex-1 py-3 px-3 font-mono text-[11px] sm:text-[12px] leading-[1.6] text-[var(--sc-fg)] ${
                  isWrapped ? 'whitespace-pre-wrap break-words' : 'whitespace-pre'
                }`}
              >
                {textWindow.lines.join('\n')}
              </pre>
            </div>
          </div>

          {remaining > 0 && (
            <div className="shrink-0 flex items-center justify-center gap-3 px-3 py-2 border-t border-[var(--sc-border)]">
              <button
                onClick={() => setVisibleLines((count) => count + TEXT_PAGE_LINES)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--sc-border)] text-[11px] text-[var(--sc-fg-muted)] hover:text-[var(--sc-fg)] hover:bg-[var(--sc-surface-2)] transition-colors cursor-pointer"
              >
                <ChevronDown className="w-3.5 h-3.5" />
                <span>
                  Show {Math.min(TEXT_PAGE_LINES, remaining)} more lines ({remaining.toLocaleString()}{' '}
                  left)
                </span>
              </button>
              <button
                onClick={() => setVisibleLines(Math.min(textWindow.total, 40000))}
                disabled={remaining <= 0 || textWindow.total > 40000}
                className="px-3 py-1.5 rounded-lg border border-[var(--sc-border)] text-[11px] text-[var(--sc-fg-muted)] hover:text-[var(--sc-fg)] hover:bg-[var(--sc-surface-2)] transition-colors disabled:opacity-40 cursor-pointer"
                title={textWindow.total > 40000 ? 'Too large to show at once' : 'Show every line'}
              >
                Show all
              </button>
            </div>
          )}
        </div>
      );
    };

    const renderSlides = () => {
      const shown = slides.slice(0, slideWindow);
      return (
        <div className="h-full min-h-0 flex flex-col">
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-2.5 sm:p-4 space-y-2.5 sm:space-y-3">
            {shown.map((slide) => (
              <article
                key={slide.index}
                className="rounded-xl border border-[var(--sc-border)] bg-[var(--sc-surface)] p-3 sm:p-4"
              >
                <div className="flex items-start gap-3">
                  <span className="shrink-0 grid place-items-center h-6 min-w-6 px-1 rounded-md bg-[var(--sc-surface-2)] border border-[var(--sc-border)] font-mono text-[10px] text-[var(--sc-fg-muted)] tabular-nums">
                    {slide.index}
                  </span>
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <h3 className="text-[13px] sm:text-sm font-semibold text-[var(--sc-fg)] break-words">
                      {slide.title}
                    </h3>
                    {slide.lines.length > 0 && (
                      <ul className="space-y-1">
                        {slide.lines.map((line, index) => (
                          <li
                            key={`${slide.index}-${index}`}
                            className="text-[11px] sm:text-xs leading-relaxed text-[var(--sc-fg-muted)] flex gap-2"
                          >
                            <span className="text-[var(--sc-fg-subtle)] select-none">•</span>
                            <span className="min-w-0 break-words">{line}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </article>
            ))}

            {slides.length > shown.length && (
              <button
                onClick={() => setSlideWindow((count) => count + 30)}
                className="w-full py-2.5 rounded-xl border border-[var(--sc-border)] text-[11px] text-[var(--sc-fg-muted)] hover:text-[var(--sc-fg)] hover:bg-[var(--sc-surface-2)] transition-colors cursor-pointer"
              >
                Show {Math.min(30, slides.length - shown.length)} more slides (
                {slides.length - shown.length} left)
              </button>
            )}
          </div>
        </div>
      );
    };

    const renderSheet = () => {
      if (!sheet) return null;
      const [head, ...allBody] = sheet.rows;
      const body = allBody.slice(0, sheetRows);
      const remainingRows = allBody.length - body.length;
      const columns = Math.max(...sheet.rows.map((row) => row.length), head?.length ?? 0);
      const width = Math.min(columns, head?.length || columns);

      return (
        <div className="h-full min-h-0 flex flex-col">
          <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-[var(--sc-border)] text-[10px] text-[var(--sc-fg-subtle)]">
            <span className="truncate">{sheet.name}</span>
            <span className="tabular-nums">
              {sheet.rows.length.toLocaleString()} rows
              {sheet.truncated ? ` (of more)` : ''} × {width} cols
            </span>
            <button
              onClick={() =>
                copyText(
                  sheet.rows.map((row) => row.join('\t')).join('\n'),
                  'sheet'
                )
              }
              className="ml-auto flex items-center gap-1.5 px-2 py-1 rounded-lg border border-[var(--sc-border)] text-[10px] text-[var(--sc-fg-muted)] hover:text-[var(--sc-fg)] transition-colors cursor-pointer shrink-0"
            >
              {copied === 'sheet' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              <span>Copy table</span>
            </button>
          </div>
          <div className="flex-1 min-h-0 overflow-auto select-text">
            <table className="min-w-full border-collapse text-[11px]">
              <thead className="sticky top-0 z-10 bg-[var(--sc-surface-2)]">
                <tr>
                  {Array.from({ length: width }).map((_, index) => (
                    <th
                      key={index}
                      className="border border-[var(--sc-border)] px-2 py-1.5 text-left font-semibold text-[var(--sc-fg)] whitespace-nowrap"
                    >
                      {head?.[index] ?? ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {body.map((row, rowIndex) => (
                  <tr key={rowIndex} className="odd:bg-[var(--sc-surface)] even:bg-[var(--sc-surface-2)]/40">
                    {Array.from({ length: width }).map((_, colIndex) => (
                      <td
                        key={colIndex}
                        className="border border-[var(--sc-border)] px-2 py-1 align-top text-[var(--sc-fg-muted)] max-w-[18rem] truncate"
                      >
                        {row?.[colIndex] ?? ''}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(remainingRows > 0 || sheet.truncated) && (
            <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 border-t border-[var(--sc-border)] text-[10px] text-[var(--sc-fg-subtle)]">
              {remainingRows > 0 && (
                <button
                  onClick={() => setSheetRows((count) => count + 240)}
                  className="px-2.5 py-1 rounded-lg border border-[var(--sc-border)] text-[10px] text-[var(--sc-fg-muted)] hover:text-[var(--sc-fg)] hover:bg-[var(--sc-surface-2)] transition-colors cursor-pointer"
                >
                  Show {Math.min(240, remainingRows)} more rows ({remainingRows.toLocaleString()} left)
                </button>
              )}
              {sheet.truncated && (
                <span className="truncate">
                  Only the first {Math.min(sheet.rows.length, MAX_SHEET_ROWS)} rows and {width}{' '}
                  columns are read. Download the file for the full sheet.
                </span>
              )}
            </div>
          )}
        </div>
      );
    };

    const renderArchiveEntry = () => {
      if (!entryPreview) return null;
      return (
        <div className="h-full min-h-0 flex flex-col">
          <div className="shrink-0 flex items-center gap-2 px-2.5 sm:px-3 py-2 border-b border-[var(--sc-border)] bg-[var(--sc-surface-2)]/50">
            <button
              onClick={resetArchiveView}
              className="flex items-center gap-1 text-[11px] text-[var(--sc-fg-muted)] hover:text-[var(--sc-fg)] transition-colors cursor-pointer shrink-0"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back</span>
            </button>
            <span className="ml-auto font-mono text-[10px] text-[var(--sc-fg-subtle)] truncate max-w-[45%]">
              {entryPreview.path}
            </span>
            <span className="text-[10px] text-[var(--sc-fg-subtle)] tabular-nums shrink-0">
              {formatBytes(entryPreview.size)}
            </span>
          </div>

          <div className="flex-1 min-h-0 overflow-auto">
            {entryPreview.imageUrl ? (
              <div className="p-3 grid place-items-center">
                <img
                  src={entryPreview.imageUrl}
                  alt={entryPreview.path}
                  className="max-h-[65vh] rounded-xl"
                />
              </div>
            ) : entryPreview.mediaUrl ? (
              <div className="p-3 grid place-items-center bg-black/40 h-full">
                {entryPreview.mediaKind === 'video' ? (
                  <video controls playsInline src={entryPreview.mediaUrl} className="max-h-full max-w-full rounded-xl" />
                ) : (
                  <audio controls src={entryPreview.mediaUrl} className="w-full max-w-md" />
                )}
              </div>
            ) : entryPreview.text !== undefined ? (
              entryPreview.truncated ? (
                <div className="flex min-w-full items-start">
                  <div
                    aria-hidden
                    className="select-none shrink-0 py-3 pl-3 pr-2 text-right font-mono text-[10px] leading-[1.6] text-[var(--sc-fg-subtle)] bg-[var(--sc-surface-2)]/60 border-r border-[var(--sc-border)] whitespace-pre"
                  >
                    {buildLineGutter(1, entryPreview.text.split('\n'))}
                  </div>
                  <pre className="flex-1 p-3 font-mono text-[11px] leading-[1.6] text-[var(--sc-fg)] whitespace-pre select-text">
                    {entryPreview.text}
                  </pre>
                </div>
              ) : (
                <pre className="p-3 font-mono text-[11px] sm:text-[12px] leading-[1.6] text-[var(--sc-fg)] whitespace-pre select-text">
                  {entryPreview.text}
                </pre>
              )
            ) : (
              <div className="p-6 text-center text-[var(--sc-fg-muted)] text-[11px]">
                Binary file inside the archive ({formatBytes(entryPreview.size)}). Extract it to
                open it in an app.
              </div>
            )}
          </div>

          <div className="shrink-0 flex items-center gap-2 px-2.5 sm:px-3 py-2 border-t border-[var(--sc-border)] bg-[var(--sc-surface-2)]/50">
            <button
              onClick={() => copyText(entryPreview.path, 'entry-path')}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[var(--sc-border)] text-[11px] text-[var(--sc-fg-muted)] hover:text-[var(--sc-fg)] transition-colors cursor-pointer"
            >
              {copied === 'entry-path' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              <span className="hidden xs:inline">Copy path</span>
            </button>
            {entryPreview.text !== undefined && (
              <button
                onClick={() => copyText(entryPreview.text || '', 'entry')}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[var(--sc-border)] text-[11px] text-[var(--sc-fg-muted)] hover:text-[var(--sc-fg)] transition-colors cursor-pointer"
              >
                {copied === 'entry' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                <span className="hidden xs:inline">Copy contents</span>
              </button>
            )}
            <button
              onClick={() =>
                entryPreview.bytes &&
                saveBlob(
                  new Blob([entryPreview.bytes.slice().buffer as ArrayBuffer]),
                  entryPreview.path.split('/').pop() || 'file'
                )
              }
              disabled={!entryPreview.bytes}
              className="ml-auto flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[var(--sc-border)] text-[11px] text-[var(--sc-fg-muted)] hover:text-[var(--sc-fg)] transition-colors disabled:opacity-40 cursor-pointer"
            >
              <Download className="w-3 h-3" />
              <span>Extract file</span>
            </button>
          </div>
        </div>
      );
    };

    const renderArchive = () => {
      if (!currentArchive) return null;
      if (entryPreview) return renderArchiveEntry();

      const shown = filteredFiles.slice(0, visibleEntries);

      return (
        <div className="h-full min-h-0 flex flex-col">
          <div className="shrink-0 flex items-center gap-2 px-2.5 sm:px-3 py-2 border-b border-[var(--sc-border)] bg-[var(--sc-surface-2)]/50">
            <div className="relative flex-1 min-w-0">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--sc-fg-subtle)]" />
              <input
                value={entryQuery}
                onChange={(event) => {
                  setEntryQuery(event.target.value);
                  setVisibleEntries(ENTRY_LIST_PAGE);
                }}
                placeholder="Search inside this archive…"
                className="w-full bg-[var(--sc-surface)] border border-[var(--sc-border)] rounded-lg pl-8 pr-2 py-1.5 text-[11px] text-[var(--sc-fg)] placeholder:text-[var(--sc-fg-subtle)]"
              />
            </div>
            <span className="text-[10px] text-[var(--sc-fg-subtle)] tabular-nums shrink-0 hidden xs:inline">
              {archiveEntries.length} entries · {formatBytes(archiveTotals)}
            </span>
          </div>

          {!entryQuery && (
            <div className="shrink-0 flex items-center gap-1 px-2.5 sm:px-3 py-1.5 border-b border-[var(--sc-border)] text-[11px] overflow-x-auto">
              <button
                onClick={() => {
                  setFolder('');
                  setVisibleEntries(ENTRY_LIST_PAGE);
                }}
                className="text-[var(--sc-fg-muted)] hover:text-[var(--sc-fg)] transition-colors shrink-0 cursor-pointer"
              >
                {currentArchive.label}
              </button>
              {folder
                .split('/')
                .filter(Boolean)
                .map((part, idx, arr) => {
                  const target = arr.slice(0, idx + 1).join('/') + '/';
                  return (
                    <span key={target} className="flex items-center gap-1 shrink-0">
                      <ChevronRight className="w-3 h-3 text-[var(--sc-fg-subtle)]" />
                      <button
                        onClick={() => {
                          setFolder(target);
                          setVisibleEntries(ENTRY_LIST_PAGE);
                        }}
                        className="text-[var(--sc-fg-muted)] hover:text-[var(--sc-fg)] transition-colors cursor-pointer"
                      >
                        {part}
                      </button>
                    </span>
                  );
                })}
            </div>
          )}

          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain divide-y divide-[var(--sc-border)]/60">
            {!entryQuery && folder && (
              <button
                onClick={() => {
                  setFolder(folder.replace(/[^/]+\/$/, ''));
                  setVisibleEntries(ENTRY_LIST_PAGE);
                }}
                className="w-full flex items-center gap-2 px-2.5 sm:px-3 py-2.5 text-left hover:bg-[var(--sc-surface-2)] transition-colors cursor-pointer"
              >
                <ChevronLeft className="w-3.5 h-3.5 text-[var(--sc-fg-subtle)]" />
                <span className="text-[11px] text-[var(--sc-fg-muted)]">..</span>
              </button>
            )}

            {folders.map((name) => (
              <button
                key={`dir-${name}`}
                onClick={() => {
                  setFolder(`${folder}${name}/`);
                  setVisibleEntries(ENTRY_LIST_PAGE);
                }}
                className="w-full flex items-center gap-2 px-2.5 sm:px-3 py-2.5 text-left hover:bg-[var(--sc-surface-2)] transition-colors cursor-pointer"
              >
                <Folder className={iconClass} />
                <span className="text-[11px] text-[var(--sc-fg)] truncate">{name}</span>
              </button>
            ))}

            {shown.map((entry) => (
              <div
                key={entry.path}
                className="flex items-center gap-2 px-2.5 sm:px-3 py-2 hover:bg-[var(--sc-surface-2)] transition-colors"
              >
                <button
                  onClick={() => openEntry(entry)}
                  className="flex-1 min-w-0 flex items-center gap-2 text-left cursor-pointer"
                  aria-label={`View ${entry.name}`}
                >
                  <FileIcon className={iconClass} />
                  <span className="text-[11px] text-[var(--sc-fg)] truncate">
                    {entryQuery ? entry.path : entry.name}
                  </span>
                </button>
                <span className="text-[10px] text-[var(--sc-fg-subtle)] tabular-nums shrink-0 hidden xs:inline">
                  {formatBytes(entry.size)}
                </span>
                <button
                  onClick={() => saveEntry(entry)}
                  className="p-1.5 rounded-lg text-[var(--sc-fg-muted)] hover:text-[var(--sc-fg)] hover:bg-[var(--sc-surface-2)] transition-colors cursor-pointer shrink-0"
                  title="Save this file"
                  aria-label={`Save ${entry.name}`}
                >
                  <Download className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}

            {filteredFiles.length > shown.length && (
              <button
                onClick={() => setVisibleEntries((count) => count + ENTRY_LIST_PAGE * 2)}
                className="w-full px-3 py-2.5 text-[11px] text-[var(--sc-fg-muted)] hover:text-[var(--sc-fg)] transition-colors cursor-pointer"
              >
                Show {Math.min(ENTRY_LIST_PAGE * 2, filteredFiles.length - shown.length)} more (
                {filteredFiles.length - shown.length} left)
              </button>
            )}

            {filteredFiles.length === 0 && folders.length === 0 && (
              <div className="p-6 text-center text-[11px] text-[var(--sc-fg-muted)]">
                {entryQuery ? 'Nothing matches that name.' : 'This folder is empty.'}
              </div>
            )}
          </div>
        </div>
      );
    };

    const renderBody = () => {
      if (isLoading) {
        return (
          <div className="h-full grid place-items-center">
            <div className="flex flex-col items-center gap-2 text-[var(--sc-fg-muted)]">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span className="text-[11px]">Opening…</span>
            </div>
          </div>
        );
      }
      if (error) {
        return (
          <div className="h-full grid place-items-center p-6">
            <div className="text-center space-y-2 max-w-xs">
              <AlertTriangle className="w-5 h-5 text-[var(--sc-warning)] mx-auto" />
              <p className="text-[11px] text-[var(--sc-fg-muted)] leading-relaxed">{error}</p>
              <p className="text-[10px] text-[var(--sc-fg-subtle)]">
                You can still download the file and open it locally.
              </p>
            </div>
          </div>
        );
      }

      switch (kind) {
        case 'image':
          return (
            <div className="h-full overflow-auto bg-[var(--sc-surface-2)]/40 p-3 grid place-items-center">
              {mediaUrl || blobUrl ? (
                <img
                  src={mediaUrl || blobUrl}
                  alt={file.name}
                  draggable={false}
                  className="rounded-xl transition-transform duration-150"
                  style={{
                    transform: `scale(${zoom})`,
                    maxHeight: zoom === 1 ? '100%' : 'none',
                    maxWidth: zoom === 1 ? '100%' : 'none',
                  }}
                />
              ) : null}
            </div>
          );
        case 'video':
          return (
            <div className="h-full grid place-items-center bg-black/60 p-2 sm:p-4">
              <video
                ref={(el) => setMediaEl(el)}
                controls
                playsInline
                preload="metadata"
                src={mediaUrl || blobUrl}
                className="max-h-full max-w-full rounded-xl"
              />
            </div>
          );
        case 'audio':
          return (
            <div className="h-full grid place-items-center p-6">
              <audio
                ref={(el) => setMediaEl(el)}
                controls
                preload="metadata"
                src={mediaUrl || blobUrl}
                className="w-full max-w-md"
              />
            </div>
          );
        case 'pdf':
          return (
            <div className="h-full min-h-0 flex flex-col">
              <div className="shrink-0 flex items-center gap-1.5 px-2 sm:px-3 py-2 border-b border-[var(--sc-border)] bg-[var(--sc-surface-2)]/50 overflow-x-auto">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="grid place-items-center h-7 w-7 rounded-lg border border-[var(--sc-border)] text-[var(--sc-fg-muted)] disabled:opacity-30 hover:text-[var(--sc-fg)] transition-colors cursor-pointer shrink-0"
                  aria-label="Previous page"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <div className="flex items-center gap-1 shrink-0">
                  <input
                    type="number"
                    min={1}
                    max={pdfDoc?.numPages || 1}
                    value={page}
                    onChange={(e) => {
                      const next = parseInt(e.target.value, 10);
                      if (pdfDoc && next >= 1 && next <= pdfDoc.numPages) setPage(next);
                    }}
                    className="w-12 bg-[var(--sc-surface)] border border-[var(--sc-border)] rounded-lg px-1.5 py-1 text-[11px] text-center text-[var(--sc-fg)] tabular-nums"
                    aria-label="Page number"
                  />
                  <span className="text-[11px] text-[var(--sc-fg-muted)] tabular-nums">
                    / {pdfDoc?.numPages ?? '…'}
                  </span>
                </div>
                <button
                  onClick={() => setPage((p) => (pdfDoc ? Math.min(pdfDoc.numPages, p + 1) : p))}
                  disabled={!pdfDoc || page >= pdfDoc.numPages}
                  className="grid place-items-center h-7 w-7 rounded-lg border border-[var(--sc-border)] text-[var(--sc-fg-muted)] disabled:opacity-30 hover:text-[var(--sc-fg)] transition-colors cursor-pointer shrink-0"
                  aria-label="Next page"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={extractPdfTextNow}
                  disabled={isExtracting || !pdfDoc}
                  className="ml-auto flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[var(--sc-border)] text-[11px] text-[var(--sc-fg-muted)] hover:text-[var(--sc-fg)] transition-colors disabled:opacity-50 cursor-pointer shrink-0"
                >
                  {isExtracting ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileText className="w-3 h-3" />}
                  <span>{pdfText ? 'Text ready' : 'Extract text'}</span>
                </button>
                {pdfText && (
                  <button
                    onClick={() => copyText(pdfText, 'pdf')}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[var(--sc-border)] text-[11px] text-[var(--sc-fg-muted)] hover:text-[var(--sc-fg)] transition-colors cursor-pointer shrink-0"
                  >
                    {copied === 'pdf' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    <span className="hidden xs:inline">Copy</span>
                  </button>
                )}
              </div>
              <div className="flex-1 min-h-0 overflow-auto flex justify-center p-2 sm:p-3 bg-[var(--sc-surface-2)]/40">
                <canvas ref={canvasRef} className="max-w-full h-auto rounded-lg shadow-[var(--sc-shadow-md)]" />
              </div>
              {pdfText && (
                <div className="shrink-0 max-h-[38%] overflow-auto border-t border-[var(--sc-border)] p-3 select-text">
                  <pre className="font-mono text-[11px] leading-relaxed text-[var(--sc-fg-muted)] whitespace-pre-wrap">
                    {pdfText}
                  </pre>
                </div>
              )}
            </div>
          );
        case 'docx':
          return (
            <div className="h-full min-h-0 overflow-auto p-4">
              <div
                className="text-[13px] leading-relaxed text-[var(--sc-fg)] select-text [&_h1]:text-lg [&_h1]:font-semibold [&_h1]:mt-4 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:mt-3 [&_h3]:text-sm [&_h3]:font-semibold [&_p]:my-2 [&_table]:w-full [&_table]:my-2 [&_td]:border [&_td]:border-[var(--sc-border)] [&_td]:p-1 [&_th]:border [&_th]:border-[var(--sc-border)] [&_th]:p-1 [&_li]:ml-4 [&_li]:list-disc"
                dangerouslySetInnerHTML={{ __html: docxHtml }}
              />
            </div>
          );
        case 'pptx':
          return renderSlides();
        case 'sheet':
          return renderSheet();
        case 'archive':
          return renderArchive();
        case 'text':
        case 'code':
          return renderTextView();
        default:
          return (
            <div className="h-full grid place-items-center p-6 text-center">
              <div className="space-y-2">
                <FileIcon className="w-6 h-6 text-[var(--sc-fg-subtle)] mx-auto" />
                <p className="text-[11px] text-[var(--sc-fg-muted)] max-w-xs leading-relaxed">
                  This format cannot be shown here. Download it to open it in an app.
                </p>
              </div>
            </div>
          );
      }
    };

    /** Extra viewing controls, per kind. */
    const renderExtraControls = () => {
      if (kind === 'image') {
        return (
          <>
            <button
              onClick={() => setZoom((z) => Math.max(1, +(z - 0.5).toFixed(2)))}
              disabled={zoom <= 1}
              className="grid place-items-center h-8 w-8 rounded-lg text-[var(--sc-fg-muted)] hover:text-[var(--sc-fg)] hover:bg-[var(--sc-surface-2)] transition-colors disabled:opacity-30 cursor-pointer"
              title="Zoom out"
              aria-label="Zoom out"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <button
              onClick={() => setZoom((z) => Math.min(4, +(z + 0.5).toFixed(2)))}
              className="grid place-items-center h-8 w-8 rounded-lg text-[var(--sc-fg-muted)] hover:text-[var(--sc-fg)] hover:bg-[var(--sc-surface-2)] transition-colors cursor-pointer"
              title="Zoom in"
              aria-label="Zoom in"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
            {zoom !== 1 && (
              <button
                onClick={() => setZoom(1)}
                className="flex items-center gap-1 px-2 h-8 rounded-lg text-[11px] text-[var(--sc-fg-muted)] hover:text-[var(--sc-fg)] hover:bg-[var(--sc-surface-2)] transition-colors cursor-pointer"
                title="Fit to screen"
                aria-label="Fit to screen"
              >
                <Maximize2 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{Math.round(zoom * 100)}%</span>
              </button>
            )}
          </>
        );
      }

      if (kind === 'video' || kind === 'audio') {
        return (
          <>
            <div className="hidden sm:flex items-center gap-1 rounded-lg border border-[var(--sc-border)] px-1">
              {[0.5, 1, 1.5, 2].map((value) => (
                <button
                  key={value}
                  onClick={() => setRate(value)}
                  className={`px-1.5 py-1 text-[10px] tabular-nums rounded transition-colors cursor-pointer ${
                    rate === value
                      ? 'text-[var(--sc-fg)] font-semibold'
                      : 'text-[var(--sc-fg-subtle)] hover:text-[var(--sc-fg)]'
                  }`}
                  title={`Playback speed ${value}×`}
                  aria-label={`Playback speed ${value} times`}
                >
                  {value}×
                </button>
              ))}
            </div>
            {kind === 'video' && (
              <>
                <button
                  onClick={enterPictureInPicture}
                  className="hidden sm:grid place-items-center h-8 w-8 rounded-lg text-[var(--sc-fg-muted)] hover:text-[var(--sc-fg)] hover:bg-[var(--sc-surface-2)] transition-colors cursor-pointer"
                  title="Picture in picture"
                  aria-label="Picture in picture"
                >
                  <PictureInPicture2 className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setIsTheatre((value) => !value)}
                  className="grid place-items-center h-8 w-8 rounded-lg text-[var(--sc-fg-muted)] hover:text-[var(--sc-fg)] hover:bg-[var(--sc-surface-2)] transition-colors cursor-pointer"
                  title={isTheatre ? 'Exit large view' : 'Large view'}
                  aria-label={isTheatre ? 'Exit large view' : 'Large view'}
                >
                  {isTheatre ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                </button>
              </>
            )}
          </>
        );
      }

      if (kind === 'text' || kind === 'code') {
        return (
          <>
            <button
              onClick={() => setIsWrapped((value) => !value)}
              className={`grid place-items-center h-8 w-8 rounded-lg transition-colors cursor-pointer ${
                isWrapped
                  ? 'text-[var(--sc-fg)] bg-[var(--sc-surface-2)]'
                  : 'text-[var(--sc-fg-muted)] hover:text-[var(--sc-fg)] hover:bg-[var(--sc-surface-2)]'
              }`}
              title="Toggle line wrap"
              aria-label="Toggle line wrap"
            >
              <WrapText className="w-4 h-4" />
            </button>
            <button
              onClick={() => {
                setIsFinding((value) => !value);
                setFindQuery('');
              }}
              className={`grid place-items-center h-8 w-8 rounded-lg transition-colors cursor-pointer ${
                isFinding
                  ? 'text-[var(--sc-fg)] bg-[var(--sc-surface-2)]'
                  : 'text-[var(--sc-fg-muted)] hover:text-[var(--sc-fg)] hover:bg-[var(--sc-surface-2)]'
              }`}
              title="Find in file"
              aria-label="Find in file"
            >
              <Search className="w-4 h-4" />
            </button>
          </>
        );
      }

      return null;
    };

    const canCopy = kind === 'text' || kind === 'code';
    const canFind = kind === 'text' || kind === 'code';

    return (
      <div
        className={`fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-stretch justify-center p-0 ${
          isTheatre ? '' : 'sm:items-center sm:p-4'
        } select-none font-sans text-xs animate-in fade-in duration-150`}
      >
        <div
          className={`w-full flex flex-col overflow-hidden panel-surface border-0 sm:border border-[var(--sc-border)] shadow-[var(--sc-shadow-lg)] ${
            isTheatre
              ? 'h-full max-w-none rounded-none'
              : 'h-full sm:h-[min(92dvh,880px)] sm:max-w-4xl lg:max-w-5xl sm:rounded-3xl landscape:sm:h-[min(96dvh,880px)]'
          }`}
        >
          {/* Header */}
          <div className="shrink-0 px-2.5 sm:px-4 py-2.5 sm:py-3 flex items-center gap-2 sm:gap-3 border-b border-[var(--sc-border)]">
            <div className="grid place-items-center h-8 w-8 rounded-xl border border-[var(--sc-border)] bg-[var(--sc-surface-2)] text-[var(--sc-fg-muted)] shrink-0">
              {iconForKind(kind)}
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-[12px] sm:text-[13px] font-semibold text-[var(--sc-fg)] truncate">
                {file.name}
              </h2>
              <p className="text-[10px] text-[var(--sc-fg-subtle)] truncate">
                {previewKindLabel(kind)}
                {language ? ` · ${language}` : ''} · {formatBytes(file.size)} · Read-only
              </p>
            </div>

            <div className="flex items-center gap-0.5 sm:gap-1 shrink-0">
              {renderExtraControls()}

              {canCopy && (
                <button
                  onClick={() => copyText(text, 'main')}
                  className="grid place-items-center h-8 w-8 rounded-lg text-[var(--sc-fg-muted)] hover:text-[var(--sc-fg)] hover:bg-[var(--sc-surface-2)] transition-colors cursor-pointer"
                  title="Copy contents"
                  aria-label="Copy contents"
                >
                  {copied === 'main' ? <Check className="w-4 h-4 text-[var(--sc-e400)]" /> : <Copy className="w-4 h-4" />}
                </button>
              )}

              {(kind === 'video' || kind === 'audio' || kind === 'image') && hasSource && (
                <button
                  onClick={openInNewTab}
                  className="hidden sm:grid place-items-center h-8 w-8 rounded-lg text-[var(--sc-fg-muted)] hover:text-[var(--sc-fg)] hover:bg-[var(--sc-surface-2)] transition-colors cursor-pointer"
                  title="Open in a new tab"
                  aria-label="Open in a new tab"
                >
                  <ExternalLink className="w-4 h-4" />
                </button>
              )}

              {hasSource && (
                <button
                  onClick={downloadFile}
                  className="grid place-items-center h-8 w-8 rounded-lg text-[var(--sc-fg-muted)] hover:text-[var(--sc-fg)] hover:bg-[var(--sc-surface-2)] transition-colors cursor-pointer"
                  title="Download"
                  aria-label="Download file"
                >
                  <Download className="w-4 h-4" />
                </button>
              )}

              <button
                onClick={onClose}
                className="grid place-items-center h-8 w-8 rounded-lg text-[var(--sc-fg-subtle)] hover:text-[var(--sc-fg)] hover:bg-[var(--sc-surface-2)] transition-colors cursor-pointer"
                aria-label="Close preview"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {canFind && isFinding && (
            <div className="shrink-0 flex items-center gap-2 px-2.5 sm:px-3 py-2 border-b border-[var(--sc-border)] bg-[var(--sc-surface-2)]/50">
              <Search className="w-3.5 h-3.5 text-[var(--sc-fg-subtle)] shrink-0" />
              <input
                autoFocus
                value={findQuery}
                onChange={(event) => setFindQuery(event.target.value)}
                placeholder="Find in file…"
                className="flex-1 min-w-0 bg-[var(--sc-surface)] border border-[var(--sc-border)] rounded-lg px-2.5 py-1.5 text-[11px] text-[var(--sc-fg)] placeholder:text-[var(--sc-fg-subtle)]"
              />
              <button
                onClick={() => {
                  setIsFinding(false);
                  setFindQuery('');
                }}
                className="text-[11px] text-[var(--sc-fg-muted)] hover:text-[var(--sc-fg)] transition-colors shrink-0 cursor-pointer"
              >
                Close
              </button>
            </div>
          )}

          {(notice || (kind === 'archive' && archives.length > 1)) && (
            <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 border-b border-[var(--sc-border)] bg-[var(--sc-surface-2)]/50 text-[10px] text-[var(--sc-fg-subtle)]">
              {archives.length > 1 && (
                <button
                  onClick={() => {
                    setArchives((prev) => prev.slice(0, -1));
                    resetArchiveView();
                  }}
                  className="flex items-center gap-1 text-[var(--sc-fg-muted)] hover:text-[var(--sc-fg)] transition-colors cursor-pointer shrink-0"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Back to {archives[archives.length - 2]?.label}</span>
                </button>
              )}
              {notice && (
                <span className="flex items-center gap-1.5 min-w-0">
                  <Info className="w-3 h-3 shrink-0" />
                  <span className="truncate">{notice}</span>
                </span>
              )}
            </div>
          )}

          {/* Body */}
          <div className="flex-1 min-h-0 relative bg-[var(--sc-surface-2)]/20">
            {isEntryLoading && (
              <div className="absolute inset-0 z-10 grid place-items-center bg-[var(--sc-canvas)]/60">
                <Loader2 className="w-5 h-5 animate-spin text-[var(--sc-fg-muted)]" />
              </div>
            )}
            {renderBody()}
          </div>

          {totalLines > 0 && (kind === 'text' || kind === 'code') && (
            <div className="shrink-0 px-3 py-1 border-t border-[var(--sc-border)] text-[10px] text-[var(--sc-fg-subtle)] tabular-nums">
              {textWindow ? textWindow.lines.length.toLocaleString() : 0} of{' '}
              {totalLines.toLocaleString()} lines shown
            </div>
          )}
        </div>
      </div>
    );
  }
);

FilePreviewModal.displayName = 'FilePreviewModal';

/** Builds the gutter as a single string so a big file is one text node. */
function buildLineGutter(startNumber: number, lines: string[]): string {
  if (lines.length === 0) return String(startNumber);
  let out = '';
  for (let i = 0; i < lines.length; i += 1) {
    const number = startNumber + i;
    out += i === lines.length - 1 ? String(number) : `${number}\n`;
  }
  return out;
}
