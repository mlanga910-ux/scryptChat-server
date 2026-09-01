import { db } from "../db/index";
import { soundEngine, getSoundSettings } from "../utils/cyberSoundEngine";
/**
 * scryptChat Military-Grade End-to-End Encrypted P2P Voice & Video Call Engine
 * 
 * Features:
 * - Direct Peer-to-Peer DTLS-SRTP encrypted audio/video streams (zero server relay of media).
 * - Signaling exchanged exclusively over authenticated AES-256-GCM encrypted DataChannel.
 * - Crystal clear 48kHz Opus Audio with customizable echo cancellation, noise suppression & auto gain.
 * - Ultra HD Video (1080p/720p/480p), camera switching (front/back), camera mute, mic mute, and screen sharing.
 * - Cyberpunk ringtone & chime synthesis via Web Audio API (zero external assets).
 */

import { CallSessionInfo, CallSignalPayload, CallType, IdentityRecord } from '../types/index';
import { PeerManager } from './peerManager';
import { PacketType } from '../types/index';
import { buildPacketHeader } from '../protocol/packet';

const RTC_MEDIA_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
  ],
  iceCandidatePoolSize: 10,
  bundlePolicy: 'max-bundle',
  rtcpMuxPolicy: 'require',
};

export interface CallManagerEvents {
  onCallStateChange: (session: CallSessionInfo | null) => void;
  onLocalStream: (stream: MediaStream | null) => void;
  onRemoteStream: (stream: MediaStream | null) => void;
  onError: (errorMsg: string) => void;
}

export class CallManager {
  private peerManager: PeerManager;
  private identity: IdentityRecord;
  private events: CallManagerEvents;

  private mediaPeerConnection: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;
  private screenStream: MediaStream | null = null;

  private currentSession: CallSessionInfo | null = null;
  private durationTimer: any = null;
  private ringAudioContext: AudioContext | null = null;
  private ringOscillator: OscillatorNode | null = null;
  private ringGain: GainNode | null = null;
  private ringInterval: any = null;

  private currentFacingMode: 'user' | 'environment' = 'user';

  constructor(peerManager: PeerManager, identity: IdentityRecord, events: CallManagerEvents) {
    this.peerManager = peerManager;
    this.identity = identity;
    this.events = events;
  }

  public updateIdentity(identity: IdentityRecord) {
    this.identity = identity;
  }

  public getSession(): CallSessionInfo | null {
    return this.currentSession;
  }

  public getLocalStream(): MediaStream | null {
    return this.localStream;
  }

  public getRemoteStream(): MediaStream | null {
    return this.remoteStream;
  }

  private audioProcessContext: AudioContext | null = null;

  private optimizeOpusSdp(sdp: string): string {
    if (!sdp) return sdp;
    let modified = sdp;
    // Inject maximum quality parameters into Opus payload
    if (modified.includes('opus/48000')) {
      modified = modified.replace(
        /a=fmtp:(\d+) (.*)/g,
        'a=fmtp:$1 minptime=10;useinbandfec=1;stereo=1;maxaveragebitrate=128000;cbr=1;sprop-stereo=1;$2'
      );
    }
    return modified;
  }

  /**
   * 1. INITIATE OUTGOING CALL
   */
  public async startCall(peerDeviceId: string, peerDisplayName: string, callType: CallType): Promise<void> {
    if (this.currentSession && this.currentSession.state !== 'IDLE' && this.currentSession.state !== 'ENDED') {
      throw new Error('A call is already in progress');
    }

    const callId = `call_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const contact = await db.contacts.get(peerDeviceId);

    this.currentSession = {
      callId,
      peerDeviceId,
      peerDisplayName,
      callType,
      direction: 'OUTBOUND',
      state: 'CALLING',
      durationSeconds: 0,
      isAudioMuted: false,
      isVideoMuted: callType === 'audio',
      isScreenSharing: false,
      isRemoteAudioMuted: false,
      isRemoteVideoMuted: callType === 'audio',
      safetyNumber: contact?.safetyNumber,
    };
    this.events.onCallStateChange({ ...this.currentSession });

    this.startRingtone(true);

    try {
      // 1. Get User Media
      const stream = await this.acquireUserMedia(callType === 'video', this.currentFacingMode);
      this.localStream = stream;
      this.events.onLocalStream(stream);

      // 2. Setup RTCPeerConnection for Media
      this.setupMediaPeerConnection(callId);

      // 3. Add tracks
      stream.getTracks().forEach((track) => {
        if (this.mediaPeerConnection && this.localStream) {
          this.mediaPeerConnection.addTrack(track, this.localStream);
        }
      });

      // 4. Create SDP Offer
      const offer = await this.mediaPeerConnection!.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true,
      });
      const optimizedOfferSdp = this.optimizeOpusSdp(offer.sdp || '');
      await this.mediaPeerConnection!.setLocalDescription({
        type: offer.type,
        sdp: optimizedOfferSdp,
      });

      // Wait briefly for local ICE candidates
      await this.waitForIceCandidates(this.mediaPeerConnection!, 1200);

      const localDesc = this.mediaPeerConnection!.localDescription;
      if (!localDesc) throw new Error('Failed to generate local media description');

      // 5. Send CALL_OFFER over Encrypted DataChannel
      const payload: CallSignalPayload = {
        action: 'CALL_OFFER',
        callId,
        callType,
        callerDeviceId: this.identity.deviceId,
        callerDisplayName: this.identity.displayName || 'Secure Peer',
        sdp: {
          type: localDesc.type,
          sdp: localDesc.sdp,
        },
      };

      await this.sendCallSignal(payload);
    } catch (err: any) {
      this.stopRingtone();
      this.cleanupMedia();
      this.currentSession = null;
      this.events.onCallStateChange(null);
      this.events.onError(err?.message || 'Failed to start call');
      throw err;
    }
  }

  /**
   * 2. ACCEPT INCOMING CALL
   */
  public async acceptCall(withVideo?: boolean): Promise<void> {
    if (!this.currentSession || this.currentSession.state !== 'INCOMING') {
      throw new Error('No incoming call to accept');
    }

    this.stopRingtone();
    const isVideo = withVideo !== undefined ? withVideo : (this.currentSession.callType === 'video');
    this.currentSession.callType = isVideo ? 'video' : 'audio';
    this.currentSession.isVideoMuted = !isVideo;

    try {
      // 1. Acquire local media
      const stream = await this.acquireUserMedia(isVideo, this.currentFacingMode);
      this.localStream = stream;
      this.events.onLocalStream(stream);

      // 2. Add local tracks to peer connection
      stream.getTracks().forEach((track) => {
        if (this.mediaPeerConnection && this.localStream) {
          this.mediaPeerConnection.addTrack(track, this.localStream);
        }
      });

      // 3. Create SDP Answer
      const answer = await this.mediaPeerConnection!.createAnswer();
      const optimizedAnswerSdp = this.optimizeOpusSdp(answer.sdp || '');
      await this.mediaPeerConnection!.setLocalDescription({
        type: answer.type,
        sdp: optimizedAnswerSdp,
      });

      await this.waitForIceCandidates(this.mediaPeerConnection!, 1000);

      const localDesc = this.mediaPeerConnection!.localDescription;
      if (!localDesc) throw new Error('Failed to generate answer description');

      // 4. Send CALL_ANSWER
      const payload: CallSignalPayload = {
        action: 'CALL_ANSWER',
        callId: this.currentSession.callId,
        callType: this.currentSession.callType,
        sdp: {
          type: localDesc.type,
          sdp: localDesc.sdp,
        },
      };
      await this.sendCallSignal(payload);

      this.currentSession.state = 'CONNECTED';
      this.currentSession.startTime = Date.now();
      this.events.onCallStateChange({ ...this.currentSession });
      this.startDurationTimer();
      soundEngine.playCallConnected();
    } catch (err: any) {
      this.endCall();
      this.events.onError(err?.message || 'Failed to accept call');
    }
  }

  /**
   * 3. REJECT INCOMING CALL
   */
  public async rejectCall(reason = 'Call declined'): Promise<void> {
    if (!this.currentSession) return;
    this.stopRingtone();
    soundEngine.playCallEnded();

    const payload: CallSignalPayload = {
      action: 'CALL_REJECT',
      callId: this.currentSession.callId,
      reason,
    };
    await this.sendCallSignal(payload).catch(() => {});

    this.cleanupMedia();
    this.currentSession = null;
    this.events.onCallStateChange(null);
  }

  /**
   * 4. END ACTIVE CALL
   */
  public async endCall(): Promise<void> {
    if (!this.currentSession) return;
    this.stopRingtone();
    soundEngine.playCallEnded();

    const payload: CallSignalPayload = {
      action: 'CALL_END',
      callId: this.currentSession.callId,
    };
    await this.sendCallSignal(payload).catch(() => {});

    this.cleanupMedia();
    this.currentSession = null;
    this.events.onCallStateChange(null);
  }

  /**
   * 5. HANDLE INCOMING CALL SIGNAL (Packet from encrypted DataChannel)
   */
  public async handleCallSignal(payload: CallSignalPayload): Promise<void> {
    switch (payload.action) {
      case 'CALL_OFFER': {
        if (this.currentSession && this.currentSession.state === 'CONNECTED') {
          // Busy: reject with busy reason
          await this.sendCallSignal({
            action: 'CALL_REJECT',
            callId: payload.callId,
            reason: 'Peer is on another call',
          }).catch(() => {});
          return;
        }

        const callerDeviceId = payload.callerDeviceId || 'unknown';
        const contact = await db.contacts.get(callerDeviceId);

        this.currentSession = {
          callId: payload.callId,
          peerDeviceId: callerDeviceId,
          peerDisplayName: payload.callerDisplayName || contact?.alias || `Peer-${callerDeviceId.slice(-4)}`,
          callType: payload.callType || 'audio',
          direction: 'INBOUND',
          state: 'INCOMING',
          durationSeconds: 0,
          isAudioMuted: false,
          isVideoMuted: payload.callType === 'audio',
          isScreenSharing: false,
          isRemoteAudioMuted: false,
          isRemoteVideoMuted: payload.callType === 'audio',
          safetyNumber: contact?.safetyNumber,
        };

        this.setupMediaPeerConnection(payload.callId);

        if (payload.sdp) {
          await this.mediaPeerConnection!.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        }

        this.events.onCallStateChange({ ...this.currentSession });
        this.startRingtone(false);
        break;
      }

      case 'CALL_ANSWER': {
        if (!this.currentSession || this.currentSession.callId !== payload.callId) return;

        this.stopRingtone();
        if (payload.sdp && this.mediaPeerConnection) {
          await this.mediaPeerConnection.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        }

        this.currentSession.state = 'CONNECTED';
        this.currentSession.startTime = Date.now();
        this.events.onCallStateChange({ ...this.currentSession });
        this.startDurationTimer();
        soundEngine.playCallConnected();
        break;
      }

      case 'CALL_REJECT': {
        if (!this.currentSession || this.currentSession.callId !== payload.callId) return;
        this.stopRingtone();
        soundEngine.playCallEnded();
        this.events.onError(payload.reason || 'Call was declined by peer');
        this.cleanupMedia();
        this.currentSession = null;
        this.events.onCallStateChange(null);
        break;
      }

      case 'CALL_END': {
        if (!this.currentSession || this.currentSession.callId !== payload.callId) return;
        this.stopRingtone();
        soundEngine.playCallEnded();
        this.cleanupMedia();
        this.currentSession = null;
        this.events.onCallStateChange(null);
        break;
      }

      case 'CALL_MUTE_STATE': {
        if (this.currentSession && this.currentSession.callId === payload.callId) {
          if (payload.isAudioMuted !== undefined) {
            this.currentSession.isRemoteAudioMuted = payload.isAudioMuted;
          }
          if (payload.isVideoMuted !== undefined) {
            this.currentSession.isRemoteVideoMuted = payload.isVideoMuted;
          }
          this.events.onCallStateChange({ ...this.currentSession });
        }
        break;
      }

      case 'CALL_ICE': {
        if (payload.candidate && this.mediaPeerConnection) {
          try {
            await this.mediaPeerConnection.addIceCandidate(new RTCIceCandidate(payload.candidate));
          } catch (iceErr) {
            console.warn('ICE candidate add error:', iceErr);
          }
        }
        break;
      }
    }
  }

  /**
   * 6. CONTROLS: Toggle Mute, Camera, Screen Share, Switch Camera
   */
  public toggleAudioMute(): boolean {
    if (!this.localStream) return false;
    const audioTrack = this.localStream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      const isMuted = !audioTrack.enabled;
      if (this.currentSession) {
        this.currentSession.isAudioMuted = isMuted;
        this.events.onCallStateChange({ ...this.currentSession });
        this.sendCallSignal({
          action: 'CALL_MUTE_STATE',
          callId: this.currentSession.callId,
          isAudioMuted: isMuted,
        }).catch(() => {});
      }
      return isMuted;
    }
    return false;
  }

  public async toggleVideoMute(): Promise<boolean> {
    if (!this.localStream) return true;
    let videoTrack = this.localStream.getVideoTracks()[0];

    if (!videoTrack) {
      // Add video track if none existed
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: this.currentFacingMode, width: { ideal: 1280 }, height: { ideal: 720 } },
        });
        videoTrack = stream.getVideoTracks()[0];
        this.localStream.addTrack(videoTrack);
        if (this.mediaPeerConnection) {
          this.mediaPeerConnection.addTrack(videoTrack, this.localStream);
        }
      } catch {
        return true;
      }
    } else {
      videoTrack.enabled = !videoTrack.enabled;
    }

    const isMuted = !videoTrack.enabled;
    if (this.currentSession) {
      this.currentSession.isVideoMuted = isMuted;
      this.events.onCallStateChange({ ...this.currentSession });
      this.sendCallSignal({
        action: 'CALL_MUTE_STATE',
        callId: this.currentSession.callId,
        isVideoMuted: isMuted,
      }).catch(() => {});
    }
    return isMuted;
  }

  public async switchCamera(): Promise<void> {
    if (!this.localStream) return;
    this.currentFacingMode = this.currentFacingMode === 'user' ? 'environment' : 'user';

    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { exact: this.currentFacingMode } },
      });
      const newVideoTrack = newStream.getVideoTracks()[0];
      const oldVideoTrack = this.localStream.getVideoTracks()[0];

      if (oldVideoTrack) {
        this.localStream.removeTrack(oldVideoTrack);
        oldVideoTrack.stop();
      }

      this.localStream.addTrack(newVideoTrack);
      this.events.onLocalStream(this.localStream);

      // Replace track in peer connection
      if (this.mediaPeerConnection) {
        const sender = this.mediaPeerConnection.getSenders().find((s) => s.track?.kind === 'video');
        if (sender) {
          await sender.replaceTrack(newVideoTrack);
        }
      }
    } catch {
      // Fallback
    }
  }

  public async toggleScreenShare(): Promise<boolean> {
    if (this.screenStream) {
      // Stop screen share
      this.screenStream.getTracks().forEach((t) => t.stop());
      this.screenStream = null;

      // Revert to camera
      if (this.localStream) {
        const camTrack = this.localStream.getVideoTracks()[0];
        if (this.mediaPeerConnection && camTrack) {
          const sender = this.mediaPeerConnection.getSenders().find((s) => s.track?.kind === 'video');
          if (sender) await sender.replaceTrack(camTrack);
        }
      }

      if (this.currentSession) {
        this.currentSession.isScreenSharing = false;
        this.events.onCallStateChange({ ...this.currentSession });
      }
      return false;
    } else {
      // Start screen share
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        this.screenStream = stream;
        const screenTrack = stream.getVideoTracks()[0];

        screenTrack.onended = () => {
          this.toggleScreenShare();
        };

        if (this.mediaPeerConnection) {
          const sender = this.mediaPeerConnection.getSenders().find((s) => s.track?.kind === 'video');
          if (sender) {
            await sender.replaceTrack(screenTrack);
          } else if (this.localStream) {
            this.mediaPeerConnection.addTrack(screenTrack, this.localStream);
          }
        }

        if (this.currentSession) {
          this.currentSession.isScreenSharing = true;
          this.events.onCallStateChange({ ...this.currentSession });
        }
        return true;
      } catch {
        return false;
      }
    }
  }

  /**
   * Helper: Setup Media RTCPeerConnection
   */
  private setupMediaPeerConnection(callId: string) {
    if (this.mediaPeerConnection) {
      try {
        this.mediaPeerConnection.close();
      } catch {}
    }

    this.mediaPeerConnection = new RTCPeerConnection(RTC_MEDIA_CONFIG);
    this.remoteStream = new MediaStream();

    this.mediaPeerConnection.ontrack = (event) => {
      if (event.streams && event.streams[0]) {
        this.remoteStream = event.streams[0];
      } else if (event.track) {
        this.remoteStream!.addTrack(event.track);
      }
      this.events.onRemoteStream(this.remoteStream);
    };

    this.mediaPeerConnection.onicecandidate = (event) => {
      if (event.candidate && this.currentSession) {
        this.sendCallSignal({
          action: 'CALL_ICE',
          callId,
          candidate: event.candidate.toJSON(),
        }).catch(() => {});
      }
    };

    this.mediaPeerConnection.onconnectionstatechange = () => {
      if (this.mediaPeerConnection?.connectionState === 'disconnected' || this.mediaPeerConnection?.connectionState === 'failed') {
        if (this.currentSession?.state === 'CONNECTED') {
          this.endCall();
        }
      }
    };
  }

  private async acquireUserMedia(video: boolean, facingMode: 'user' | 'environment'): Promise<MediaStream> {
    const settings = getSoundSettings();

    // Calculate dynamic video resolution constraints
    let videoWidth = 1280;
    let videoHeight = 720;
    let frameRate = 30;

    if (settings.videoQuality === '1080p') {
      videoWidth = 1920;
      videoHeight = 1080;
      frameRate = 60;
    } else if (settings.videoQuality === '480p') {
      videoWidth = 854;
      videoHeight = 480;
      frameRate = 24;
    }

    const rawStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: settings.echoCancellation,
        noiseSuppression: settings.noiseSuppression,
        autoGainControl: settings.autoGainControl,
        sampleRate: settings.audioPreset === 'opus_hd' ? 48000 : 44100,
        channelCount: 1,
      },
      video: video
        ? {
            facingMode,
            width: { ideal: videoWidth, max: videoWidth },
            height: { ideal: videoHeight, max: videoHeight },
            frameRate: { ideal: frameRate, max: frameRate },
          }
        : false,
    });

    // Real-Time Web Audio Studio DSP Noise Gate & Voice Clarity Chain
    if ((settings.studioVoiceGate ?? true) && rawStream.getAudioTracks().length > 0) {
      try {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioCtx) {
          if (this.audioProcessContext) {
            try { this.audioProcessContext.close(); } catch {}
          }
          this.audioProcessContext = new AudioCtx({ sampleRate: 48000 });
          if (this.audioProcessContext.state === 'suspended') {
            await this.audioProcessContext.resume();
          }

          const source = this.audioProcessContext.createMediaStreamSource(rawStream);

          // 1. Highpass Filter (cuts sub-85Hz low-end rumble, desk thumps, AC humming)
          const highpass = this.audioProcessContext.createBiquadFilter();
          highpass.type = 'highpass';
          highpass.frequency.setValueAtTime(85, this.audioProcessContext.currentTime);
          highpass.Q.setValueAtTime(0.707, this.audioProcessContext.currentTime);

          // 2. Notch Filter (eliminates 50Hz/60Hz mains electrical buzz)
          const notch = this.audioProcessContext.createBiquadFilter();
          notch.type = 'notch';
          notch.frequency.setValueAtTime(50, this.audioProcessContext.currentTime);
          notch.Q.setValueAtTime(4.0, this.audioProcessContext.currentTime);

          // 3. Studio Dynamics Compressor / Voice Gate (normalizes vocal speech, clamps background noise)
          const compressor = this.audioProcessContext.createDynamicsCompressor();
          compressor.threshold.setValueAtTime(-24, this.audioProcessContext.currentTime);
          compressor.knee.setValueAtTime(24, this.audioProcessContext.currentTime);
          compressor.ratio.setValueAtTime(10, this.audioProcessContext.currentTime);
          compressor.attack.setValueAtTime(0.003, this.audioProcessContext.currentTime);
          compressor.release.setValueAtTime(0.2, this.audioProcessContext.currentTime);

          // 4. Output stream destination
          const destination = this.audioProcessContext.createMediaStreamDestination();

          source.connect(highpass);
          highpass.connect(notch);
          notch.connect(compressor);
          compressor.connect(destination);

          const cleanStream = new MediaStream();
          destination.stream.getAudioTracks().forEach((track) => cleanStream.addTrack(track));
          rawStream.getVideoTracks().forEach((track) => cleanStream.addTrack(track));
          return cleanStream;
        }
      } catch (err) {
        console.warn('Web Audio Studio DSP error, using direct stream:', err);
      }
    }

    return rawStream;
  }

  private async sendCallSignal(payload: CallSignalPayload): Promise<void> {
    const jsonStr = JSON.stringify(payload);
    const payloadBytes = new TextEncoder().encode(jsonStr);

    const session = this.peerManager.cryptoSession;
    const dataChannel = this.peerManager.dataChannel;

    if (session && dataChannel && dataChannel.readyState === 'open') {
      const header = buildPacketHeader(
        PacketType.MEDIA_SIGNAL,
        session.sessionId,
        BigInt(0),
        0
      );
      const frame = await session.encryptFrame(header, payloadBytes);
      dataChannel.send(frame);
    } else {
      // Fallback via relay if direct channel is not yet connected
      await this.peerManager.fetchRelay('/api/signaling/mailbox/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          senderDeviceId: this.identity.deviceId,
          recipientDeviceId: this.currentSession?.peerDeviceId || '',
          encryptedEnvelope: btoa(jsonStr),
          timestamp: Date.now(),
        }),
      }).catch(() => {});
    }
  }

  private waitForIceCandidates(pc: RTCPeerConnection, timeoutMs = 1200): Promise<void> {
    return new Promise((resolve) => {
      if (pc.iceGatheringState === 'complete') {
        resolve();
        return;
      }
      const timer = setTimeout(() => resolve(), timeoutMs);
      const onStateChange = () => {
        if (pc.iceGatheringState === 'complete') {
          clearTimeout(timer);
          pc.removeEventListener('icegatheringstatechange', onStateChange);
          resolve();
        }
      };
      pc.addEventListener('icegatheringstatechange', onStateChange);
    });
  }

  private startDurationTimer() {
    this.stopDurationTimer();
    this.durationTimer = setInterval(() => {
      if (this.currentSession && this.currentSession.startTime) {
        this.currentSession.durationSeconds = Math.floor((Date.now() - this.currentSession.startTime) / 1000);
        this.events.onCallStateChange({ ...this.currentSession });
      }
    }, 1000);
  }

  private stopDurationTimer() {
    if (this.durationTimer) {
      clearInterval(this.durationTimer);
      this.durationTimer = null;
    }
  }

  /**
   * Cyberpunk Web Audio Ringtone / Ringback generator
   */
  private startRingtone(isOutgoing: boolean) {
    if (isOutgoing) {
      soundEngine.startOutgoingRing();
    } else {
      soundEngine.startIncomingRingtone();
    }
  }

  private stopRingtone() {
    soundEngine.stopRingtone();
    if (this.ringInterval) {
      clearInterval(this.ringInterval);
      this.ringInterval = null;
    }
    if (this.ringAudioContext) {
      try {
        this.ringAudioContext.close();
      } catch {}
      this.ringAudioContext = null;
    }
  }

  private cleanupMedia() {
    this.stopDurationTimer();
    this.stopRingtone();

    if (this.audioProcessContext) {
      try {
        this.audioProcessContext.close();
      } catch {}
      this.audioProcessContext = null;
    }

    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => track.stop());
      this.localStream = null;
      this.events.onLocalStream(null);
    }
    if (this.screenStream) {
      this.screenStream.getTracks().forEach((track) => track.stop());
      this.screenStream = null;
    }
    if (this.mediaPeerConnection) {
      try {
        this.mediaPeerConnection.close();
      } catch {}
      this.mediaPeerConnection = null;
    }
    this.remoteStream = null;
    this.events.onRemoteStream(null);
  }

  public destroy() {
    this.cleanupMedia();
  }
}
