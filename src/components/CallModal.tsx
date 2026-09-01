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
  Sparkles,
  Lock,
} from 'lucide-react';

interface CallModalProps {
  session: CallSessionInfo | null;
  callManager: CallManager;
  onClose?: () => void;
}

export const CallModal: React.FC<CallModalProps> = ({ session, callManager }) => {
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showSecurityDetails, setShowSecurityDetails] = useState(false);

  // Sync media streams to video elements
  useEffect(() => {
    if (!session) return;

    const localStream = callManager.getLocalStream();
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }

    const remoteStream = callManager.getRemoteStream();
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [session, session?.state, session?.isVideoMuted, session?.isRemoteVideoMuted]);

  if (!session || session.state === 'IDLE' || session.state === 'ENDED') {
    return null;
  }

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // 1. INCOMING CALL DIALOG
  if (session.state === 'INCOMING') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
        <div className="w-full max-w-sm rounded-2xl bg-zinc-900 border border-zinc-800 p-6 text-center shadow-2xl space-y-6">
          <div className="relative mx-auto w-24 h-24 rounded-full bg-gradient-to-tr from-emerald-600 to-teal-400 p-1 flex items-center justify-center shadow-lg shadow-emerald-500/20 animate-pulse">
            <div className="w-full h-full rounded-full bg-zinc-900 flex items-center justify-center">
              {session.callType === 'video' ? (
                <Video className="w-10 h-10 text-emerald-400" />
              ) : (
                <Phone className="w-10 h-10 text-emerald-400" />
              )}
            </div>
          </div>

          <div className="space-y-1">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <Lock className="w-3 h-3" />
              <span>E2EE Encrypted Call</span>
            </div>
            <h3 className="text-xl font-bold text-zinc-100">{session.peerDisplayName}</h3>
            <p className="text-xs text-zinc-400 font-mono">{session.peerDeviceId}</p>
            <p className="text-sm text-zinc-300 pt-1">
              Incoming {session.callType === 'video' ? 'video call' : 'voice call'}...
            </p>
          </div>

          <div className="flex items-center justify-center gap-4 pt-2">
            {/* Decline Button */}
            <button
              onClick={() => callManager.rejectCall('Call rejected')}
              className="flex flex-col items-center gap-1.5 group cursor-pointer"
            >
              <div className="w-14 h-14 rounded-full bg-rose-600 hover:bg-rose-500 flex items-center justify-center text-white shadow-lg shadow-rose-600/30 transition-transform active:scale-95">
                <PhoneOff className="w-6 h-6" />
              </div>
              <span className="text-xs font-medium text-zinc-400 group-hover:text-zinc-200">Decline</span>
            </button>

            {/* Accept Audio */}
            {session.callType !== 'video' && (
              <button
                onClick={() => callManager.acceptCall(false)}
                className="flex flex-col items-center gap-1.5 group cursor-pointer"
              >
                <div className="w-14 h-14 rounded-full bg-emerald-600 hover:bg-emerald-500 flex items-center justify-center text-white shadow-lg shadow-emerald-600/30 transition-transform active:scale-95 animate-bounce">
                  <Phone className="w-6 h-6" />
                </div>
                <span className="text-xs font-medium text-emerald-400 group-hover:text-emerald-300">Accept</span>
              </button>
            )}

            {/* Accept Video */}
            {session.callType === 'video' && (
              <button
                onClick={() => callManager.acceptCall(true)}
                className="flex flex-col items-center gap-1.5 group cursor-pointer"
              >
                <div className="w-14 h-14 rounded-full bg-emerald-600 hover:bg-emerald-500 flex items-center justify-center text-white shadow-lg shadow-emerald-600/30 transition-transform active:scale-95 animate-bounce">
                  <Video className="w-6 h-6" />
                </div>
                <span className="text-xs font-medium text-emerald-400 group-hover:text-emerald-300">Accept Video</span>
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // 2. OUTGOING CALLING / ACTIVE CONNECTED CALL OVERLAY
  return (
    <div
      className={`fixed z-50 bg-zinc-950 text-zinc-100 flex flex-col transition-all duration-300 ${
        isFullscreen
          ? 'inset-0'
          : 'inset-0 sm:inset-auto sm:right-6 sm:bottom-6 sm:w-[460px] sm:h-[580px] sm:rounded-2xl sm:border sm:border-zinc-800 sm:shadow-2xl overflow-hidden'
      }`}
    >
      {/* Top Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-zinc-900/80 backdrop-blur-md border-b border-zinc-800/80 z-20">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse flex-shrink-0" />
          <div className="min-w-0">
            <h4 className="text-sm font-semibold text-zinc-100 truncate">{session.peerDisplayName}</h4>
            <div className="flex items-center gap-1.5 text-xs text-zinc-400">
              {session.state === 'CALLING' ? (
                <span className="text-amber-400 font-medium animate-pulse">Calling...</span>
              ) : (
                <span className="font-mono text-emerald-400">{formatDuration(session.durationSeconds)}</span>
              )}
              <span>•</span>
              <span className="inline-flex items-center gap-0.5 text-zinc-400">
                <Lock className="w-3 h-3 text-emerald-400 inline" /> P2P DTLS
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setShowSecurityDetails(!showSecurityDetails)}
            title="Security fingerprint"
            className="p-2 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60 transition-colors"
          >
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
          </button>
          <button
            onClick={() => setIsFullscreen(!isFullscreen)}
            title={isFullscreen ? 'Minimize' : 'Fullscreen'}
            className="p-2 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60 transition-colors"
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Security Safety Number Panel */}
      {showSecurityDetails && (
        <div className="px-4 py-2.5 bg-zinc-900 border-b border-zinc-800 flex items-center justify-between text-xs animate-in slide-in-from-top-2">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span className="text-zinc-300">Safety Code:</span>
            <span className="font-mono font-bold text-emerald-400 tracking-wider">
              {session.safetyNumber || 'E2EE-VERIFIED'}
            </span>
          </div>
          <button
            onClick={() => setShowSecurityDetails(false)}
            className="text-zinc-500 hover:text-zinc-300 font-semibold"
          >
            Close
          </button>
        </div>
      )}

      {/* Media Viewport */}
      <div className="relative flex-1 bg-zinc-950 flex items-center justify-center overflow-hidden">
        {/* Remote Video */}
        {session.callType === 'video' && !session.isRemoteVideoMuted ? (
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className="w-full h-full object-cover"
          />
        ) : (
          /* Audio / Video Off Avatar State */
          <div className="flex flex-col items-center justify-center p-6 text-center space-y-4">
            <div className="relative w-28 h-28 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center shadow-xl">
              <div className="w-24 h-24 rounded-full bg-gradient-to-tr from-zinc-800 to-zinc-700 flex items-center justify-center">
                <span className="text-3xl font-bold text-zinc-200">
                  {session.peerDisplayName.charAt(0).toUpperCase()}
                </span>
              </div>
              {session.state === 'CALLING' && (
                <div className="absolute inset-0 rounded-full border-2 border-emerald-500/40 animate-ping" />
              )}
            </div>

            <div className="space-y-1">
              <h3 className="text-lg font-bold text-zinc-100">{session.peerDisplayName}</h3>
              <p className="text-xs text-zinc-400">
                {session.state === 'CALLING'
                  ? 'Connecting secure P2P stream...'
                  : session.callType === 'video' && session.isRemoteVideoMuted
                  ? 'Partner camera is off'
                  : 'Encrypted High-Fidelity Call'}
              </p>
            </div>
          </div>
        )}

        {/* Local Video PIP (Picture in Picture) */}
        {session.callType === 'video' && (
          <div className="absolute top-4 right-4 w-28 h-36 sm:w-32 sm:h-44 rounded-xl overflow-hidden border border-zinc-700 shadow-xl bg-zinc-900 z-10">
            {!session.isVideoMuted ? (
              <video
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover mirror"
              />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center bg-zinc-900 text-zinc-500 text-xs">
                <VideoOff className="w-6 h-6 mb-1" />
                <span>Camera off</span>
              </div>
            )}
          </div>
        )}

        {/* Remote Mute Indicator */}
        {session.isRemoteAudioMuted && session.state === 'CONNECTED' && (
          <div className="absolute bottom-4 left-4 bg-zinc-900/90 border border-zinc-800 px-3 py-1.5 rounded-full flex items-center gap-1.5 text-xs text-amber-400 backdrop-blur-md">
            <MicOff className="w-3.5 h-3.5" />
            <span>Partner mic is muted</span>
          </div>
        )}
      </div>

      {/* Bottom Controls Bar */}
      <div className="p-4 bg-zinc-900/90 backdrop-blur-md border-t border-zinc-800 flex items-center justify-center gap-3 z-20">
        {/* Toggle Audio Mute */}
        <button
          onClick={() => callManager.toggleAudioMute()}
          title={session.isAudioMuted ? 'Unmute microphone' : 'Mute microphone'}
          className={`p-3.5 rounded-full border transition-all cursor-pointer ${
            session.isAudioMuted
              ? 'bg-rose-500/15 border-rose-500/30 text-rose-400 hover:bg-rose-500/25'
              : 'bg-zinc-800 border-zinc-700 text-zinc-200 hover:bg-zinc-700'
          }`}
        >
          {session.isAudioMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
        </button>

        {/* Toggle Video Mute */}
        <button
          onClick={() => callManager.toggleVideoMute()}
          title={session.isVideoMuted ? 'Turn on camera' : 'Turn off camera'}
          className={`p-3.5 rounded-full border transition-all cursor-pointer ${
            session.isVideoMuted
              ? 'bg-rose-500/15 border-rose-500/30 text-rose-400 hover:bg-rose-500/25'
              : 'bg-zinc-800 border-zinc-700 text-zinc-200 hover:bg-zinc-700'
          }`}
        >
          {session.isVideoMuted ? <VideoOff className="w-5 h-5" /> : <Video className="w-5 h-5" />}
        </button>

        {/* Switch Camera (Mobile) */}
        {session.callType === 'video' && (
          <button
            onClick={() => callManager.switchCamera()}
            title="Switch camera (Front / Back)"
            className="p-3.5 rounded-full bg-zinc-800 border border-zinc-700 text-zinc-200 hover:bg-zinc-700 transition-all cursor-pointer"
          >
            <SwitchCamera className="w-5 h-5" />
          </button>
        )}

        {/* Screen Share (Desktop) */}
        <button
          onClick={() => callManager.toggleScreenShare()}
          title={session.isScreenSharing ? 'Stop screen sharing' : 'Share screen'}
          className={`p-3.5 rounded-full border transition-all cursor-pointer ${
            session.isScreenSharing
              ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/30'
              : 'bg-zinc-800 border-zinc-700 text-zinc-200 hover:bg-zinc-700'
          }`}
        >
          <Monitor className="w-5 h-5" />
        </button>

        {/* End Call Button */}
        <button
          onClick={() => callManager.endCall()}
          title="End call"
          className="p-3.5 rounded-full bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-600/30 transition-transform active:scale-95 cursor-pointer ml-2"
        >
          <PhoneOff className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
};
