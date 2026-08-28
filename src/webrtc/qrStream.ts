import QRCode from 'qrcode';
import jsQR from 'jsqr';

export interface QrChunk {
  index: number;
  total: number;
  data: string;
}

export function encodeToQrChunks(rawText: string, maxChunkSize = 380): string[] {
  if (rawText.length <= maxChunkSize) {
    return [rawText];
  }

  const total = Math.ceil(rawText.length / maxChunkSize);
  const chunks: string[] = [];

  for (let i = 0; i < total; i++) {
    const slice = rawText.slice(i * maxChunkSize, (i + 1) * maxChunkSize);
    chunks.push(`sChat:${i + 1}/${total}:${slice}`);
  }

  return chunks;
}

export class QrChunkCollector {
  private chunks: Map<number, string> = new Map();
  private expectedTotal = 0;

  public reset() {
    this.chunks.clear();
    this.expectedTotal = 0;
  }

  public processScannedText(text: string): { completed: boolean; fullPayload?: string; progress: string } {
    // Check if chunked format: sChat:X/Y:PAYLOAD
    if (text.startsWith('sChat:')) {
      const parts = text.split(':');
      if (parts.length >= 3) {
        const countInfo = parts[1].split('/');
        const currentIdx = parseInt(countInfo[0], 10);
        const total = parseInt(countInfo[1], 10);
        const payload = parts.slice(2).join(':');

        if (this.expectedTotal > 0 && this.expectedTotal !== total) {
          // New sequence started
          this.chunks.clear();
        }

        this.expectedTotal = total;
        this.chunks.set(currentIdx, payload);

        if (this.chunks.size >= total) {
          // Reassemble in order
          let full = '';
          for (let i = 1; i <= total; i++) {
            full += this.chunks.get(i) || '';
          }
          this.reset();
          return { completed: true, fullPayload: full, progress: `${total}/${total}` };
        }

        return {
          completed: false,
          progress: `${this.chunks.size}/${total} chunks scanned`,
        };
      }
    }

    // Direct non-chunked single QR code (e.g. raw JSON or compact SDP)
    if (text.startsWith('{') && text.endsWith('}')) {
      return { completed: true, fullPayload: text, progress: '1/1' };
    }

    return { completed: false, progress: 'Scanning...' };
  }
}

export async function renderQrCode(canvas: HTMLCanvasElement, text: string): Promise<void> {
  await QRCode.toCanvas(canvas, text, {
    errorCorrectionLevel: 'M',
    margin: 2,
    scale: 6,
    color: {
      dark: '#000000',
      light: '#FFFFFF',
    },
  });
}

export async function generateQrDataUrl(text: string): Promise<string> {
  return QRCode.toDataURL(text, {
    errorCorrectionLevel: 'M',
    margin: 2,
    scale: 6,
    color: {
      dark: '#000000',
      light: '#FFFFFF',
    },
  });
}

export function scanCanvasForQr(canvas: HTMLCanvasElement): string | null {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const code = jsQR(imgData.data, imgData.width, imgData.height, {
    inversionAttempts: 'attemptBoth',
  });
  return code ? code.data : null;
}

export function extractRoomCodeFromScannedText(text: string): string | null {
  if (!text) return null;
  const trimmed = text.trim();

  // 1. Direct 6-character code
  if (/^[A-Z0-9]{6}$/i.test(trimmed)) {
    return trimmed.toUpperCase();
  }

  // 2. JSON payload
  try {
    const obj = JSON.parse(trimmed);
    if (obj && typeof obj.room === 'string' && /^[A-Z0-9]{6}$/i.test(obj.room.trim())) {
      return obj.room.trim().toUpperCase();
    }
  } catch {}

  // 3. URL parameter or hash
  const urlMatch = trimmed.match(/[?&#/]room[=/]([A-Z0-9]{6})/i);
  if (urlMatch && urlMatch[1]) {
    return urlMatch[1].toUpperCase();
  }

  // 4. Custom protocol scryptchat:CODE
  const scryptMatch = trimmed.match(/scryptchat:([A-Z0-9]{6})/i);
  if (scryptMatch && scryptMatch[1]) {
    return scryptMatch[1].toUpperCase();
  }

  return null;
}
