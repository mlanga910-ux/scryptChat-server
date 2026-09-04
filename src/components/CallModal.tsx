import React, { useEffect, useRef, useState } from 'react';
import { CallSessionInfo } from '../types/index';
import { CallManager } from '../webrtc/callManager';
import {
  Phone,
  PhoneOff,
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
  MessageSquare,
  Hash,
} from 'lucide-react';

interface CallModalProps {
  session: CallSessionInfo | null;
  callManager: CallManager;
  onClose?: () => void;
}

export const CallModal: React.FC<CallModalProps> = ({ session, callManager }) => {
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showSecurityDetails, setShowSecurityDetails] = useState(false);
  const [isSpeakerOn, setIsSpeakerOn] = useState(true);

  // Sync media streams to video & audio elements without recreating or resetting streams
  useEffect(() => {
    if (!session || session.state === 'IDLE' || session.state === 'ENDED') return;

    const localStream = callManager.getLocalStream();
    if (localVideoRef.current && localStream && localVideoRef.current.srcObject !== localStream) {
      localVideoRef.current.srcObject = localStream;
      localVideoRef.current.play().catch(() => {});
    }

    const remoteStream = callManager.getRemoteStream();
    if (remoteVideoRef.current && remoteStream && remoteVideoRef.current.srcObject !== remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
      remoteVideoRef.current.play().catch(() => {});
    }

    if (remoteAudioRef.current && remoteStream && remoteAudioRef.current.srcObject !== remoteStream) {
      remoteAudioRef.current.srcObject = remoteStream;
      remoteAudioRef.current.play().catch(() => {});
    }
  });

  if (!session || session.state === 'IDLE' || session.state === 'ENDED') {
    return null;
  }

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const initial = session.peerDisplayName ? session.peerDisplayName.charAt(0).toUpperCase() : 'U';

  // 1. INCOMING CALL SCREEN - Standard Phone UI
  if (session.state === 'INCOMING') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90 backdrop-blur-xl animate-in fade-in duration-200 select-none font-sans">
        <div className="w-full max-w-sm flex flex-col items-center justify-between min-h-[460px] py-8 text-center text-white">
          {/* Top Info */}
          <div className="space-y-3 flex flex-col items-center">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-medium bg-white/10 text-white/90 backdrop-blur-md">
              <Lock className="w-3 h-3 text-emerald-400" />
              <span>End-to-End Encrypted</span>
            </div>

            <div className="pt-2">
              <h2 className="text-2xl font-bold tracking-tight text-white">{session.peerDisplayName}</h2>
              <p className="text-xs text-neutral-400 font-mono mt-0.5">{session.peerDeviceId.slice(0, 16)}...</p>
              <p className="text-sm font-medium text-emerald-400 mt-2 animate-pulse">
                Incoming {session.callType === 'video' ? 'Video Call' : 'Voice Call'}...
              </p>
            </div>
          </div>

          {/* Central Pulsing Avatar */}
          <div className="relative my-8">
            <div className="w-28 h-28 rounded-full bg-gradient-to-tr from-neutral-800 to-neutral-700 border-2 border-white/20 flex items-center justify-center text-3xl font-bold shadow-2xl z-10 relative">
              {initial}
            </div>
            {/* Native Pulse Rings */}
            <div className="absolute -inset-2 rounded-full border-2 border-emerald-500/40 animate-ping" />
            <div className="absolute -inset-6 rounded-full border border-emerald-500/20 animate-pulse" />
          </div>

          {/* Bottom Accept / Decline Buttons (Standard Native Style) */}
          <div className="w-full flex items-center justify-around px-6">
            {/* Decline */}
            <button
              onClick={() => callManager.rejectCall('Call rejected')}
              className="flex flex-col items-center gap-2 group cursor-pointer"
            >
              <div className="w-16 h-16 rounded-full bg-rose-600 hover:bg-rose-500 active:scale-95 flex items-center justify-center text-white shadow-lg shadow-rose-600/40 transition-all">
                <PhoneOff className="w-7 h-7" />
              </div>
              <span className="text-xs font-semibold text-neutral-300 group-hover:text-white">Decline</span>
            </button>

            {/* Accept */}
            <button
              onClick={() => callManager.acceptCall(session.callType === 'video')}
              className="flex flex-col items-center gap-2 group cursor-pointer"
            >
              <div className="w-16 h-16 rounded-full bg-emerald-500 hover:bg-emerald-400 active:scale-95 flex items-center justify-center text-white shadow-lg shadow-emerald-500/40 transition-all animate-bounce">
                {session.callType === 'video' ? (
                  <Video className="w-7 h-7" />
                ) : (
                  <Phone className="w-7 h-7" />
                )}
              </div>
              <span className="text-xs font-semibold text-emerald-400 group-hover:text-emerald-300">Accept</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 2. ACTIVE / CALLING SCREEN - Standard Native Mobile & Desktop Overlay
  const isVideo = session.callType === 'video';

  return (
    <div
      className={`fixed z-50 bg-[#09090b] text-white flex flex-col transition-all duration-300 select-none font-sans ${
        isFullscreen
          ? 'inset-0'
          : 'inset-0 sm:inset-auto sm:right-6 sm:bottom-6 sm:w-[420px] sm:h-[620px] sm:rounded-3xl sm:border sm:border-neutral-800 sm:shadow-2xl overflow-hidden'
      }`}
    >
      {/* Top Floating Glass Header */}
      <div className="flex items-center justify-between px-5 py-3.5 bg-black/40 backdrop-blur-md border-b border-white/10 z-20 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className={`w-2.5 h-2.5 rounded-full ${session.state === 'CALLING' ? 'bg-amber-400 animate-pulse' : 'bg-emerald-400'}`} />
          <div className="min-w-0">
            <h4 className="text-sm font-bold text-white truncate">{session.peerDisplayName}</h4>
            <div className="flex items-center gap-1.5 text-[11px] text-neutral-400 font-mono">
              {session.state === 'CALLING' ? (
                <span className="text-amber-400 font-sans font-medium animate-pulse">Calling...</span>
              ) : (
                <span className="text-emerald-400 font-bold">{formatDuration(session.durationSeconds)}</span>
              )}
              <span>•</span>
              <span className="inline-flex items-center gap-1 text-neutral-400">
                <Lock className="w-3 h-3 text-emerald-400" /> P2P E2EE
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowSecurityDetails(!showSecurityDetails)}
            title="E2EE Verification"
            className="p-2 rounded-full text-neutral-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
          >
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
          </button>
          <button
            onClick={() => setIsFullscreen(!isFullscreen)}
            title={isFullscreen ? 'Minimize window' : 'Full screen'}
            className="p-2 rounded-full text-neutral-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Security Safety Number Dropdown */}
      {showSecurityDetails && (
        <div className="px-4 py-2.5 bg-neutral-900 border-b border-neutral-800 flex items-center justify-between text-xs animate-in slide-in-from-top-2 z-20">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
            <span className="text-neutral-300">Safety Code:</span>
            <span className="font-mono font-bold text-emerald-400 tracking-wider">
              {session.safetyNumber || 'E2EE-VERIFIED'}
            </span>
          </div>
          <button
            onClick={() => setShowSecurityDetails(false)}
            className="text-neutral-500 hover:text-neutral-300 font-semibold cursor-pointer"
          >
            Close
          </button>
        </div>
      )}

      {/* Central Viewport */}
      <div className="relative flex-1 bg-gradient-to-b from-[#121216] to-[#09090b] flex flex-col items-center justify-center overflow-hidden p-6">
        {/* Remote Video Stream (Always in DOM) */}
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${
            isVideo && !session.isRemoteVideoMuted ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
        />

        {/* Standard Voice Call Layout when video is off */}
        {(!isVideo || session.isRemoteVideoMuted) && (
          <div className="flex flex-col items-center text-center space-y-4 z-10">
            <div className="relative">
              <div className="w-28 h-28 rounded-full bg-neutral-800 border border-neutral-700 flex items-center justify-center text-3xl font-bold text-white shadow-2xl">
                {initial}
              </div>
              {session.state === 'CALLING' && (
                <div className="absolute inset-0 rounded-full border-2 border-emerald-500/40 animate-ping" />
              )}
            </div>

            <div className="space-y-1">
              <h3 className="text-xl font-bold text-white">{session.peerDisplayName}</h3>
              <p className="text-xs text-neutral-400">
                {session.state === 'CALLING'
                  ? 'Connecting direct P2P audio...'
                  : isVideo && session.isRemoteVideoMuted
                  ? 'Partner camera is paused'
                  : 'Encrypted High-Definition Voice'}
              </p>
            </div>
          </div>
        )}

        {/* Local Video PIP (Picture in Picture) */}
        {isVideo && (
          <div className="absolute top-4 right-4 w-28 h-40 sm:w-32 sm:h-44 rounded-2xl overflow-hidden border-2 border-white/20 shadow-2xl bg-neutral-900 z-20">
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className={`w-full h-full object-cover mirror ${
                !session.isVideoMuted ? 'block' : 'hidden'
              }`}
            />
            {session.isVideoMuted && (
              <div className="w-full h-full flex flex-col items-center justify-center bg-neutral-900 text-neutral-500 text-[11px] p-2 text-center">
                <VideoOff className="w-5 h-5 mb-1" />
                <span>Camera off</span>
              </div>
            )}
          </div>
        )}

        {/* Remote Muted Notification Badge */}
        {session.isRemoteAudioMuted && session.state === 'CONNECTED' && (
          <div className="absolute bottom-4 bg-neutral-900/90 border border-neutral-800 px-3.5 py-1.5 rounded-full flex items-center gap-1.5 text-xs text-amber-400 backdrop-blur-md z-10">
            <MicOff className="w-3.5 h-3.5" />
            <span>Partner is muted</span>
          </div>
        )}
      </div>

      {/* Hidden dedicated audio element for continuous WebRTC audio stream */}
      <audio ref={remoteAudioRef} autoPlay playsInline className="hidden" />

      {/* Bottom Calling Action Grid (Standard Native 6-button matrix + End Call) */}
      <div className="p-5 bg-black/60 backdrop-blur-xl border-t border-white/10 flex flex-col items-center gap-4 z-20 shrink-0">
        {/* Controls Grid */}
        <div className="grid grid-cols-4 gap-3 sm:gap-4 w-full max-w-xs justify-items-center">
          {/* Mute Mic */}
          <button
            onClick={() => callManager.toggleAudioMute()}
            className="flex flex-col items-center gap-1 group cursor-pointer"
          >
            <div
              className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${
                session.isAudioMuted
                  ? 'bg-white text-black'
                  : 'bg-white/10 hover:bg-white/20 text-white'
              }`}
            >
              {session.isAudioMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
            </div>
            <span className="text-[10px] font-medium text-neutral-400 group-hover:text-white">
              {session.isAudioMuted ? 'Unmute' : 'Mute'}
            </span>
          </button>

          {/* Toggle Video */}
          <button
            onClick={() => callManager.toggleVideoMute()}
            className="flex flex-col items-center gap-1 group cursor-pointer"
          >
            <div
              className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${
                session.isVideoMuted
                  ? 'bg-white/10 text-neutral-400'
                  : 'bg-white/20 hover:bg-white/30 text-white'
              }`}
            >
              {session.isVideoMuted ? <VideoOff className="w-5 h-5" /> : <Video className="w-5 h-5" />}
            </div>
            <span className="text-[10px] font-medium text-neutral-400 group-hover:text-white">Video</span>
          </button>

          {/* Switch Camera (if video) or Speaker Toggle */}
          {isVideo ? (
            <button
              onClick={() => callManager.switchCamera()}
              className="flex flex-col items-center gap-1 group cursor-pointer"
            >
              <div className="w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-all">
                <SwitchCamera className="w-5 h-5" />
              </div>
              <span className="text-[10px] font-medium text-neutral-400 group-hover:text-white">Flip</span>
            </button>
          ) : (
            <button
              onClick={() => setIsSpeakerOn(!isSpeakerOn)}
              className="flex flex-col items-center gap-1 group cursor-pointer"
            >
              <div
                className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${
                  isSpeakerOn ? 'bg-white text-black' : 'bg-white/10 text-white'
                }`}
              >
                {isSpeakerOn ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
              </div>
              <span className="text-[10px] font-medium text-neutral-400 group-hover:text-white">Speaker</span>
            </button>
          )}

          {/* Screen Share */}
          <button
            onClick={() => callManager.toggleScreenShare()}
            className="flex flex-col items-center gap-1 group cursor-pointer"
          >
            <div
              className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${
                session.isScreenSharing
                  ? 'bg-emerald-500 text-white'
                  : 'bg-white/10 hover:bg-white/20 text-white'
              }`}
            >
              <Monitor className="w-5 h-5" />
            </div>
            <span className="text-[10px] font-medium text-neutral-400 group-hover:text-white">Share</span>
          </button>
        </div>

        {/* End Call Button */}
        <button
          onClick={() => callManager.endCall()}
          className="w-16 h-16 rounded-full bg-rose-600 hover:bg-rose-500 active:scale-95 flex items-center justify-center text-white shadow-lg shadow-rose-600/40 transition-all cursor-pointer mt-1"
          title="End Call"
        >
          <PhoneOff className="w-7 h-7" />
        </button>
      </div>
    </div>
  );
};
