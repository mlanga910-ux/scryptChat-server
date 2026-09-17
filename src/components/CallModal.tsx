import React, { useEffect, useRef, useState } from 'react';
import { CallSessionInfo } from '../types/index';
import { CallManager } from '../webrtc/callManager';
import { Avatar } from './Avatar';
import {
  Phone,
  PhoneOff,
  PhoneIncoming,
  Video,
  VideoOff,
  Mic,
  MicOff,
  SwitchCamera,
  Monitor,
  ShieldCheck,
  Maximize2,
  Minimize2,
  Volume2,
  VolumeX,
  Lock,
} from 'lucide-react';

interface CallModalProps {
  session: CallSessionInfo | null;
  callManager: CallManager;
  onClose?: () => void;
}

/**
 * The call surface.
 *
 * Phones get a full-bleed sheet; anything with room (tablet and up) gets a
 * floating card in the corner so the conversation behind it stays visible and
 * the caller is clearly identified.
 */
export const CallModal: React.FC<CallModalProps> = ({ session, callManager }) => {
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showSecurityDetails, setShowSecurityDetails] = useState(false);
  const [isSpeakerOn, setIsSpeakerOn] = useState(true);
  const [remoteHasVideo, setRemoteHasVideo] = useState(false);
  const boundStreamRef = useRef<{ stream: MediaStream | null; cleanup: (() => void) | null }>({
    stream: null,
    cleanup: null,
  });

  /* ------------------------------------------------------------------ */
  /* Media plumbing                                                      */
  /* ------------------------------------------------------------------ */
  useEffect(() => {
    const bindVideo = (
      element: HTMLVideoElement | null,
      stream: MediaStream | null
    ) => {
      if (!element) return;
      if (stream && element.srcObject !== stream) {
        element.srcObject = stream;
        element.play().catch(() => {});
      } else if (!stream && element.srcObject) {
        element.srcObject = null;
      }
    };

    const local = callManager.getLocalStream();
    const remote = callManager.getRemoteStream();

    bindVideo(localVideoRef.current, local);
    bindVideo(remoteVideoRef.current, remote);

    if (remoteAudioRef.current && remote && remoteAudioRef.current.srcObject !== remote) {
      remoteAudioRef.current.srcObject = remote;
      remoteAudioRef.current.play().catch(() => {});
    }

    const hasLiveVideo = (stream: MediaStream | null) =>
      !!stream &&
      stream.getVideoTracks().some((track) => track.readyState === 'live' && !track.muted);

    setRemoteHasVideo(hasLiveVideo(remote));

    // Track state changes (camera switched on/off mid-call) must flip the UI.
    if (boundStreamRef.current.stream !== remote) {
      boundStreamRef.current.cleanup?.();
      if (remote) {
        const update = () => setRemoteHasVideo(hasLiveVideo(remote));
        remote.getTracks().forEach((track) => {
          track.addEventListener('mute', update);
          track.addEventListener('unmute', update);
          track.addEventListener('ended', update);
        });
        remote.addEventListener('addtrack', update);
        remote.addEventListener('removetrack', update);
        boundStreamRef.current = {
          stream: remote,
          cleanup: () => {
            remote.getTracks().forEach((track) => {
              track.removeEventListener('mute', update);
              track.removeEventListener('unmute', update);
              track.removeEventListener('ended', update);
            });
            remote.removeEventListener('addtrack', update);
            remote.removeEventListener('removetrack', update);
          },
        };
      } else {
        boundStreamRef.current = { stream: null, cleanup: null };
      }
    }
  });

  useEffect(() => {
    return () => boundStreamRef.current.cleanup?.();
  }, []);

  // Speaker toggle is real: it mutes the single remote playback element.
  useEffect(() => {
    if (remoteAudioRef.current) remoteAudioRef.current.muted = !isSpeakerOn;
  }, [isSpeakerOn, session?.callId]);

  if (!session || session.state === 'IDLE' || session.state === 'ENDED') return null;

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const isVideo = session.callType === 'video';
  const peerName = session.peerDisplayName || 'Unknown device';
  const ringing = session.state === 'CALLING' || session.state === 'INCOMING';

  /* ------------------------------------------------------------------ */
  /* 1. Incoming call                                                    */
  /* ------------------------------------------------------------------ */
  if (session.state === 'INCOMING') {
    return (
      <div className="fixed inset-0 z-50 sm:inset-auto sm:right-6 sm:bottom-6 sm:w-[368px] sm:rounded-3xl overflow-hidden border-0 sm:border border-zinc-800 panel-surface shadow-[var(--sc-shadow-lg)] animate-in animate-slide-up select-none font-sans flex flex-col">
        <div className="flex items-center gap-2 px-4 pt-4 sm:pt-5 text-[11px] text-zinc-500">
          <Lock className="w-3 h-3 text-[var(--sc-e400)]" />
          <span>End-to-end encrypted</span>
        </div>

        <div className="flex flex-col items-center gap-4 px-6 py-6 sm:py-7 text-center">
          <div className="relative">
            <div className="absolute -inset-3 rounded-full border border-[var(--sc-e400)]/40 animate-ping" />
            <div className="absolute -inset-6 rounded-full border border-[var(--sc-e400)]/20 animate-pulse" />
            <Avatar
              name={peerName}
              avatarUrl={session.peerAvatarUrl}
              avatarColor={session.peerAvatarColor}
              size="2xl"
              className="relative z-10"
            />
          </div>

          <div className="space-y-1">
            <h2 className="text-lg font-semibold text-white truncate max-w-[260px]">{peerName}</h2>
            <p className="flex items-center justify-center gap-1.5 text-xs text-zinc-500">
              <PhoneIncoming className="w-3.5 h-3.5 text-[var(--sc-e400)]" />
              <span>Incoming {isVideo ? 'video' : 'voice'} call</span>
            </p>
            <p className="text-[11px] text-zinc-600 font-mono truncate max-w-[240px]">
              {session.peerDeviceId}
            </p>
          </div>

          <div className="flex items-center gap-5 pt-1">
            <button
              onClick={() => callManager.rejectCall('Call declined')}
              className="flex flex-col items-center gap-1.5 cursor-pointer active:scale-95 transition-transform"
            >
              <span className="grid place-items-center h-14 w-14 rounded-full bg-rose-600 text-white shadow-lg">
                <PhoneOff className="w-6 h-6" />
              </span>
              <span className="text-[11px] font-medium text-zinc-500">Decline</span>
            </button>

            <button
              onClick={() => callManager.acceptCall(isVideo)}
              className="flex flex-col items-center gap-1.5 cursor-pointer active:scale-95 transition-transform"
            >
              <span className="grid place-items-center h-14 w-14 rounded-full bg-emerald-500 text-white shadow-lg">
                {isVideo ? <Video className="w-6 h-6" /> : <Phone className="w-6 h-6" />}
              </span>
              <span className="text-[11px] font-medium text-[var(--sc-e400)]">Accept</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ------------------------------------------------------------------ */
  /* 2. Active / outgoing call                                           */
  /* ------------------------------------------------------------------ */
  const remoteVideoVisible = isVideo && remoteHasVideo && !session.isRemoteVideoMuted;

  return (
    <div
      className={`fixed z-50 panel-surface text-zinc-100 flex flex-col overflow-hidden transition-all duration-300 select-none font-sans ${
        isFullscreen
          ? 'inset-0'
          : 'inset-0 sm:inset-auto sm:right-6 sm:bottom-6 sm:w-[400px] sm:h-[600px] sm:rounded-3xl sm:border sm:border-zinc-800 sm:shadow-[var(--sc-shadow-lg)]'
      }`}
    >
      {/* Header */}
      <div className="shrink-0 z-20 flex items-center justify-between gap-2 px-4 py-3 border-b border-zinc-800 bg-zinc-950/60 backdrop-blur-md">
        <div className="flex items-center gap-2.5 min-w-0">
          <span
            className={`h-2.5 w-2.5 shrink-0 rounded-full ${
              ringing ? 'bg-amber-400 animate-pulse' : 'bg-[var(--sc-e400)]'
            }`}
          />
          <div className="min-w-0">
            <h4 className="text-sm font-semibold text-white truncate">{peerName}</h4>
            <div className="flex items-center gap-1.5 text-[11px] text-zinc-500">
              {ringing ? (
                <span className="text-amber-500 animate-pulse">
                  {session.direction === 'OUTBOUND' ? 'Calling…' : 'Connecting…'}
                </span>
              ) : (
                <span className="tabular-nums text-[var(--sc-e400)] font-medium">
                  {formatDuration(session.durationSeconds)}
                </span>
              )}
              <span>•</span>
              <span className="inline-flex items-center gap-1">
                <Lock className="w-3 h-3 text-[var(--sc-e400)]" />
                Direct
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => setShowSecurityDetails((open) => !open)}
            className="p-2 rounded-full text-zinc-500 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer"
            title="Safety code"
            aria-label="Safety code"
          >
            <ShieldCheck className="w-4 h-4" />
          </button>
          <button
            onClick={() => setIsFullscreen((full) => !full)}
            className="hidden sm:grid place-items-center p-2 rounded-full text-zinc-500 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer"
            title={isFullscreen ? 'Minimize' : 'Full screen'}
            aria-label={isFullscreen ? 'Minimize call window' : 'Expand call window'}
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {showSecurityDetails && (
        <div className="shrink-0 z-20 flex items-center justify-between gap-2 px-4 py-2 border-b border-zinc-800 bg-zinc-900/60 text-xs animate-in animate-slide-down">
          <span className="flex items-center gap-2 min-w-0">
            <ShieldCheck className="w-3.5 h-3.5 text-[var(--sc-e400)] shrink-0" />
            <span className="text-zinc-500">Safety code</span>
            <span className="font-mono font-semibold text-[var(--sc-e400)] tracking-wider truncate">
              {session.safetyNumber || 'E2EE-VERIFIED'}
            </span>
          </span>
          <button
            onClick={() => setShowSecurityDetails(false)}
            className="text-zinc-500 hover:text-white font-medium cursor-pointer shrink-0"
          >
            Close
          </button>
        </div>
      )}

      {/* Stage */}
      <div className="relative flex-1 min-h-0 bg-zinc-950 flex items-center justify-center overflow-hidden">
        {/* Remote video — only painted once a live track actually exists */}
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          // Remote audio is played exactly once, by the dedicated <audio>
          // element below; a second playback would feed back into the mic.
          muted
          className={`absolute inset-0 w-full h-full object-contain sm:object-cover transition-opacity duration-300 ${
            remoteVideoVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
        />

        {!remoteVideoVisible && (
          <div className="relative z-10 flex flex-col items-center text-center gap-4 px-6">
            <div className="relative">
              {ringing && (
                <>
                  <div className="absolute -inset-3 rounded-full border border-[var(--sc-e400)]/40 animate-ping" />
                  <div className="absolute -inset-6 rounded-full border border-[var(--sc-e400)]/20 animate-pulse" />
                </>
              )}
              <Avatar
                name={peerName}
                avatarUrl={session.peerAvatarUrl}
                avatarColor={session.peerAvatarColor}
                size="2xl"
                className="relative z-10"
              />
            </div>

            <div className="space-y-1">
              <h3 className="text-lg font-semibold text-white truncate max-w-[260px]">{peerName}</h3>
              <p className="text-xs text-zinc-500">
                {ringing
                  ? session.direction === 'OUTBOUND'
                    ? 'Ringing…'
                    : 'Connecting…'
                  : isVideo
                  ? session.isRemoteVideoMuted
                    ? 'Camera paused'
                    : 'Waiting for video…'
                  : 'Voice call'}
              </p>
            </div>

            {/* Live audio activity indicator */}
            {!ringing && (
              <div className="flex items-end gap-1 h-6" aria-hidden="true">
                {[0, 1, 2, 3, 4].map((bar) => (
                  <span
                    key={bar}
                    className="w-1 rounded-full bg-[var(--sc-e400)]/70 animate-pulse"
                    style={{
                      height: `${8 + ((bar * 5) % 14)}px`,
                      animationDelay: `${bar * 120}ms`,
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Local preview (picture in picture) */}
        {isVideo && (
          <div className="absolute top-3 right-3 z-20 w-24 h-32 sm:w-28 sm:h-40 rounded-2xl overflow-hidden border border-zinc-800 bg-zinc-900 shadow-lg">
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className={`w-full h-full object-cover mirror ${session.isVideoMuted ? 'hidden' : 'block'}`}
            />
            {session.isVideoMuted && (
              <div className="w-full h-full flex flex-col items-center justify-center gap-1 text-[10px] text-zinc-500">
                <VideoOff className="w-4 h-4" />
                <span>Camera off</span>
              </div>
            )}
          </div>
        )}

        {session.isRemoteAudioMuted && !ringing && (
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 inline-flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900/80 px-3 py-1.5 text-[11px] text-amber-500 backdrop-blur-md">
            <MicOff className="w-3.5 h-3.5" />
            <span>{peerName} is muted</span>
          </div>
        )}
      </div>

      {/* Single playback element for remote audio */}
      <audio ref={remoteAudioRef} autoPlay playsInline className="hidden" />

      {/* Controls */}
      <div className="shrink-0 z-20 flex flex-col items-center gap-3 px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] border-t border-zinc-800 bg-zinc-950/60 backdrop-blur-md">
        <div className={`grid w-full max-w-xs justify-items-center gap-2 ${isVideo ? 'grid-cols-4' : 'grid-cols-3'}`}>
          <button
            onClick={() => callManager.toggleAudioMute()}
            className="flex flex-col items-center gap-1 cursor-pointer group"
          >
            <span
              className={`grid place-items-center h-12 w-12 rounded-full transition-colors ${
                session.isAudioMuted
                  ? 'bg-[var(--sc-invert-bg)] text-[var(--sc-on-invert)]'
                  : 'bg-zinc-800 text-white group-hover:bg-zinc-700'
              }`}
            >
              {session.isAudioMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
            </span>
            <span className="text-[10px] font-medium text-zinc-500 group-hover:text-white">
              {session.isAudioMuted ? 'Unmute' : 'Mute'}
            </span>
          </button>

          <button
            onClick={() => callManager.toggleVideoMute()}
            className="flex flex-col items-center gap-1 cursor-pointer group"
          >
            <span
              className={`grid place-items-center h-12 w-12 rounded-full transition-colors ${
                session.isVideoMuted || !isVideo
                  ? 'bg-zinc-800/60 text-zinc-500'
                  : 'bg-zinc-800 text-white group-hover:bg-zinc-700'
              }`}
            >
              {session.isVideoMuted || !isVideo ? (
                <VideoOff className="w-5 h-5" />
              ) : (
                <Video className="w-5 h-5" />
              )}
            </span>
            <span className="text-[10px] font-medium text-zinc-500 group-hover:text-white">Camera</span>
          </button>

          {isVideo ? (
            <button
              onClick={() => callManager.switchCamera()}
              className="flex flex-col items-center gap-1 cursor-pointer group"
            >
              <span className="grid place-items-center h-12 w-12 rounded-full bg-zinc-800 text-white group-hover:bg-zinc-700 transition-colors">
                <SwitchCamera className="w-5 h-5" />
              </span>
              <span className="text-[10px] font-medium text-zinc-500 group-hover:text-white">Flip</span>
            </button>
          ) : (
            <button
              onClick={() => setIsSpeakerOn((on) => !on)}
              className="flex flex-col items-center gap-1 cursor-pointer group"
            >
              <span
                className={`grid place-items-center h-12 w-12 rounded-full transition-colors ${
                  isSpeakerOn
                    ? 'bg-[var(--sc-invert-bg)] text-[var(--sc-on-invert)]'
                    : 'bg-zinc-800 text-white group-hover:bg-zinc-700'
                }`}
              >
                {isSpeakerOn ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
              </span>
              <span className="text-[10px] font-medium text-zinc-500 group-hover:text-white">Speaker</span>
            </button>
          )}

          <button
            onClick={() => callManager.toggleScreenShare()}
            className="flex flex-col items-center gap-1 cursor-pointer group"
          >
            <span
              className={`grid place-items-center h-12 w-12 rounded-full transition-colors ${
                session.isScreenSharing
                  ? 'bg-emerald-500 text-white'
                  : 'bg-zinc-800 text-white group-hover:bg-zinc-700'
              }`}
            >
              <Monitor className="w-5 h-5" />
            </span>
            <span className="text-[10px] font-medium text-zinc-500 group-hover:text-white">Share</span>
          </button>
        </div>

        <button
          onClick={() => callManager.endCall()}
          className="grid place-items-center h-14 w-14 rounded-full bg-rose-600 hover:bg-rose-500 text-white shadow-lg active:scale-95 transition-all cursor-pointer"
          title="End call"
          aria-label="End call"
        >
          <PhoneOff className="w-6 h-6" />
        </button>
      </div>
    </div>
  );
};
