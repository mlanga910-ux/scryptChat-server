import React from 'react';
import { FileRecord, ImageExifData } from '../types/index';
import {
  X,
  Camera,
  MapPin,
  Layers,
  Download,
  Info,
  HardDrive,
} from 'lucide-react';

interface ImageExifModalProps {
  isOpen: boolean;
  fileRecord: FileRecord | null;
  blobUrl?: string;
  onClose: () => void;
}

export const ImageExifModal: React.FC<ImageExifModalProps> = ({
  isOpen,
  fileRecord,
  blobUrl,
  onClose,
}) => {
  if (!isOpen || !fileRecord) return null;

  const exif: ImageExifData = fileRecord.exifData || {};
  const hasGps = exif.latitude !== undefined && exif.longitude !== undefined;
  const mapUrl = hasGps
    ? `https://www.openstreetmap.org/?mlat=${exif.latitude}&mlon=${exif.longitude}#map=16/${exif.latitude}/${exif.longitude}`
    : undefined;

  return (
    <div
      id="exif-modal-backdrop"
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 select-none font-sans"
    >
      <div className="w-full max-w-4xl bg-[#18181b] border border-[#27272a] rounded-2xl shadow-xl flex flex-col max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-[#27272a] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-[#09090b] border border-[#27272a] flex items-center justify-center text-white">
              <Info className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-xs font-semibold text-white tracking-tight">
                Image Details &amp; EXIF Metadata
              </h2>
              <p className="text-[11px] text-[#71717a] truncate max-w-xs sm:max-w-md">
                {fileRecord.name}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {blobUrl && (
              <a
                id="exif-download-btn"
                href={blobUrl}
                download={fileRecord.name}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-neutral-200 text-black text-xs font-semibold rounded-lg transition-colors shadow-sm"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download</span>
              </a>
            )}
            <button
              id="close-exif-modal-btn"
              onClick={onClose}
              className="p-1.5 text-[#71717a] hover:text-white hover:bg-[#27272a] rounded-lg transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content Body: Split between High-Res Image Preview and Metadata Grid */}
        <div className="flex-1 overflow-y-auto grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-[#27272a]">
          {/* Left Column: Visual Image Stage */}
          <div className="lg:col-span-6 p-5 flex flex-col items-center justify-center bg-[#09090b]">
            <div className="relative max-w-full max-h-[380px] rounded-xl overflow-hidden border border-[#27272a] bg-black/60 shadow-inner flex items-center justify-center">
              {blobUrl ? (
                <img
                  src={blobUrl}
                  alt={fileRecord.name}
                  className="max-h-[360px] w-auto object-contain select-none"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="p-12 text-[#71717a] text-xs font-mono">
                  Loading image preview...
                </div>
              )}
            </div>

            <div className="mt-3 text-center text-xs text-[#a1a1aa] font-mono flex items-center gap-3">
              <span>{exif.imageWidth && exif.imageHeight ? `${exif.imageWidth} × ${exif.imageHeight} px` : fileRecord.mimeType}</span>
              <span>•</span>
              <span>{(fileRecord.size / (1024 * 1024)).toFixed(2)} MB</span>
            </div>
          </div>

          {/* Right Column: EXIF & File Details */}
          <div className="lg:col-span-6 p-5 space-y-3 bg-[#18181b] overflow-y-auto text-xs">
            {/* Camera & Lens Specs */}
            <div className="p-3 rounded-xl bg-[#09090b] border border-[#27272a] space-y-2">
              <div className="flex items-center gap-2 text-white font-medium text-xs">
                <Camera className="w-3.5 h-3.5 text-white" />
                <span>Camera &amp; Optics</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-[#a1a1aa]">
                <div>
                  <span className="text-[#71717a] block text-[11px]">Camera Device</span>
                  <span className="text-white font-medium">
                    {exif.make || exif.model ? `${exif.make || ''} ${exif.model || ''}`.trim() : 'Unknown'}
                  </span>
                </div>
                <div>
                  <span className="text-[#71717a] block text-[11px]">Lens Model</span>
                  <span className="text-white">
                    {exif.lensModel || 'Standard Lens'}
                  </span>
                </div>
                <div>
                  <span className="text-[#71717a] block text-[11px]">Aperture</span>
                  <span className="text-white">{exif.fNumber ? `f/${exif.fNumber}` : '—'}</span>
                </div>
                <div>
                  <span className="text-[#71717a] block text-[11px]">Shutter Speed</span>
                  <span className="text-white">{exif.exposureTime || '—'}</span>
                </div>
                <div>
                  <span className="text-[#71717a] block text-[11px]">ISO Speed</span>
                  <span className="text-white">{exif.iso || '—'}</span>
                </div>
                <div>
                  <span className="text-[#71717a] block text-[11px]">Focal Length</span>
                  <span className="text-white">{exif.focalLength ? `${exif.focalLength} mm` : '—'}</span>
                </div>
              </div>
            </div>

            {/* Date, Color, Dimensions */}
            <div className="p-3 rounded-xl bg-[#09090b] border border-[#27272a] space-y-2">
              <div className="flex items-center gap-2 text-white font-medium text-xs">
                <Layers className="w-3.5 h-3.5 text-white" />
                <span>Capture Attributes</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-[#a1a1aa]">
                <div>
                  <span className="text-[#71717a] block text-[11px]">Date &amp; Time Taken</span>
                  <span className="text-white">{exif.dateTimeOriginal || 'Not recorded'}</span>
                </div>
                <div>
                  <span className="text-[#71717a] block text-[11px]">Dimensions</span>
                  <span className="text-white">
                    {exif.imageWidth && exif.imageHeight
                      ? `${exif.imageWidth} × ${exif.imageHeight} (${((exif.imageWidth * exif.imageHeight) / 1000000).toFixed(1)} MP)`
                      : 'Auto calculated'}
                  </span>
                </div>
                <div>
                  <span className="text-[#71717a] block text-[11px]">Color Space</span>
                  <span className="text-white">{exif.colorSpace || 'sRGB'}</span>
                </div>
                <div>
                  <span className="text-[#71717a] block text-[11px]">Software / Editor</span>
                  <span className="text-white">{exif.software || 'Camera firmware'}</span>
                </div>
              </div>
            </div>

            {/* GPS Geolocation if available */}
            {hasGps && (
              <div className="p-3 rounded-xl bg-[#09090b] border border-[#27272a] space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-white font-medium text-xs">
                    <MapPin className="w-3.5 h-3.5 text-red-400" />
                    <span>GPS Coordinates</span>
                  </div>
                  {mapUrl && (
                    <a
                      href={mapUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[11px] text-[#a1a1aa] hover:text-white underline"
                    >
                      Open in Map
                    </a>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2 text-[#a1a1aa]">
                  <div>
                    <span className="text-[#71717a] block text-[11px]">Latitude</span>
                    <span className="text-white font-mono">{exif.latitude}°</span>
                  </div>
                  <div>
                    <span className="text-[#71717a] block text-[11px]">Longitude</span>
                    <span className="text-white font-mono">{exif.longitude}°</span>
                  </div>
                  {exif.altitude !== undefined && (
                    <div>
                      <span className="text-[#71717a] block text-[11px]">Altitude</span>
                      <span className="text-white">{exif.altitude} meters</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Cryptographic Integrity */}
            <div className="p-3 rounded-xl bg-[#09090b] border border-[#27272a] space-y-1 font-mono text-[11px]">
              <div className="flex items-center gap-2 text-white font-sans font-medium text-xs">
                <HardDrive className="w-3.5 h-3.5 text-emerald-400" />
                <span>Cryptographic Digest</span>
              </div>
              <div className="text-[#71717a]">SHA-256 Checksum:</div>
              <div className="text-[#a1a1aa] break-all bg-[#18181b] p-2 rounded border border-[#27272a]">
                {fileRecord.hashSHA256}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

