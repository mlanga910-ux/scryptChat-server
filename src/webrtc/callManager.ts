import { db } from "../db/index";
import { soundEngine, getSoundSettings } from "../utils/cyberSoundEngine";
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
  private currentFacingMode: 'user' | 'environment' = 'user';
  private disconnectTimeout: any = null;
  private pendingIceCandidates: RTCIceCandidateInit[] = [];

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

    soundEngine.startRingtoneLoop(true);

    try {
      this.pendingIceCandidates = [];
      // 1. Get User Media
      const stream = await this.acquireUserMedia(callType === 'video', this.currentFacingMode);
      this.localStream = stream;
      this.events.onLocalStream(stream);

      // 2. Setup RTCPeerConnection for Media
      this.setupMediaPeerConnection(callId, peerDeviceId);

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
      await this.mediaPeerConnection!.setLocalDescription(offer);

      // Gather ICE candidates briefly
      await this.waitForIceCandidates(this.mediaPeerConnection!, 1000);

      const localDesc = this.mediaPeerConnection!.localDescription;
      if (!localDesc) throw new Error('Failed to generate local media description');

      // 5. Send CALL_OFFER over Real-time signaling
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

      await this.sendCallSignal(payload, peerDeviceId);
    } catch (err: any) {
      soundEngine.stopRingtoneLoop();
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

    soundEngine.stopRingtoneLoop();
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
      await this.mediaPeerConnection!.setLocalDescription(answer);

      await this.waitForIceCandidates(this.mediaPeerConnection!, 800);

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
      await this.sendCallSignal(payload, this.currentSession.peerDeviceId);

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
    soundEngine.stopRingtoneLoop();
    soundEngine.playCallEnded();

    const payload: CallSignalPayload = {
      action: 'CALL_REJECT',
      callId: this.currentSession.callId,
      reason,
    };
    await this.sendCallSignal(payload, this.currentSession.peerDeviceId).catch(() => {});

    this.cleanupMedia();
    this.currentSession = null;
    this.events.onCallStateChange(null);
  }

  /**
   * 4. END ACTIVE CALL
   */
  public async endCall(): Promise<void> {
    if (!this.currentSession) return;
    soundEngine.stopRingtoneLoop();
    soundEngine.playCallEnded();

    const payload: CallSignalPayload = {
      action: 'CALL_END',
      callId: this.currentSession.callId,
    };
    await this.sendCallSignal(payload, this.currentSession.peerDeviceId).catch(() => {});

    this.cleanupMedia();
    this.currentSession = null;
    this.events.onCallStateChange(null);
  }

  /**
   * 5. HANDLE INCOMING CALL SIGNAL
   */
  public async handleCallSignal(payload: CallSignalPayload): Promise<void> {
    switch (payload.action) {
      case 'CALL_OFFER': {
        if (this.currentSession && this.currentSession.state === 'CONNECTED') {
          // Busy
          await this.sendCallSignal({
            action: 'CALL_REJECT',
            callId: payload.callId,
            reason: 'Peer is on another call',
          }, payload.callerDeviceId || '').catch(() => {});
          return;
        }

        const callerDeviceId = payload.callerDeviceId || 'unknown';
        const contact = await db.contacts.get(callerDeviceId);

        this.currentSession = {
          callId: payload.callId,
          peerDeviceId: callerDeviceId,
          peerDisplayName: payload.callerDisplayName || contact?.alias || `Peer-${callerDeviceId.slice(4, 8)}`,
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

        this.setupMediaPeerConnection(payload.callId, callerDeviceId);

        if (payload.sdp) {
          await this.mediaPeerConnection!.setRemoteDescription(
            new RTCSessionDescription(payload.sdp as RTCSessionDescriptionInit)
          );
          await this.flushPendingIceCandidates();
        }

        this.events.onCallStateChange({ ...this.currentSession });
        soundEngine.startRingtoneLoop(false);
        break;
      }

      case 'CALL_ANSWER': {
        if (!this.currentSession || this.currentSession.callId !== payload.callId) return;
        soundEngine.stopRingtoneLoop();

        if (payload.sdp && this.mediaPeerConnection) {
          await this.mediaPeerConnection.setRemoteDescription(
            new RTCSessionDescription(payload.sdp as RTCSessionDescriptionInit)
          );
          await this.flushPendingIceCandidates();
        }

        this.currentSession.state = 'CONNECTED';
        this.currentSession.startTime = Date.now();
        this.events.onCallStateChange({ ...this.currentSession });
        this.startDurationTimer();
        soundEngine.playCallConnected();
        break;
      }

      case 'CALL_ICE': {
        if (payload.candidate) {
          if (!this.mediaPeerConnection?.remoteDescription) {
            this.pendingIceCandidates.push(payload.candidate);
            break;
          }
          try {
            await this.mediaPeerConnection!.addIceCandidate(new RTCIceCandidate(payload.candidate));
          } catch {}
        }
        break;
      }

      case 'CALL_REJECT': {
        soundEngine.stopRingtoneLoop();
        soundEngine.playCallEnded();
        this.events.onError(payload.reason || 'Call was declined');
        this.cleanupMedia();
        this.currentSession = null;
        this.events.onCallStateChange(null);
        break;
      }

      case 'CALL_END': {
        soundEngine.stopRingtoneLoop();
        soundEngine.playCallEnded();
        this.cleanupMedia();
        this.currentSession = null;
        this.events.onCallStateChange(null);
        break;
      }

      case 'CALL_MUTE_STATE': {
        if (this.currentSession) {
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
    }
  }

  public toggleAudioMute(): boolean {
    if (!this.localStream || !this.currentSession) return false;
    const audioTrack = this.localStream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      this.currentSession.isAudioMuted = !audioTrack.enabled;
      this.events.onCallStateChange({ ...this.currentSession });

      this.sendCallSignal({
        action: 'CALL_MUTE_STATE',
        callId: this.currentSession.callId,
        isAudioMuted: this.currentSession.isAudioMuted,
      }, this.currentSession.peerDeviceId).catch(() => {});

      return this.currentSession.isAudioMuted;
    }
    return false;
  }

  public toggleVideoMute(): boolean {
    if (!this.localStream || !this.currentSession) return false;
    const videoTrack = this.localStream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      this.currentSession.isVideoMuted = !videoTrack.enabled;
      this.events.onCallStateChange({ ...this.currentSession });

      this.sendCallSignal({
        action: 'CALL_MUTE_STATE',
        callId: this.currentSession.callId,
        isVideoMuted: this.currentSession.isVideoMuted,
      }, this.currentSession.peerDeviceId).catch(() => {});

      return this.currentSession.isVideoMuted;
    }
    return false;
  }

  public async switchCamera(): Promise<void> {
    if (!this.localStream || !this.mediaPeerConnection) return;
    this.currentFacingMode = this.currentFacingMode === 'user' ? 'environment' : 'user';

    try {
      const newStream = await this.acquireUserMedia(true, this.currentFacingMode);
      const newVideoTrack = newStream.getVideoTracks()[0];
      const sender = this.mediaPeerConnection.getSenders().find((s) => s.track?.kind === 'video');

      if (sender && newVideoTrack) {
        await sender.replaceTrack(newVideoTrack);
        const oldTrack = this.localStream.getVideoTracks()[0];
        if (oldTrack) oldTrack.stop();
        this.localStream.removeTrack(oldTrack);
        this.localStream.addTrack(newVideoTrack);
        this.events.onLocalStream(this.localStream);
      }
    } catch (err: any) {
      console.warn('Switch camera error:', err);
    }
  }

  public async toggleScreenShare(): Promise<boolean> {
    if (this.screenStream) {
      this.screenStream.getTracks().forEach((t) => t.stop());
      this.screenStream = null;

      if (this.localStream && this.mediaPeerConnection) {
        const videoTrack = this.localStream.getVideoTracks()[0];
        const sender = this.mediaPeerConnection.getSenders().find((s) => s.track?.kind === 'video');
        if (sender && videoTrack) {
          await sender.replaceTrack(videoTrack);
        }
      }

      if (this.currentSession) {
        this.currentSession.isScreenSharing = false;
        this.events.onCallStateChange({ ...this.currentSession });
      }
      return false;
    } else {
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

  private setupMediaPeerConnection(callId: string, peerDeviceId: string) {
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
        }, peerDeviceId).catch(() => {});
      }
    };

    this.mediaPeerConnection.onconnectionstatechange = () => {
      const state = this.mediaPeerConnection?.connectionState;
      if (state === 'failed') {
        if (this.currentSession?.state === 'CONNECTED') {
          this.endCall();
        }
      } else if (state === 'disconnected') {
        // Give 6 seconds to recover before terminating call
        if (this.disconnectTimeout) clearTimeout(this.disconnectTimeout);
        this.disconnectTimeout = setTimeout(() => {
          if (this.mediaPeerConnection?.connectionState === 'disconnected' && this.currentSession?.state === 'CONNECTED') {
            this.endCall();
          }
        }, 6000);
      } else if (state === 'connected') {
        if (this.disconnectTimeout) {
          clearTimeout(this.disconnectTimeout);
          this.disconnectTimeout = null;
        }
      }
    };
  }

  private async flushPendingIceCandidates(): Promise<void> {
    if (!this.mediaPeerConnection?.remoteDescription || this.pendingIceCandidates.length === 0) {
      return;
    }

    const pending = this.pendingIceCandidates.splice(0);
    for (const candidate of pending) {
      try {
        await this.mediaPeerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      } catch {
        // Browsers may reject candidates that arrive after ICE completed.
      }
    }
  }

  private async acquireUserMedia(video: boolean, facingMode: 'user' | 'environment'): Promise<MediaStream> {
    const settings = getSoundSettings();

    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: settings.echoCancellation,
          noiseSuppression: settings.noiseSuppression,
          autoGainControl: settings.autoGainControl,
        },
        video: video
          ? {
              facingMode,
              width: { ideal: 1280, max: 1920 },
              height: { ideal: 720, max: 1080 },
            }
          : false,
      });
    } catch {
      // Fallback with minimal constraints for maximum mobile compatibility
      return await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: video ? true : false,
      });
    }
  }

  private async sendCallSignal(payload: CallSignalPayload, targetDeviceId?: string): Promise<void> {
    const recipientId = targetDeviceId || this.currentSession?.peerDeviceId || '';
    const jsonStr = JSON.stringify(payload);
    const payloadBytes = new TextEncoder().encode(jsonStr);

    const session = this.peerManager.cryptoSession;
    const dataChannel = this.peerManager.dataChannel;

    let deliveredDirectly = false;
    // Send via WebRTC DataChannel if open. Relay is a fallback, not a second
    // copy: duplicate offers can replace the receiver's active call session.
    if (session && dataChannel && dataChannel.readyState === 'open') {
      try {
        const header = buildPacketHeader(
          PacketType.MEDIA_SIGNAL,
          session.sessionId,
          BigInt(0),
          0
        );
        const frame = await session.encryptFrame(header, payloadBytes);
        dataChannel.send(frame);
        deliveredDirectly = true;
      } catch {}
    }

    // Use the dedicated call queue. The mailbox is for chat messages/files and
    // can be drained by the fallback poller while a call is being negotiated.
    if (recipientId && !deliveredDirectly) {
      try {
        const response = await this.peerManager.fetchRelay('/api/signaling/call/signal', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            senderDeviceId: this.identity.deviceId,
            recipientDeviceId: recipientId,
            signal: payload,
          }),
        });
        if (!response.ok) {
          throw new Error(`Call relay returned HTTP ${response.status}`);
        }
      } catch {}
    }
  }

  private waitForIceCandidates(pc: RTCPeerConnection, timeoutMs = 800): Promise<void> {
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

  private cleanupMedia() {
    this.stopDurationTimer();
    if (this.disconnectTimeout) {
      clearTimeout(this.disconnectTimeout);
      this.disconnectTimeout = null;
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
    if (this.remoteStream) {
      this.remoteStream.getTracks().forEach((track) => track.stop());
      this.remoteStream = null;
      this.events.onRemoteStream(null);
    }
    if (this.mediaPeerConnection) {
      try {
        this.mediaPeerConnection.close();
      } catch {}
      this.mediaPeerConnection = null;
    }
    this.pendingIceCandidates = [];
  }

  public destroy() {
    soundEngine.stopRingtoneLoop();
    this.cleanupMedia();
  }
}
