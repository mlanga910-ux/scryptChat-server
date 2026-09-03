import React, { useState, useEffect, useRef, useCallback } from 'react';
import { FileRecord, ImageExifData, MessageRecord } from '../types/index';
import {
  X,
  ZoomIn,
  ZoomOut,
  RotateCw,
  Maximize2,
  Download,
  Info,
  Camera,
  Layers,
  MapPin,
  HardDrive,
  Copy,
  Check,
  Calendar,
  User,
  ShieldCheck,
} from 'lucide-react';

interface ImageViewerModalProps {
  isOpen: boolean;
  fileRecord: FileRecord | null;
  blobUrl?: string;
  message?: MessageRecord | null;
  onClose: () => void;
}

export const ImageViewerModal: React.FC<ImageViewerModalProps> = ({
  isOpen,
  fileRecord,
  blobUrl,
  message,
  onClose,
}) => {
  const [scale, setScale] = useState<number>(1);
  const [rotation, setRotation] = useState<number>(0);
  const [position, setPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [showInfo, setShowInfo] = useState<boolean>(false);
  const [copiedHash, setCopiedHash] = useState<boolean>(false);
  const [naturalDimensions, setNaturalDimensions] = useState<{ width: number; height: number } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const touchStartDistRef = useRef<number | null>(null);
  const touchStartScaleRef = useRef<number>(1);

  // Reset state when opening a new image
  useEffect(() => {
    if (isOpen) {
      setScale(1);
      setRotation(0);
      setPosition({ x: 0, y: 0 });
      setShowInfo(false);
      setCopiedHash(false);
    }
  }, [isOpen, fileRecord?.fileId]);

  // Handle ESC key to close
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showInfo) {
          setShowInfo(false);
        } else {
          onClose();
        }
      } else if (e.key === '+' || e.key === '=') {
        handleZoomIn();
      } else if (e.key === '-') {
        handleZoomOut();
      } else if (e.key === '0') {
        handleResetZoom();
      } else if (e.key === 'r' || e.key === 'R') {
        handleRotate();
      } else if (e.key === 'i' || e.key === 'I') {
        setShowInfo((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, showInfo, onClose]);

  const handleZoomIn = () => {
    setScale((prev) => Math.min(prev + 0.35, 5));
  };

  const handleZoomOut = () => {
    setScale((prev) => {
      const next = Math.max(prev - 0.35, 0.4);
      if (next <= 1) {
        setPosition({ x: 0, y: 0 });
      }
      return next;
    });
  };

  const handleResetZoom = () => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
    setRotation(0);
  };

  const handleSetActualSize = () => {
    setScale(2);
    setPosition({ x: 0, y: 0 });
  };

  const handleRotate = () => {
    setRotation((prev) => (prev + 90) % 360);
  };

  // Wheel zoom centered on cursor
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY * -0.0015;
    setScale((prev) => {
      const next = Math.min(Math.max(prev + delta, 0.4), 5);
      if (next <= 1) {
        setPosition({ x: 0, y: 0 });
      }
      return next;
    });
  };

  // Double click to toggle 2x / fit
  const handleDoubleClick = () => {
    if (scale > 1.2) {
      handleResetZoom();
    } else {
      setScale(2.2);
    }
  };

  // Mouse drag pan
  const handleMouseDown = (e: React.MouseEvent) => {
    if (scale <= 1) return;
    setIsDragging(true);
    setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || scale <= 1) return;
    setPosition({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y,
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // Touch drag & pinch-to-zoom
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      if (scale > 1) {
        setIsDragging(true);
        setDragStart({
          x: e.touches[0].clientX - position.x,
          y: e.touches[0].clientY - position.y,
        });
      }
    } else if (e.touches.length === 2) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      touchStartDistRef.current = dist;
      touchStartScaleRef.current = scale;
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 1 && isDragging && scale > 1) {
      setPosition({
        x: e.touches[0].clientX - dragStart.x,
        y: e.touches[0].clientY - dragStart.y,
      });
    } else if (e.touches.length === 2 && touchStartDistRef.current !== null) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const ratio = dist / touchStartDistRef.current;
      const nextScale = Math.min(Math.max(touchStartScaleRef.current * ratio, 0.5), 5);
      setScale(nextScale);
      if (nextScale <= 1) {
        setPosition({ x: 0, y: 0 });
      }
    }
  };

  const handleTouchEnd = () => {
    setIsDragging(false);
    touchStartDistRef.current = null;
  };

  const copyHash = () => {
    if (!fileRecord?.hashSHA256) return;
    navigator.clipboard.writeText(fileRecord.hashSHA256);
    setCopiedHash(true);
    setTimeout(() => setCopiedHash(false), 2000);
  };

  if (!isOpen || !fileRecord) return null;

  const exif: ImageExifData = fileRecord.exifData || {};
  const hasGps = exif.latitude !== undefined && exif.longitude !== undefined;
  const mapUrl = hasGps
    ? `https://www.openstreetmap.org/?mlat=${exif.latitude}&mlon=${exif.longitude}#map=16/${exif.latitude}/${exif.longitude}`
    : undefined;

  const formattedSize = fileRecord.size
    ? fileRecord.size > 1024 * 1024
      ? `${(fileRecord.size / (1024 * 1024)).toFixed(2)} MB`
      : `${(fileRecord.size / 1024).toFixed(1)} KB`
    : 'Unknown';

  const width = exif.imageWidth || naturalDimensions?.width;
  const height = exif.imageHeight || naturalDimensions?.height;

  return (
    <div
      id="fullscreen-image-viewer"
      className="fixed inset-0 z-50 bg-[#09090b]/95 backdrop-blur-xl flex flex-col select-none font-sans overflow-hidden animate-in fade-in duration-200"
    >
      {/* Top Header Bar */}
      <div className="h-14 px-4 sm:px-6 bg-[#101014]/90 border-b border-[#27272a] flex items-center justify-between shrink-0 z-20">
        {/* Left: Close & Filename */}
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={onClose}
            className="p-2 text-[#a1a1aa] hover:text-white hover:bg-[#27272a] rounded-xl transition-colors cursor-pointer"
            title="Close (Esc)"
          >
            <X className="w-5 h-5" />
          </button>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-white truncate max-w-[200px] sm:max-w-md">
              {fileRecord.name}
            </h3>
            <p className="text-[11px] text-[#71717a] font-mono truncate">
              {formattedSize} {width && height ? `• ${width} × ${height} px` : ''}
            </p>
          </div>
        </div>

        {/* Center: Quick Zoom & Action Indicators (Desktop) */}
        <div className="hidden md:flex items-center gap-1 bg-[#18181b] border border-[#27272a] rounded-xl p-1">
          <button
            onClick={handleZoomOut}
            disabled={scale <= 0.4}
            className="p-1.5 text-[#a1a1aa] hover:text-white hover:bg-[#27272a] disabled:opacity-30 rounded-lg transition-colors cursor-pointer"
            title="Zoom Out (-)"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <span className="text-xs font-mono font-medium text-white px-2 min-w-[50px] text-center">
            {Math.round(scale * 100)}%
          </span>
          <button
            onClick={handleZoomIn}
            disabled={scale >= 5}
            className="p-1.5 text-[#a1a1aa] hover:text-white hover:bg-[#27272a] disabled:opacity-30 rounded-lg transition-colors cursor-pointer"
            title="Zoom In (+)"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          <div className="w-[1px] h-4 bg-[#27272a] mx-0.5" />
          <button
            onClick={handleResetZoom}
            className="px-2 py-1 text-[11px] font-medium text-[#a1a1aa] hover:text-white hover:bg-[#27272a] rounded-lg transition-colors cursor-pointer"
            title="Fit to Window (0)"
          >
            Fit
          </button>
          <button
            onClick={handleSetActualSize}
            className="px-2 py-1 text-[11px] font-medium text-[#a1a1aa] hover:text-white hover:bg-[#27272a] rounded-lg transition-colors cursor-pointer"
            title="100% / 2x"
          >
            100%
          </button>
          <div className="w-[1px] h-4 bg-[#27272a] mx-0.5" />
          <button
            onClick={handleRotate}
            className="p-1.5 text-[#a1a1aa] hover:text-white hover:bg-[#27272a] rounded-lg transition-colors cursor-pointer"
            title="Rotate 90° (R)"
          >
            <RotateCw className="w-4 h-4" />
          </button>
        </div>

        {/* Right: Info Drawer Toggle & Download */}
        <div className="flex items-center gap-2">
          {/* Info Toggle */}
          <button
            onClick={() => setShowInfo(!showInfo)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all cursor-pointer ${
              showInfo
                ? 'bg-blue-600 border-blue-500 text-white shadow-sm'
                : 'bg-[#18181b] border-[#27272a] text-[#d4d4d8] hover:text-white hover:bg-[#27272a]'
            }`}
            title="Image Info & EXIF (I)"
          >
            <Info className="w-4 h-4" />
            <span className="hidden sm:inline">Info</span>
          </button>

          {/* Download Button */}
          {blobUrl && (
            <a
              href={blobUrl}
              download={fileRecord.name}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-neutral-200 text-black text-xs font-semibold rounded-xl transition-all shadow-sm active:scale-95 cursor-pointer"
              title="Download Original Image"
            >
              <Download className="w-4 h-4" />
              <span>Download</span>
            </a>
          )}
        </div>
      </div>

      {/* Main Viewport & Optional Info Sidebar */}
      <div className="flex-1 min-h-0 relative flex overflow-hidden">
        {/* Interactive Canvas Stage */}
        <div
          ref={containerRef}
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onDoubleClick={handleDoubleClick}
          className={`flex-1 h-full flex items-center justify-center p-4 relative overflow-hidden ${
            scale > 1 ? 'cursor-grab active:cursor-grabbing' : 'cursor-zoom-in'
          }`}
        >
          {blobUrl ? (
            <div
              className="transition-transform duration-75 ease-out select-none inline-block max-w-full max-h-full"
              style={{
                transform: `translate(${position.x}px, ${position.y}px) scale(${scale}) rotate(${rotation}deg)`,
                transformOrigin: 'center center',
              }}
            >
              <img
                src={blobUrl}
                alt={fileRecord.name}
                onLoad={(e) => {
                  const img = e.currentTarget;
                  setNaturalDimensions({ width: img.naturalWidth, height: img.naturalHeight });
                }}
                className="max-w-[90vw] max-h-[80vh] md:max-w-[85vw] md:max-h-[82vh] object-contain rounded-lg shadow-2xl pointer-events-none"
                draggable={false}
              />
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center text-[#71717a] text-sm">
              <HardDrive className="w-8 h-8 mb-2 animate-pulse" />
              <span>Loading encrypted image data...</span>
            </div>
          )}

          {/* Floating Mobile Controls Pill */}
          <div className="flex md:hidden absolute bottom-5 left-1/2 -translate-x-1/2 z-20 items-center gap-1 bg-[#18181b]/90 backdrop-blur-md border border-[#27272a] rounded-full p-1.5 shadow-2xl">
            <button
              onClick={handleZoomOut}
              className="p-2 text-[#a1a1aa] hover:text-white rounded-full"
              title="Zoom Out"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <span className="text-xs font-mono font-medium text-white px-1.5">
              {Math.round(scale * 100)}%
            </span>
            <button
              onClick={handleZoomIn}
              className="p-2 text-[#a1a1aa] hover:text-white rounded-full"
              title="Zoom In"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
            <div className="w-[1px] h-4 bg-[#27272a] mx-0.5" />
            <button
              onClick={handleRotate}
              className="p-2 text-[#a1a1aa] hover:text-white rounded-full"
              title="Rotate"
            >
              <RotateCw className="w-4 h-4" />
            </button>
            <button
              onClick={handleResetZoom}
              className="px-2.5 py-1 text-xs font-semibold text-[#a1a1aa] hover:text-white rounded-full"
              title="Reset"
            >
              Reset
            </button>
          </div>
        </div>

        {/* Sliding Info / EXIF Details Drawer */}
        {showInfo && (
          <aside className="w-full sm:w-88 md:w-96 h-full bg-[#101014] border-l border-[#27272a] flex flex-col z-30 shadow-2xl animate-in slide-in-from-right duration-200 overflow-y-auto">
            <div className="p-4 border-b border-[#27272a] flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <Info className="w-4 h-4 text-blue-400" />
                <h4 className="text-sm font-semibold text-white">Image Information</h4>
              </div>
              <button
                onClick={() => setShowInfo(false)}
                className="p-1.5 text-[#71717a] hover:text-white hover:bg-[#18181b] rounded-lg transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-4 text-xs text-[#a1a1aa]">
              {/* File Specs Box */}
              <div className="p-3 bg-[#18181b] border border-[#27272a] rounded-xl space-y-2">
                <div className="flex items-center gap-2 text-white font-medium">
                  <HardDrive className="w-3.5 h-3.5 text-blue-400" />
                  <span>File Specifications</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[11px] pt-1">
                  <div>
                    <span className="text-[#71717a] block">File Name</span>
                    <span className="text-white font-medium truncate block">{fileRecord.name}</span>
                  </div>
                  <div>
                    <span className="text-[#71717a] block">Size</span>
                    <span className="text-white font-medium">{formattedSize}</span>
                  </div>
                  <div>
                    <span className="text-[#71717a] block">MIME Type</span>
                    <span className="text-white font-mono">{fileRecord.mimeType}</span>
                  </div>
                  <div>
                    <span className="text-[#71717a] block">Resolution</span>
                    <span className="text-white font-medium">
                      {width && height ? `${width} × ${height} px` : 'Auto detected'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Cryptographic SHA-256 Hash Box */}
              <div className="p-3 bg-[#18181b] border border-[#27272a] rounded-xl space-y-1.5">
                <div className="flex items-center justify-between text-white font-medium">
                  <div className="flex items-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                    <span>E2EE SHA-256 Digest</span>
                  </div>
                  <button
                    onClick={copyHash}
                    className="flex items-center gap-1 px-2 py-0.5 rounded bg-[#27272a] hover:bg-[#3f3f46] text-[#d4d4d8] text-[10px] transition-colors cursor-pointer"
                  >
                    {copiedHash ? (
                      <>
                        <Check className="w-3 h-3 text-emerald-400" />
                        <span className="text-emerald-400">Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        <span>Copy</span>
                      </>
                    )}
                  </button>
                </div>
                <p className="text-[10px] font-mono text-[#71717a] break-all bg-[#09090b] p-2 rounded-lg border border-[#27272a]/60">
                  {fileRecord.hashSHA256 || 'Calculated during transmission'}
                </p>
              </div>

              {/* Camera & Optics (if EXIF present) */}
              {(exif.make || exif.model || exif.lensModel || exif.fNumber || exif.iso) && (
                <div className="p-3 bg-[#18181b] border border-[#27272a] rounded-xl space-y-2">
                  <div className="flex items-center gap-2 text-white font-medium">
                    <Camera className="w-3.5 h-3.5 text-amber-400" />
                    <span>Camera & Optics</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-[11px] pt-1">
                    <div>
                      <span className="text-[#71717a] block">Camera Model</span>
                      <span className="text-white font-medium">
                        {`${exif.make || ''} ${exif.model || ''}`.trim() || 'Unknown'}
                      </span>
                    </div>
                    <div>
                      <span className="text-[#71717a] block">Lens</span>
                      <span className="text-white truncate block">{exif.lensModel || 'Standard'}</span>
                    </div>
                    <div>
                      <span className="text-[#71717a] block">Aperture</span>
                      <span className="text-white">{exif.fNumber ? `f/${exif.fNumber}` : '—'}</span>
                    </div>
                    <div>
                      <span className="text-[#71717a] block">Shutter Speed</span>
                      <span className="text-white">{exif.exposureTime || '—'}</span>
                    </div>
                    <div>
                      <span className="text-[#71717a] block">ISO</span>
                      <span className="text-white">{exif.iso || '—'}</span>
                    </div>
                    <div>
                      <span className="text-[#71717a] block">Focal Length</span>
                      <span className="text-white">{exif.focalLength ? `${exif.focalLength} mm` : '—'}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Capture Attributes */}
              <div className="p-3 bg-[#18181b] border border-[#27272a] rounded-xl space-y-2">
                <div className="flex items-center gap-2 text-white font-medium">
                  <Layers className="w-3.5 h-3.5 text-purple-400" />
                  <span>Metadata Attributes</span>
                </div>
                <div className="space-y-1.5 text-[11px] pt-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[#71717a]">Date Taken</span>
                    <span className="text-white font-mono">
                      {exif.dateTimeOriginal || (message?.timestamp ? new Date(message.timestamp).toLocaleString() : 'N/A')}
                    </span>
                  </div>
                  {message?.senderDisplayName && (
                    <div className="flex items-center justify-between">
                      <span className="text-[#71717a]">Sender</span>
                      <span className="text-white font-medium">{message.senderDisplayName}</span>
                    </div>
                  )}
                  {hasGps && mapUrl && (
                    <div className="pt-2 border-t border-[#27272a] flex items-center justify-between">
                      <div className="flex items-center gap-1 text-emerald-400">
                        <MapPin className="w-3.5 h-3.5" />
                        <span>GPS Coordinates</span>
                      </div>
                      <a
                        href={mapUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-400 hover:underline font-mono text-[10px]"
                      >
                        {exif.latitude?.toFixed(4)}, {exif.longitude?.toFixed(4)} ↗
                      </a>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
};
