import React, { useEffect, useRef } from 'react';
import {
  PhoneOff,
  Video,
  VideoOff,
  Mic,
  MicOff,
  SwitchCamera,
  Monitor,
  User,
  Volume2,
  VolumeX,
  MessageSquare,
  Hand,
  SignalHigh,
  Wifi,
  Battery,
  MoreHorizontal,
} from 'lucide-react';
import { ContactRecord } from '../types/index';

export type CallType = 'voice' | 'video';
export type CallOrientation = 'portrait' | 'landscape';

export interface InCallModalProps {
  isOpen: boolean;
  onClose: () => void;
  contact: ContactRecord | null;
  callType: CallType;
  isMuted: boolean;
  isVideoEnabled: boolean;
  isSpeakerOn: boolean;
  isScreenSharing: boolean;
  isRemoteVideoMuted: boolean;
  orientation: CallOrientation;
  durationSeconds: number;
  localVideoRef?: React.RefObject<HTMLVideoElement>;
  remoteVideoRef?: React.RefObject<HTMLVideoElement>;
  onMuteToggle: () => void;
  onCameraToggle: () => void;
  onSpeakerToggle: () => void;
  onScreenShareToggle: () => void;
  onEndCall: () => void;
  onSwitchCamera?: () => void;
  onMessageSwitch?: () => void;
  onHandRaiseToggle?: () => void;
  isHandRaised?: boolean;
}

const formatTime = (seconds: number) => {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

export const InCallModal: React.FC<InCallModalProps> = ({
  isOpen,
  onClose,
  contact,
  callType,
  isMuted,
  isVideoEnabled,
  isSpeakerOn,
  isScreenSharing,
  isRemoteVideoMuted,
  orientation,
  durationSeconds,
  localVideoRef,
  remoteVideoRef,
  onMuteToggle,
  onCameraToggle,
  onSpeakerToggle,
  onScreenShareToggle,
  onEndCall,
  onSwitchCamera,
  onMessageSwitch,
  onHandRaiseToggle,
  isHandRaised = false,
}) => {
  const isLandscape = orientation === 'landscape';
  const isVideoCall = callType === 'video';
  const showVideo = isVideoCall;

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div
      id="incall-backdrop"
      className="fixed inset-0 z-[100] bg-black flex items-center justify-center animate-in fade-in duration-150"
      onClick={handleBackdropClick}
    >
      <div
        className={`relative bg-zinc-950 border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden text-xs flex flex-col font-sans select-none transition-all duration-300 ${
          isLandscape
            ? 'w-[90vw] h-[55vh] max-w-6xl'
            : 'w-[95vw] max-w-md h-[80vh]'
        }`}
      >
        {/* Top Bar */}
        <div className="px-4 py-2.5 border-b border-zinc-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 text-white">
            {contact && (
              <>
                <div
                  className="w-6 h-6 rounded-full flex items-center justify-center text-white font-medium text-[10px]"
                  style={{ backgroundColor: contact.avatarColor || '#3f3f46' }}
                >
                  {contact.alias.charAt(0).toUpperCase()}
                </div>
                <span className="text-xs font-medium">{contact.alias}</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-2 text-zinc-400 text-[11px]">
            <span>{formatTime(durationSeconds)}</span>
            <SignalHigh className="w-3.5 h-3.5" />
            <Wifi className="w-3.5 h-3.5" />
            <Battery className="w-3.5 h-3.5" />
          </div>
        </div>

        {/* Video / Content Area */}
        <div className="flex-1 relative bg-black overflow-hidden">
          {showVideo ? (
            <>
              {/* Remote Video */}
              {remoteVideoRef && (
                <video
                  ref={remoteVideoRef}
                  autoPlay
                  playsInline
                  muted={false}
                  className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${
                    isRemoteVideoMuted ? 'hidden' : 'block'
                  }`}
                />
              )}
              {isRemoteVideoMuted && (
                <div className="absolute inset-0 flex items-center justify-center bg-zinc-900">
                  <User className="w-20 h-20 text-zinc-700" />
                </div>
              )}

              {/* Local Video Thumbnail */}
              {localVideoRef && (
                <div
                  className={`absolute shadow-lg rounded-lg overflow-hidden border-2 border-zinc-800 bg-zinc-900 transition-all duration-300 ${
                    isLandscape
                      ? 'top-4 right-4 w-40 h-28'
                      : 'bottom-16 right-3 w-20 h-14'
                  }`}
                >
                  <video
                    ref={localVideoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-full object-cover"
                  />
                  {!isVideoEnabled && (
                    <div className="absolute inset-0 flex items-center justify-center bg-zinc-900/80">
                      <VideoOff className="w-4 h-4 text-zinc-500" />
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            /* Voice Call Content */
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
              {contact && (
                <div
                  className="w-24 h-24 rounded-full flex items-center justify-center text-white font-medium text-xl shadow-lg"
                  style={{ backgroundColor: contact.avatarColor || '#3f3f46' }}
                >
                  {contact.alias.charAt(0).toUpperCase()}
                </div>
              )}
              <div className="text-center">
                <p className="text-xl font-semibold text-white">
                  {contact?.alias || 'Unknown'}
                </p>
                <p className="text-zinc-500 text-sm">
                  {isSpeakerOn ? 'Speaker on' : 'On device'}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Controls Bar */}
        <div className="px-4 py-3 border-t border-zinc-800 bg-zinc-950/50 flex items-center justify-center gap-3 shrink-0">
          {/* Mute Mic */}
          <button
            type="button"
            onClick={onMuteToggle}
            aria-label={isMuted ? 'Unmute microphone' : 'Mute microphone'}
            className={`w-11 h-11 rounded-full flex items-center justify-center transition-all ${
              isMuted
                ? 'bg-rose-500 hover:bg-rose-600 text-white'
                : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'
            }`}
          >
            {isMuted ? (
              <MicOff className="w-5 h-5" />
            ) : (
              <Mic className="w-5 h-5" />
            )}
          </button>

          {showVideo && (
            <>
              {/* Camera Toggle */}
              <button
                type="button"
                onClick={onCameraToggle}
                aria-label={isVideoEnabled ? 'Turn off camera' : 'Turn on camera'}
                className={`w-11 h-11 rounded-full flex items-center justify-center transition-all ${
                  isVideoEnabled
                    ? 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'
                    : 'bg-rose-500 hover:bg-rose-600 text-white'
                }`}
              >
                {isVideoEnabled ? (
                  <Video className="w-5 h-5" />
                ) : (
                  <VideoOff className="w-5 h-5" />
                )}
              </button>

              {/* Switch Camera */}
              {onSwitchCamera && (
                <button
                  type="button"
                  onClick={onSwitchCamera}
                  aria-label="Switch camera"
                  className="w-11 h-11 rounded-full flex items-center justify-center bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-all"
                >
                  <SwitchCamera className="w-5 h-5" />
                </button>
              )}

              {/* Screen Share */}
              <button
                type="button"
                onClick={onScreenShareToggle}
                aria-label={isScreenSharing ? 'Stop sharing' : 'Share screen'}
                className={`w-11 h-11 rounded-full flex items-center justify-center transition-all ${
                  isScreenSharing
                    ? 'bg-emerald-500 hover:bg-emerald-600 text-white'
                    : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'
                }`}
              >
                <Monitor className="w-5 h-5" />
              </button>
            </>
          )}

          {/* Speaker */}
          <button
            type="button"
            onClick={onSpeakerToggle}
            aria-label={isSpeakerOn ? 'Turn off speaker' : 'Turn on speaker'}
            className={`w-11 h-11 rounded-full flex items-center justify-center transition-all ${
              isSpeakerOn ? 'bg-white text-zinc-950' : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'
            }`}
          >
            {isSpeakerOn ? (
              <Volume2 className="w-5 h-5" />
            ) : (
              <VolumeX className="w-5 h-5" />
            )}
          </button>

          {/* Hand Raise */}
          {onHandRaiseToggle && (
            <button
              type="button"
              onClick={onHandRaiseToggle}
              aria-label={isHandRaised ? 'Lower hand' : 'Raise hand'}
              className={`w-11 h-11 rounded-full flex items-center justify-center transition-all ${
                isHandRaised
                  ? 'bg-amber-500 hover:bg-amber-600 text-white'
                  : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'
              }`}
            >
              {isHandRaised ? (
                <Hand className="w-5 h-5" />
              ) : (
                <Hand className="w-5 h-5" />
              )}
            </button>
          )}

          {/* Message Switch */}
          {onMessageSwitch && (
            <button
              type="button"
              onClick={onMessageSwitch}
              aria-label="Switch to messages"
              className="w-11 h-11 rounded-full flex items-center justify-center bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-all"
            >
              <MessageSquare className="w-5 h-5" />
            </button>
          )}

          {/* More Options */}
          <button
            type="button"
            aria-label="More options"
            className="w-11 h-11 rounded-full flex items-center justify-center bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-all"
          >
            <MoreHorizontal className="w-5 h-5" />
          </button>

          {/* End Call */}
          <button
            type="button"
            onClick={onEndCall}
            aria-label="End call"
            className="w-14 h-14 rounded-full flex items-center justify-center bg-rose-600 hover:bg-rose-700 text-white shadow-lg transition-transform hover:scale-105"
          >
            <PhoneOff className="w-6 h-6" />
          </button>
        </div>
      </div>
    </div>
  );
};