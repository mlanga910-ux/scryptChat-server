/**
 * File preview engine.
 *
 * Everything here works on data that is already on the device: a Blob coming
 * from the local vault. Nothing is uploaded and nothing has to be downloaded
 * again just to look inside a file.
 *
 * - Text & code files are shown read-only, page by page, with a line gutter.
 * - PDFs are rendered one page at a time with pdf.js.
 * - DOCX documents are turned into simple HTML straight from the body XML.
 * - PPTX decks are read slide by slide; XLSX/CSV become a plain table.
 * - ZIP archives (and zip-based formats such as .docx, .xlsx, .apk, .jar) are
 *   listed through their central directory and entries are decompressed on
 *   demand with the browser's native `DecompressionStream`.
 *
 * Every reader is streaming-ish and budgeted (line windows, slide windows, row
 * caps) so a phone with little memory and a weak CPU can open a big file
 * without freezing. Nothing here is ever written back to the file.
 */

export type PreviewKind =
  | 'image'
  | 'video'
  | 'audio'
  | 'pdf'
  | 'docx'
  | 'pptx'
  | 'sheet'
  | 'archive'
  | 'code'
  | 'text'
  | 'binary';

const CODE_EXTENSIONS: Record<string, string> = {
  js: 'JavaScript',
  jsx: 'JavaScript',
  mjs: 'JavaScript',
  cjs: 'JavaScript',
  ts: 'TypeScript',
  tsx: 'TypeScript',
  py: 'Python',
  rb: 'Ruby',
  go: 'Go',
  rs: 'Rust',
  java: 'Java',
  kt: 'Kotlin',
  swift: 'Swift',
  c: 'C',
  h: 'C',
  cpp: 'C++',
  hpp: 'C++',
  cs: 'C#',
  php: 'PHP',
  sh: 'Shell',
  bash: 'Shell',
  zsh: 'Shell',
  ps1: 'PowerShell',
  css: 'CSS',
  scss: 'SCSS',
  sass: 'Sass',
  less: 'Less',
  html: 'HTML',
  htm: 'HTML',
  xml: 'XML',
  svg: 'SVG',
  json: 'JSON',
  jsonc: 'JSON',
  yml: 'YAML',
  yaml: 'YAML',
  toml: 'TOML',
  ini: 'INI',
  sql: 'SQL',
  graphql: 'GraphQL',
  gql: 'GraphQL',
  vue: 'Vue',
  svelte: 'Svelte',
  dart: 'Dart',
  lua: 'Lua',
  r: 'R',
  m: 'Objective-C',
  dockerfile: 'Dockerfile',
  makefile: 'Makefile',
  gradle: 'Gradle',
  env: 'Env',
  conf: 'Config',
  cfg: 'Config',
  bat: 'Batch',
  pl: 'Perl',
  tex: 'LaTeX',
};

const TEXT_EXTENSIONS = new Set([
  ...Object.keys(CODE_EXTENSIONS),
  'txt',
  'md',
  'markdown',
  'log',
  'csv',
  'tsv',
  'rtf',
  'srt',
  'vtt',
  'gitignore',
  'npmrc',
]);

const ARCHIVE_EXTENSIONS = new Set([
  'zip',
  'docx',
  'xlsx',
  'pptx',
  'odt',
  'ods',
  'odp',
  'epub',
  'jar',
  'apk',
  'xpi',
  'crx',
  'vsix',
  'ipa',
  'whl',
]);

export function fileExtension(name: string): string {
  const clean = (name || '').split('?')[0];
  const dot = clean.lastIndexOf('.');
  if (dot < 0 || dot === clean.length - 1) return '';
  return clean.slice(dot + 1).toLowerCase();
}

/** Human label for the language of a code file, if we recognise it. */
export function codeLanguage(name: string): string | null {
  return CODE_EXTENSIONS[fileExtension(name)] || null;
}

export function isTextLike(name: string, mimeType?: string): boolean {
  const ext = fileExtension(name);
  if (TEXT_EXTENSIONS.has(ext)) return true;
  if (CODE_EXTENSIONS[ext]) return true;
  if (!mimeType) return false;
  return (
    mimeType.startsWith('text/') ||
    mimeType.includes('json') ||
    mimeType.includes('xml') ||
    mimeType.includes('javascript') ||
    mimeType.includes('yaml')
  );
}

export function detectPreviewKind(name: string, mimeType?: string): PreviewKind {
  const ext = fileExtension(name);
  const mime = (mimeType || '').toLowerCase();

  if (ext === 'pdf' || mime === 'application/pdf') return 'pdf';
  if (ext === 'docx') return 'docx';
  if (ext === 'pptx') return 'pptx';
  if (ext === 'xlsx' || ext === 'csv' || ext === 'tsv') return 'sheet';
  if (ext === 'zip' || mime.includes('zip')) return 'archive';

  if (
    mime.startsWith('image/') ||
    ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'ico', 'svg'].includes(ext)
  ) {
    // SVG is text, but it previews far better as a picture.
    return 'image';
  }
  if (mime.startsWith('video/') || ['mp4', 'webm', 'mov', 'mkv', 'm4v'].includes(ext)) return 'video';
  if (mime.startsWith('audio/') || ['mp3', 'wav', 'ogg', 'm4a', 'opus', 'flac'].includes(ext)) {
    return 'audio';
  }
  if (ARCHIVE_EXTENSIONS.has(ext)) return 'archive';
  if (CODE_EXTENSIONS[ext]) return 'code';
  if (isTextLike(name, mimeType)) return 'text';
  return 'binary';
}

export function previewKindLabel(kind: PreviewKind): string {
  switch (kind) {
    case 'image':
      return 'Image';
    case 'video':
      return 'Video';
    case 'audio':
      return 'Audio';
    case 'pdf':
      return 'PDF document';
    case 'docx':
      return 'Word document';
    case 'pptx':
      return 'Presentation';
    case 'sheet':
      return 'Spreadsheet';
    case 'archive':
      return 'Archive';
    case 'code':
      return 'Source code';
    case 'text':
      return 'Text';
    default:
      return 'File';
  }
}

export function formatBytes(bytes?: number): string {
  if (!bytes && bytes !== 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** Reads a blob as UTF-8 text, tolerating a UTF-8 BOM. */
export async function readBlobText(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
  } catch {
    text = new TextDecoder('latin1').decode(buffer);
  }
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/* ---------------------------------------------------------------------------
 * Budgets. Previews are capped so a low-memory phone never has to hold a whole
 * log file, a huge image or a 4 000 entry archive list in memory at once.
 * ------------------------------------------------------------------------ */

/** Text/code files are read up to this many bytes. */
export const TEXT_PREVIEW_LIMIT = 512 * 1024;
/** Text entries inside an archive are capped harder (they are already nested). */
export const ENTRY_TEXT_LIMIT = 256 * 1024;
/** Archive rows rendered at once; the rest appear on demand. */
export const ENTRY_LIST_PAGE = 150;
/** Images bigger than this are not decoded for an inline preview. */
export const MAX_IMAGE_PREVIEW_BYTES = 12 * 1024 * 1024;

/**
 * Reads only the beginning of a large text blob instead of the whole file, so
 * opening a 200 MB log stays instant.
 */
export async function textHead(blob: Blob, limit = TEXT_PREVIEW_LIMIT): Promise<string> {
  const slice = blob.size > limit ? blob.slice(0, limit) : blob;
  const text = await readBlobText(slice);
  if (blob.size <= limit) return text;
  // Never end on half a character.
  const lastBreak = Math.max(text.lastIndexOf('\n'), 0);
  return lastBreak > 0 ? text.slice(0, lastBreak) : text;
}

/* ---------------------------------------------------------------------------
 * ZIP reading
 * ------------------------------------------------------------------------ */

export interface ArchiveEntry {
  path: string;
  name: string;
  dir: string;
  size: number;
  compressedSize: number;
  isDirectory: boolean;
  method: number;
  localHeaderOffset: number;
}

interface ZipIndex {
  entries: ArchiveEntry[];
  /** Bytes of the local file header area, needed to extract a single entry. */
  view: DataView;
  bytes: Uint8Array;
}

const SIG_EOCD = 0x06054b50;
const SIG_CD = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

function findEndOfCentralDirectory(view: DataView): number {
  const maxScan = Math.min(view.byteLength, 66000);
  for (let i = view.byteLength - 22; i >= view.byteLength - maxScan && i >= 0; i -= 1) {
    if (view.getUint32(i, true) === SIG_EOCD) return i;
  }
  return -1;
}

/** Parses the central directory once; entry data is decompressed on demand. */
export function readZipIndex(buffer: ArrayBuffer): ZipIndex {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const decoder = new TextDecoder('utf-8');

  const eocd = findEndOfCentralDirectory(view);
  if (eocd < 0) throw new Error('This file is not a readable ZIP archive.');

  const entryCount = view.getUint16(eocd + 10, true);
  const cdOffset = view.getUint32(eocd + 16, true);

  const entries: ArchiveEntry[] = [];
  let cursor = cdOffset;

  for (let i = 0; i < entryCount && cursor + 46 <= bytes.length; i += 1) {
    if (view.getUint32(cursor, true) !== SIG_CD) break;

    const method = view.getUint16(cursor + 10, true);
    let compressedSize = view.getUint32(cursor + 20, true);
    let size = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    let localHeaderOffset = view.getUint32(cursor + 42, true);

    const nameStart = cursor + 46;
    const rawName = bytes.subarray(nameStart, nameStart + nameLength);
    const path = decoder.decode(rawName);

    // ZIP64: values of 0xFFFFFFFF live in the extra field, in this order.
    if (size === 0xffffffff || compressedSize === 0xffffffff || localHeaderOffset === 0xffffffff) {
      let extra = nameStart + nameLength;
      const extraEnd = extra + extraLength;
      while (extra + 4 <= extraEnd) {
        const headerId = view.getUint16(extra, true);
        const dataSize = view.getUint16(extra + 2, true);
        if (headerId === 0x0001) {
          let field = extra + 4;
          if (size === 0xffffffff && field + 8 <= extraEnd) {
            size = Number(view.getBigUint64(field, true));
            field += 8;
          }
          if (compressedSize === 0xffffffff && field + 8 <= extraEnd) {
            compressedSize = Number(view.getBigUint64(field, true));
            field += 8;
          }
          if (localHeaderOffset === 0xffffffff && field + 8 <= extraEnd) {
            localHeaderOffset = Number(view.getBigUint64(field, true));
          }
          break;
        }
        extra += 4 + dataSize;
      }
    }

    const isDirectory = path.endsWith('/');
    const clean = isDirectory ? path.slice(0, -1) : path;
    const slash = clean.lastIndexOf('/');
    entries.push({
      path: clean,
      name: slash >= 0 ? clean.slice(slash + 1) : clean,
      dir: slash >= 0 ? clean.slice(0, slash + 1) : '',
      size,
      compressedSize,
      isDirectory,
      method,
      localHeaderOffset,
    });

    cursor = nameStart + nameLength + extraLength + commentLength;
  }

  if (entries.length === 0) throw new Error('This archive has no readable entries.');
  return { entries, view, bytes };
}

/** Extracts a single entry (stored or deflate). Returns raw bytes. */
export async function extractZipEntry(index: ZipIndex, entry: ArchiveEntry): Promise<Uint8Array> {
  const { view, bytes } = index;
  const offset = entry.localHeaderOffset;
  if (offset + 30 > bytes.length || view.getUint32(offset, true) !== SIG_LOCAL) {
    throw new Error('This archive entry is damaged.');
  }
  const nameLength = view.getUint16(offset + 26, true);
  const extraLength = view.getUint16(offset + 28, true);
  const dataStart = offset + 30 + nameLength + extraLength;
  const compressed = bytes.subarray(dataStart, dataStart + entry.compressedSize);

  if (entry.method === 0) return compressed.slice();
  if (entry.method !== 8) {
    throw new Error('This entry uses a compression method that is not supported here.');
  }

  const DecompressionCtor: any = (globalThis as any).DecompressionStream;
  if (!DecompressionCtor) {
    throw new Error('This browser cannot decompress archive entries.');
  }

  const stream = new Blob([compressed.slice()])
    .stream()
    .pipeThrough(new DecompressionCtor('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function listArchiveEntries(blob: Blob): Promise<ArchiveEntry[]> {
  const index = readZipIndex(await blob.arrayBuffer());
  return index.entries;
}

/* ---------------------------------------------------------------------------
 * PDF
 * ------------------------------------------------------------------------ */

let pdfjsPromise: Promise<any> | null = null;

async function getPdfjs(): Promise<any> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      // pdf.js relies on Promise.withResolvers, which older mobile browsers
      // (pre-2024 Chrome/Safari) do not ship yet.
      const anyPromise: any = Promise as any;
      if (typeof anyPromise.withResolvers !== 'function') {
        anyPromise.withResolvers = function withResolvers<T>() {
          let resolve!: (value: T | PromiseLike<T>) => void;
          let reject!: (reason?: any) => void;
          const promise = new Promise<T>((res, rej) => {
            resolve = res;
            reject = rej;
          });
          return { promise, resolve, reject };
        };
      }

      // Loaded as an asset URL so the viewer never depends on a bundler
      // pre-bundling step: it works in the dev server and in the built app.
      // Minified engine + worker: loaded only when a PDF is actually opened.
      const [engine, worker] = await Promise.all([
        import('pdfjs-dist/build/pdf.min.mjs?url'),
        import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
      ]);

      let pdfjs: any;
      try {
        pdfjs = await import(/* @vite-ignore */ engine.default);
      } catch {
        throw new Error('PDF preview is not available in this browser.');
      }
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      return pdfjs;
    })();
  }
  return pdfjsPromise;
}

export async function loadPdf(blob: Blob): Promise<any> {
  const pdfjs = await getPdfjs();
  const data = new Uint8Array(await blob.arrayBuffer());
  return pdfjs.getDocument({ data, isEvalSupported: false }).promise;
}

/** Renders one page into the given canvas, scaled to `maxWidth`. */
export async function renderPdfPage(
  doc: any,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  maxWidth = 900
): Promise<void> {
  const page = await doc.getPage(pageNumber);
  const baseViewport = page.getViewport({ scale: 1 });
  const scale = Math.min(2.5, Math.max(0.4, maxWidth / baseViewport.width));
  const viewport = page.getViewport({ scale });
  const context = canvas.getContext('2d');
  if (!context) return;
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  await page.render({ canvasContext: context, viewport, canvas }).promise;
}

/** Pulls the selectable text out of the document (a few pages at a time). */
export async function extractPdfText(doc: any, maxPages = 20, maxChars = 80000): Promise<string> {
  const pages = Math.min(doc.numPages, maxPages);
  let out = '';
  for (let i = 1; i <= pages; i += 1) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item: any) => (typeof item.str === 'string' ? item.str : ''))
      .join(' ')
      .replace(/\s+\n/g, '\n');
    out += `${out ? '\n\n' : ''}—— Page ${i} ——\n${pageText.trim()}`;
    if (out.length > maxChars) {
      out += `\n\n… text truncated at page ${i}.`;
      break;
    }
  }
  return out.trim();
}

/* ---------------------------------------------------------------------------
 * DOCX and other OOXML documents (.docx, .odt text is read from its zip too)
 * ------------------------------------------------------------------------ */

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function tagElements(parent: Element, tag: string): Element[] {
  return Array.from(parent.getElementsByTagName(tag));
}

function textOfRun(run: Element): string {
  let out = '';
  const walk = (node: Node) => {
    node.childNodes.forEach((child) => {
      if (child.nodeType === 3) {
        if (node.nodeName === 'w:t' || node.nodeName === 'w:delText') {
          out += child.nodeValue || '';
        }
        return;
      }
      if (child.nodeType !== 1) return;
      const name = child.nodeName;
      if (name === 'w:t' || name === 'w:delText') {
        out += child.textContent || '';
        return;
      }
      if (name === 'w:tab') {
        out += '\t';
        return;
      }
      if (name === 'w:br' || name === 'w:cr') {
        out += '\n';
        return;
      }
      if (name === 'w:noBreakHyphen') {
        out += '-';
        return;
      }
      walk(child);
    });
  };
  walk(run);
  return out;
}

/**
 * Reads a Word (.docx) document straight out of its zip container and turns the
 * body XML into simple HTML: headings, bold/italic/underline, lists and tables.
 * No document library needed, so it also works completely offline.
 */
export async function docxToHtml(blob: Blob): Promise<string> {
  const index = readZipIndex(await blob.arrayBuffer());
  const documentEntry =
    index.entries.find((entry) => entry.path === 'word/document.xml') ||
    index.entries.find((entry) => /^(word\/)?document\.xml$/i.test(entry.path));
  if (!documentEntry) throw new Error('This document has no readable body.');

  const xml = new TextDecoder('utf-8').decode(await extractZipEntry(index, documentEntry));
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('This document could not be read.');

  const bodies = doc.getElementsByTagName('w:body');
  const body = bodies.length > 0 ? bodies[0] : doc.documentElement;
  const html: string[] = [];

  const renderParagraph = (paragraph: Element) => {
    const styleEl = paragraph.getElementsByTagName('w:pStyle')[0];
    const style = styleEl?.getAttribute('w:val') || '';
    let inner = '';
    tagElements(paragraph, 'w:r').forEach((run) => {
      const text = textOfRun(run);
      if (!text) return;
      let piece = escapeHtml(text).replace(/\n/g, '<br/>');
      if (run.getElementsByTagName('w:b').length > 0) piece = `<strong>${piece}</strong>`;
      if (run.getElementsByTagName('w:i').length > 0) piece = `<em>${piece}</em>`;
      if (run.getElementsByTagName('w:u').length > 0) piece = `<u>${piece}</u>`;
      inner += piece;
    });
    if (!inner.trim()) {
      html.push('<p class="my-2">&nbsp;</p>');
      return;
    }
    if (/Heading1/i.test(style)) html.push(`<h1 class="text-lg font-semibold mt-4 mb-1">${inner}</h1>`);
    else if (/Heading2/i.test(style)) html.push(`<h2 class="text-base font-semibold mt-3 mb-1">${inner}</h2>`);
    else if (/Heading3/i.test(style)) html.push(`<h3 class="text-sm font-semibold mt-3 mb-1">${inner}</h3>`);
    else if (paragraph.getElementsByTagName('w:numPr').length > 0)
      html.push(`<li class="ml-4 list-disc">${inner}</li>`);
    else html.push(`<p>${inner}</p>`);
  };

  const renderTable = (table: Element) => {
    const rows: string[] = [];
    tagElements(table, 'w:tr').forEach((row) => {
      const cells: string[] = [];
      tagElements(row, 'w:tc').forEach((cell) => {
        const text = tagElements(cell, 'w:p')
          .map((p) => textOfRun(p))
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim();
        cells.push(`<td class="border border-zinc-800 p-1 align-top">${escapeHtml(text)}</td>`);
      });
      rows.push(`<tr>${cells.join('')}</tr>`);
    });
    html.push(`<table class="w-full my-2 text-[12px]">${rows.join('')}</table>`);
  };

  Array.from(body.children).forEach((child) => {
    const name = child.nodeName;
    if (name === 'w:p') renderParagraph(child);
    else if (name === 'w:tbl') renderTable(child);
    else if (name === 'w:sdt') {
      const content = child.getElementsByTagName('w:sdtContent')[0];
      if (content) {
        Array.from(content.children).forEach((inner) => {
          if (inner.nodeName === 'w:p') renderParagraph(inner);
          else if (inner.nodeName === 'w:tbl') renderTable(inner);
        });
      }
    }
  });

  if (html.length === 0) throw new Error('This document appears to be empty.');
  return html.join('\n');
}

/* ---------------------------------------------------------------------------
 * Text & code viewing budget
 * ------------------------------------------------------------------------ */

/** Lines shown per page in the text/code viewer. */
export const TEXT_PAGE_LINES = 2000;

/** Counts lines without building an array (a 5 MB log stays cheap). */
export function countLines(text: string): number {
  let count = 1;
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) count += 1;
  }
  return count;
}

/**
 * Returns one window of lines plus the total count. Only the visible page is
 * ever rendered, so opening a 50 000 line file costs the same as a small one.
 */
export function lineWindow(
  text: string,
  startLine: number,
  count = TEXT_PAGE_LINES
): { lines: string[]; total: number; startLine: number } {
  const lines = text.split('\n');
  const total = lines.length;
  const safeStart = Math.max(0, Math.min(startLine, Math.max(0, total - 1)));
  return { lines: lines.slice(safeStart, safeStart + count), total, startLine: safeStart };
}

export interface TextMatch {
  line: number;
  text: string;
}

/** Simple case-insensitive find over the loaded text (first `limit` hits). */
export function findInText(text: string, query: string, limit = 200): TextMatch[] {
  const needle = query.trim().toLowerCase();
  if (needle.length < 2) return [];
  const matches: TextMatch[] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length && matches.length < limit; i += 1) {
    if (lines[i].toLowerCase().includes(needle)) {
      matches.push({ line: i + 1, text: lines[i].slice(0, 400) });
    }
  }
  return matches;
}

/* ---------------------------------------------------------------------------
 * PPTX presentations
 * ------------------------------------------------------------------------ */

export interface SlidePreview {
  /** 1-based slide number as stored in the container. */
  index: number;
  title: string;
  lines: string[];
}

/** Upper bound on slides we will pull out of one deck. */
export const MAX_SLIDES = 400;

const slideNumber = (path: string): number => {
  const match = path.match(/(\d+)\.xml$/);
  return match ? parseInt(match[1], 10) : 0;
};

/**
 * Reads a .pptx deck slide by slide. Only the text runs are read — no layout,
 * no images — which keeps a 200 slide deck instant and memory-tiny.
 */
export async function pptxToSlides(blob: Blob, maxSlides = MAX_SLIDES): Promise<SlidePreview[]> {
  const index = readZipIndex(await blob.arrayBuffer());
  const slideEntries = index.entries
    .filter((entry) => /^ppt\/slides\/slide\d+\.xml$/.test(entry.path))
    .sort((a, b) => slideNumber(a.path) - slideNumber(b.path))
    .slice(0, maxSlides);

  if (slideEntries.length === 0) {
    throw new Error('This presentation has no readable slides.');
  }

  const parser = new DOMParser();
  const decoder = new TextDecoder('utf-8');
  const slides: SlidePreview[] = [];

  for (const entry of slideEntries) {
    const xml = decoder.decode(await extractZipEntry(index, entry));
    const doc = parser.parseFromString(xml, 'application/xml');
    const lines: string[] = [];

    // Paragraphs come in document order, so the text keeps the slide order.
    const paragraphs = Array.from(doc.getElementsByTagName('a:p'));
    for (const paragraph of paragraphs) {
      let line = '';
      for (const run of Array.from(paragraph.getElementsByTagName('a:t'))) {
        line += run.textContent || '';
      }
      const clean = line.replace(/\s+/g, ' ').trim();
      if (clean) lines.push(clean);
    }

    const number = slideNumber(entry.path);
    slides.push({
      index: number,
      title: lines[0] || `Slide ${number}`,
      lines: lines.slice(1),
    });
  }

  return slides;
}

/* ---------------------------------------------------------------------------
 * Spreadsheets (.xlsx, .csv, .tsv)
 * ------------------------------------------------------------------------ */

export interface SheetPreview {
  name: string;
  rows: string[][];
  /** True when the sheet had more rows/columns than we render. */
  truncated: boolean;
}

/** Rows rendered at once in the sheet view. */
export const MAX_SHEET_ROWS = 400;
/** Columns rendered at once (wide tables scroll but stay bounded). */
export const MAX_SHEET_COLS = 40;

const columnIndex = (ref: string): number => {
  let value = 0;
  for (let i = 0; i < ref.length; i += 1) {
    const code = ref.charCodeAt(i);
    if (code < 65 || code > 90) break;
    value = value * 26 + (code - 64);
  }
  return Math.max(0, value - 1);
};

/** Reads the first worksheet of an .xlsx workbook as a plain table. */
export async function xlsxToTable(
  blob: Blob,
  maxRows = MAX_SHEET_ROWS,
  maxCols = MAX_SHEET_COLS
): Promise<SheetPreview> {
  const index = readZipIndex(await blob.arrayBuffer());
  const parser = new DOMParser();
  const decoder = new TextDecoder('utf-8');

  const readEntry = async (path: string): Promise<string | null> => {
    const entry = index.entries.find((item) => item.path === path);
    if (!entry) return null;
    return decoder.decode(await extractZipEntry(index, entry));
  };

  // Cell text usually lives in the shared string table.
  const shared: string[] = [];
  const sharedXml = await readEntry('xl/sharedStrings.xml');
  if (sharedXml) {
    const doc = parser.parseFromString(sharedXml, 'application/xml');
    for (const item of Array.from(doc.getElementsByTagName('si'))) {
      let text = '';
      for (const run of Array.from(item.getElementsByTagName('t'))) {
        text += run.textContent || '';
      }
      shared.push(text);
    }
  }

  // Sheet name, from the workbook index.
  let name = 'Sheet 1';
  const workbookXml = await readEntry('xl/workbook.xml');
  if (workbookXml) {
    const doc = parser.parseFromString(workbookXml, 'application/xml');
    const first = doc.getElementsByTagName('sheet')[0];
    const label = first?.getAttribute('name');
    if (label) name = label;
  }

  const sheetPath =
    ['xl/worksheets/sheet1.xml'].find((path) =>
      index.entries.some((entry) => entry.path === path)
    ) || index.entries.find((entry) => /^xl\/worksheets\/.*\.xml$/.test(entry.path))?.path;

  if (!sheetPath) throw new Error('This workbook has no readable sheet.');
  const sheetXml = await readEntry(sheetPath);
  if (!sheetXml) throw new Error('This workbook has no readable sheet.');

  const doc = parser.parseFromString(sheetXml, 'application/xml');
  const rowElements = Array.from(doc.getElementsByTagName('row'));
  const rows: string[][] = [];
  let truncated = rowElements.length > maxRows;

  for (const rowEl of rowElements.slice(0, maxRows)) {
    const cells: string[] = [];
    for (const cell of Array.from(rowEl.getElementsByTagName('c'))) {
      const ref = cell.getAttribute('r') || '';
      const at = ref ? columnIndex(ref) : cells.length;
      if (at >= maxCols) {
        truncated = true;
        continue;
      }
      const type = cell.getAttribute('t');
      let value = '';
      if (type === 's') {
        const raw = cell.getElementsByTagName('v')[0]?.textContent || '';
        value = shared[parseInt(raw, 10)] || '';
      } else if (type === 'inlineStr') {
        for (const text of Array.from(cell.getElementsByTagName('t'))) {
          value += text.textContent || '';
        }
      } else {
        value = cell.getElementsByTagName('v')[0]?.textContent || '';
      }
      while (cells.length < at) cells.push('');
      cells[at] = value;
    }
    rows.push(cells);
  }

  if (rows.length === 0) throw new Error('This sheet appears to be empty.');
  return { name, rows, truncated };
}

/** Splits delimited text (CSV/TSV) into rows, honouring quoted fields. */
export function delimitedToTable(
  text: string,
  delimiter: string,
  maxRows = MAX_SHEET_ROWS,
  maxCols = MAX_SHEET_COLS
): SheetPreview {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let quoted = false;
  let truncated = false;

  const pushField = () => {
    if (row.length < maxCols) row.push(field);
    else truncated = true;
    field = '';
  };
  const pushRow = () => {
    pushField();
    if (rows.length < maxRows) rows.push(row);
    else truncated = true;
    row = [];
  };

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      pushField();
    } else if (char === '\n') {
      pushRow();
    } else if (char !== '\r') {
      field += char;
    }
  }
  if (field.length > 0 || row.length > 0) pushRow();

  // Drop fully empty trailing rows.
  while (rows.length > 0 && rows[rows.length - 1].every((cell) => cell === '')) rows.pop();
  if (rows.length === 0) throw new Error('This file has no rows to show.');
  return { name: 'Table', rows, truncated };
}

/** Legacy binary Office/Outlook containers that cannot be read in a browser. */
export function legacyOfficeNotice(name: string): string | null {
  const ext = fileExtension(name);
  if (ext === 'doc' || ext === 'ppt' || ext === 'xls' || ext === 'msg') {
    return `“.${ext}” is the old binary Office format, which has no text layer a browser can read. Download the file to open it, or ask for the modern .${
      ext === 'msg' ? 'eml' : ext + 'x'
    } version.`;
  }
  return null;
}
