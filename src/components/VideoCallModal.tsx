import React, { useEffect, useRef, useState } from 'react';
import { Camera, Mic, MicOff, PhoneOff, Video, VideoOff } from 'lucide-react';

interface VideoCallModalProps {
  onClose: () => void;
  peerName: string;
  peerManager: any;
  isIncoming?: boolean;
  incomingSignal?: any;
}

export function VideoCallModal({ onClose, peerName, peerManager, isIncoming, incomingSignal }: VideoCallModalProps) {
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isAudioMuted, setIsAudioMuted] = useState(false);
  const [isVideoMuted, setIsVideoMuted] = useState(false);
  const [status, setStatus] = useState(isIncoming ? 'Incoming call...' : 'Calling...');

  useEffect(() => {
    let stream: MediaStream | null = null;
    let peerConn = peerManager.peerConnection;

    const startCall = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        setLocalStream(stream);
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }

        if (!peerConn) {
          setStatus('Error: No peer connection');
          return;
        }

        // Add tracks to peer connection
        stream.getTracks().forEach(track => {
          peerConn?.addTrack(track, stream!);
        });

        // Listen for remote tracks
        peerConn.ontrack = (event) => {
          setRemoteStream(event.streams[0]);
          if (remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = event.streams[0];
          }
          setStatus('Connected');
        };

        // Listen for ICE candidates
        const originalOnIce = peerConn.onicecandidate;
        peerConn.onicecandidate = (e) => {
          if (e.candidate) {
            peerManager.sendMediaSignal({ type: 'candidate', candidate: e.candidate });
          }
          if (originalOnIce) originalOnIce.call(peerConn, e);
        };

        if (isIncoming && incomingSignal) {
          // We are answering
          await peerConn.setRemoteDescription(new RTCSessionDescription(incomingSignal));
          const answer = await peerConn.createAnswer();
          await peerConn.setLocalDescription(answer);
          await peerManager.sendMediaSignal({ type: 'answer', sdp: answer });
        } else {
          // We are calling
          peerConn.onnegotiationneeded = async () => {
            const offer = await peerConn?.createOffer();
            if (offer) {
              await peerConn?.setLocalDescription(offer);
              await peerManager.sendMediaSignal({ type: 'offer', sdp: offer });
            }
          };
        }
      } catch (err) {
        console.error('Error starting video call:', err);
        setStatus('Error accessing camera/mic');
      }
    };

    startCall();

    const handleSignal = async (signal: any) => {
      if (!peerConn) return;
      try {
        if (signal.type === 'offer') {
          // Handled if we were incoming
        } else if (signal.type === 'answer') {
          await peerConn.setRemoteDescription(new RTCSessionDescription(signal.sdp));
        } else if (signal.type === 'candidate') {
          await peerConn.addIceCandidate(new RTCIceCandidate(signal.candidate));
        } else if (signal.type === 'end') {
          endCall();
        }
      } catch (e) {
        console.error('Signal handling error:', e);
      }
    };

    const originalMediaHandler = (peerManager as any).events.onMediaSignal;
    (peerManager as any).events.onMediaSignal = (sig: any) => {
      handleSignal(sig);
      if (originalMediaHandler) originalMediaHandler(sig);
    };

    return () => {
      (peerManager as any).events.onMediaSignal = originalMediaHandler;
      stream?.getTracks().forEach(t => t.stop());
      // Optional: remove tracks from peerConn to stop sending
      if (peerConn) {
        const senders = peerConn.getSenders();
        senders.forEach(sender => {
          if (sender.track && stream?.getTracks().includes(sender.track)) {
            peerConn?.removeTrack(sender);
          }
        });
      }
    };
  }, [isIncoming, incomingSignal]);

  const endCall = () => {
    peerManager.sendMediaSignal({ type: 'end' });
    onClose();
  };

  const toggleAudio = () => {
    if (localStream) {
      localStream.getAudioTracks().forEach(t => t.enabled = !t.enabled);
      setIsAudioMuted(!isAudioMuted);
    }
  };

  const toggleVideo = () => {
    if (localStream) {
      localStream.getVideoTracks().forEach(t => t.enabled = !t.enabled);
      setIsVideoMuted(!isVideoMuted);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      <div className="absolute top-6 left-6 z-10 text-white font-semibold">
        {peerName} &bull; {status}
      </div>
      
      <div className="flex-1 relative">
        {/* Remote Video (Full Screen) */}
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          className="w-full h-full object-cover bg-[#09090b]"
        />

        {/* Local Video (PiP) */}
        <div className="absolute bottom-24 right-6 w-32 h-48 sm:w-48 sm:h-72 bg-black rounded-2xl overflow-hidden shadow-2xl border border-[#27272a]">
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover"
          />
        </div>
      </div>

      {/* Controls */}
      <div className="h-24 bg-gradient-to-t from-black to-transparent absolute bottom-0 w-full flex items-center justify-center gap-6 pb-6">
        <button
          onClick={toggleAudio}
          className={`p-4 rounded-full transition-colors ${
            isAudioMuted ? 'bg-red-500/20 text-red-500' : 'bg-[#27272a] hover:bg-[#3f3f46] text-white'
          }`}
        >
          {isAudioMuted ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
        </button>
        
        <button
          onClick={endCall}
          className="p-4 rounded-full bg-red-600 hover:bg-red-500 text-white transition-colors"
        >
          <PhoneOff className="w-6 h-6" />
        </button>
        
        <button
          onClick={toggleVideo}
          className={`p-4 rounded-full transition-colors ${
            isVideoMuted ? 'bg-red-500/20 text-red-500' : 'bg-[#27272a] hover:bg-[#3f3f46] text-white'
          }`}
        >
          {isVideoMuted ? <VideoOff className="w-6 h-6" /> : <Video className="w-6 h-6" />}
        </button>
      </div>
    </div>
  );
}
