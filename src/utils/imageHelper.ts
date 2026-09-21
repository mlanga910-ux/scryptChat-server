/**
 * Compresses and converts an image File into a lightweight Base64 Data URL
 * suitable for profile avatars and group icons.
 *
 * Avatars are sent to every contact, so they are kept small enough to travel
 * over a data channel in a couple of frames. Images with transparency are
 * encoded as WebP instead of JPEG so they never gain a dark background.
 */

const AVATAR_MAX_DIM = 256;
/** Above this the image is re-encoded smaller (data URL characters). */
const AVATAR_MAX_CHARS = 90000;

/** Chat previews: big enough to read the photo, small enough to travel in one frame. */
const PREVIEW_MAX_DIM = 720;
/** Roughly a 120 KB thumbnail once base64 overhead is counted. */
const PREVIEW_MAX_CHARS = 160000;

/**
 * A small inline preview of a photo, as a data URL.
 *
 * It is sent alongside the attachment so the receiver can show the picture
 * immediately — blurred and labelled while the real bytes are still on their
 * way — instead of a loading box. Never throws: a browser that cannot encode
 * simply contributes no preview.
 */
export async function fileToImagePreviewDataUrl(file: File): Promise<string | undefined> {
  try {
    if (!file.type.startsWith('image/') || file.type === 'image/gif') return undefined;
    // Skip anything with pixels this cheap: the file itself is already tiny.
    if (file.size > 24 * 1024 * 1024) return undefined;
    const dataUrl = await fileToAvatarDataUrl(file, PREVIEW_MAX_DIM, PREVIEW_MAX_CHARS);
    return dataUrl && dataUrl.startsWith('data:image/') ? dataUrl : undefined;
  } catch {
    return undefined;
  }
}

export async function fileToAvatarDataUrl(
  file: File,
  maxDim = AVATAR_MAX_DIM,
  maxChars = AVATAR_MAX_CHARS
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const keepAlpha =
          file.type === 'image/png' ||
          file.type === 'image/gif' ||
          file.type === 'image/webp' ||
          file.type === 'image/avif';
        const outputType = keepAlpha ? 'image/webp' : 'image/jpeg';

        const encode = (limit: number, quality: number): string => {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;

          if (width >= height && width > limit) {
            height = Math.round((height * limit) / width);
            width = limit;
          } else if (height > width && height > limit) {
            width = Math.round((width * limit) / height);
            height = limit;
          }

          canvas.width = Math.max(1, width);
          canvas.height = Math.max(1, height);
          const ctx = canvas.getContext('2d');
          if (!ctx) return String(event.target?.result || '');
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          try {
            return canvas.toDataURL(outputType, quality);
          } catch {
            return canvas.toDataURL('image/jpeg', quality);
          }
        };

        let dataUrl = encode(maxDim, keepAlpha ? 0.85 : 0.82);
        if (dataUrl.length > maxChars) {
          dataUrl = encode(Math.round(maxDim * 0.7), 0.72);
        }
        if (dataUrl.length > maxChars) {
          dataUrl = encode(Math.round(maxDim * 0.5), 0.6);
        }
        if (dataUrl.length > maxChars) {
          dataUrl = encode(128, 0.5);
        }

        resolve(dataUrl || String(event.target?.result || ''));
      };
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = event.target?.result as string;
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}
