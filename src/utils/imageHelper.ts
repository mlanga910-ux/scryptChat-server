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

export async function fileToAvatarDataUrl(
  file: File,
  maxDim = AVATAR_MAX_DIM
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
        if (dataUrl.length > AVATAR_MAX_CHARS) dataUrl = encode(180, 0.72);
        if (dataUrl.length > AVATAR_MAX_CHARS) dataUrl = encode(128, 0.6);

        resolve(dataUrl || String(event.target?.result || ''));
      };
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = event.target?.result as string;
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}
