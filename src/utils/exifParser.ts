import * as exifr from 'exifr';
import { ImageExifData } from '../types/index';

export async function extractImageExif(fileOrBlob: Blob | File): Promise<ImageExifData> {
  const result: ImageExifData = {};

  try {
    // Parse comprehensive EXIF tags including TIFF, EXIF, GPS, Interop
    const parsed = await exifr.parse(fileOrBlob, {
      tiff: true,
      xmp: true,
      icc: true,
      iptc: true,
      jfif: true,
      ihdr: true,
      gps: true,
      translateKeys: true,
      translateValues: true,
      reviveValues: true,
    });

    if (!parsed) return result;

    result.make = parsed.Make;
    result.model = parsed.Model;
    result.lensModel = parsed.LensModel || parsed.LensInfo;
    result.dateTimeOriginal = parsed.DateTimeOriginal
      ? new Date(parsed.DateTimeOriginal).toLocaleString()
      : parsed.CreateDate
      ? new Date(parsed.CreateDate).toLocaleString()
      : undefined;

    result.exposureTime = parsed.ExposureTime ? `1/${Math.round(1 / parsed.ExposureTime)}s` : undefined;
    result.fNumber = parsed.FNumber ? Number(parsed.FNumber.toFixed(1)) : undefined;
    result.iso = parsed.ISO || parsed.ISOSpeedRatings;
    result.focalLength = parsed.FocalLength ? Math.round(parsed.FocalLength) : undefined;
    result.imageWidth = parsed.ImageWidth || parsed.ExifImageWidth;
    result.imageHeight = parsed.ImageHeight || parsed.ExifImageHeight;
    result.colorSpace = parsed.ColorSpace === 1 ? 'sRGB' : parsed.ColorSpace === 65535 ? 'Uncalibrated' : String(parsed.ColorSpace || '');
    result.flash = parsed.Flash;
    result.software = parsed.Software;

    if (parsed.latitude !== undefined && parsed.longitude !== undefined) {
      result.latitude = Number(parsed.latitude.toFixed(6));
      result.longitude = Number(parsed.longitude.toFixed(6));
      result.altitude = parsed.altitude ? Number(parsed.altitude.toFixed(1)) : undefined;
      result.gpsFormatted = `${result.latitude}°, ${result.longitude}°`;
    }

    result.rawTags = parsed;
  } catch (err) {
    console.warn('EXIF extraction skipped or unavailable:', err);
  }

  // Also calculate image dimensions from Image element if missing
  if ((!result.imageWidth || !result.imageHeight) && fileOrBlob.type.startsWith('image/')) {
    try {
      const dimensions = await getImageDimensions(fileOrBlob);
      result.imageWidth = dimensions.width;
      result.imageHeight = dimensions.height;
    } catch {}
  }

  return result;
}

function getImageDimensions(blob: Blob): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Image dimension read error'));
    };
    img.src = url;
  });
}
