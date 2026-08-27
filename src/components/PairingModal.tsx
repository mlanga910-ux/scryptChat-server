import React, { useState, useEffect, useRef } from 'react';
import { PeerManager } from '../webrtc/peerManager';
import {
  HandshakeAnswerData,
  HandshakeOfferData,
} from '../types/index';
import {
  encodeToQrChunks,
  QrChunkCollector,
  renderQrCode,
  scanCanvasForQr,
} from '../webrtc/qrStream';
import {
  X,
  QrCode,
  Key,
  Share2,
  Lock,
  Zap,
  Shield,
  ArrowLeft,
  ChevronRight,
  Copy,
  Check,
  RefreshCw,
  Clock,
  Camera,
  Layers,
} from 'lucide-react';

interface PairingModalProps {
  isOpen: boolean;
  peerManager: PeerManager;
  onClose: () => void;
  onPairSuccess: () => void;
}

type PairingScreen = 'menu' | 'scan_qr' | 'share_code' | 'enter_code' | 'manual_sdp';

export const PairingModal: React.FC<PairingModalProps> = ({
  isOpen,
  peerManager,
  onClose,
  onPairSuccess,
}) => {
  const [screen, setScreen] = useState<PairingScreen>('menu');

  // Rolling 60s states
  const [roomCode, setRoomCode] = useState('');
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [roomStatusText, setRoomStatusText] = useState('');
  const [isRoomLoading, setIsRoomLoading] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(60);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);

  // Optical QR & SDP states
  const [offerData, setOfferData] = useState<HandshakeOfferData | null>(null);
  const [answerData, setAnswerData] = useState<HandshakeAnswerData | null>(null);
  const [manualInputJson, setManualInputJson] = useState('');
  const [copied, setCopied] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // QR Stream Animation
  const [qrChunks, setQrChunks] = useState<string[]>([]);
  const [currentChunkIndex, setCurrentChunkIndex] = useState(0);
  const qrCanvasRef = useRef<HTMLCanvasElement>(null);
  const rollingQrCanvasRef = useRef<HTMLCanvasElement>(null);

  // Camera Scanner
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [scanProgress, setScanProgress] = useState('Align the QR code in the frame to connect securely.');
  const videoRef = useRef<HTMLVideoElement>(null);
  const scanCanvasRef = useRef<HTMLCanvasElement>(null);
  const collectorRef = useRef<QrChunkCollector>(new QrChunkCollector());
  const cameraStreamRef = useRef<MediaStream | null>(null);

  // Stop camera when modal closes or screen leaves
  useEffect(() => {
    if (!isOpen) {
      stopCamera();
      setErrorMsg('');
      setScreen('menu');
    }
  }, [isOpen]);

  // Clean room polling on unmount
  const pollIntervalRef = useRef<any>(null);
  const timerIntervalRef = useRef<any>(null);

  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    };
  }, []);

  // Rolling 60s countdown timer
  useEffect(() => {
    if (!expiresAt) return;

    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);

    timerIntervalRef.current = setInterval(() => {
      const diff = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
      setRemainingSeconds(diff);

      if (diff <= 0) {
        clearInterval(timerIntervalRef.current);
        if (roomCode) {
          handleCreateRollingRoom();
        }
      }
    }, 1000);

    return () => {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    };
  }, [expiresAt, roomCode]);

  // Render Rolling QR Code Canvas
  useEffect(() => {
    if (!roomCode || !rollingQrCanvasRef.current) return;
    const pairingPayload = JSON.stringify({
      app: 'scryptChat',
      room: roomCode,
      exp: expiresAt,
      dev: peerManager.activeContact?.deviceId || 'peer',
    });
    renderQrCode(rollingQrCanvasRef.current, pairingPayload).catch(console.error);
  }, [roomCode, expiresAt, screen]);

  // Create rolling room (Host / Share Code)
  const handleCreateRollingRoom = async () => {
    try {
      setIsRoomLoading(true);
      setErrorMsg('');
      setRoomStatusText('Generating ephemeral key pair & 1-minute pairing code...');

      const offer = await peerManager.createOffer();
      setOfferData(offer);

      const res = await fetch('/api/signaling/room/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: offer.deviceId, ttlSeconds: 60 }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Room creation failed');

      const code = data.roomId;
      setRoomCode(code);
      setExpiresAt(data.expiresAt);
      setRemainingSeconds(60);

      // Post offer to created room
      await fetch(`/api/signaling/room/${code}/offer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ offer, deviceId: offer.deviceId }),
      });

      setRoomStatusText('Waiting for peer to scan or enter code...');

      // Start polling for Answer
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = setInterval(async () => {
        try {
          const statusRes = await fetch(`/api/signaling/room/${code}/status`);
          const statusData = await statusRes.json();
          if (statusData.hasAnswer && statusData.answer) {
            clearInterval(pollIntervalRef.current);
            setRoomStatusText('Peer answer received! Finalizing encryption handshake...');
            await peerManager.acceptAnswer(statusData.answer);
            setTimeout(() => {
              onPairSuccess();
              onClose();
            }, 600);
          }
        } catch (pollErr) {
          console.warn('Poll error:', pollErr);
        }
      }, 1200);
    } catch (err: any) {
      setErrorMsg(err.message || 'Signal room creation failed');
      setRoomStatusText('');
    } finally {
      setIsRoomLoading(false);
    }
  };

  // Join signal room (Enter Code / Scan)
  const handleJoinSignalRoom = async (codeToUse?: string) => {
    const code = (codeToUse || joinCodeInput).trim().toUpperCase();
    if (!code || code.length !== 6) {
      setErrorMsg('Please enter a valid 6-character pairing code');
      return;
    }

    try {
      setIsRoomLoading(true);
      setErrorMsg('');
      setRoomStatusText(`Connecting with code ${code}...`);

      const joinRes = await fetch(`/api/signaling/room/${code}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: 'responder' }),
      });
      const joinData = await joinRes.json();
      if (!joinData.success || !joinData.offer) {
        throw new Error('This code has expired or is invalid. Please request a new 1-minute code.');
      }

      setRoomStatusText('Authenticating & signing ECDSA keys...');
      const answer = await peerManager.acceptOffer(joinData.offer);
      setAnswerData(answer);

      // Post answer back
      await fetch(`/api/signaling/room/${code}/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer }),
      });

      setRoomStatusText('Connected! Opening chat...');
      setTimeout(() => {
        onPairSuccess();
        onClose();
      }, 800);
    } catch (err: any) {
      setErrorMsg(err.message || 'Connecting to peer failed');
      setRoomStatusText('');
    } finally {
      setIsRoomLoading(false);
    }
  };

  // Manual SDP handler
  const handleProcessManualInput = async () => {
    try {
      setErrorMsg('');
      const parsed = JSON.parse(manualInputJson.trim());
      if (parsed.role === 'initiator') {
        const answer = await peerManager.acceptOffer(parsed);
        setAnswerData(answer);
        const jsonStr = JSON.stringify(answer);
        const chunks = encodeToQrChunks(jsonStr);
        setQrChunks(chunks);
        setCurrentChunkIndex(0);
      } else if (parsed.role === 'responder') {
        await peerManager.acceptAnswer(parsed);
        onPairSuccess();
        onClose();
      } else {
        throw new Error('Unrecognized handshake payload');
      }
    } catch (err: any) {
      setErrorMsg(`Handshake error: ${err.message}`);
    }
  };

  // Camera Scanning Loop
  const startCamera = async () => {
    try {
      setErrorMsg('');
      setIsCameraActive(true);
      collectorRef.current.reset();
      setScanProgress('Align the QR code in the frame to connect securely.');

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      cameraStreamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.setAttribute('playsinline', 'true');
        await videoRef.current.play();
        requestAnimationFrame(scanVideoLoop);
      }
    } catch (err: any) {
      setErrorMsg(`Camera access unavailable: ${err.message}`);
      setIsCameraActive(false);
    }
  };

  const stopCamera = () => {
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach((t) => t.stop());
      cameraStreamRef.current = null;
    }
    setIsCameraActive(false);
  };

  const scanVideoLoop = () => {
    if (!isCameraActive || !videoRef.current || !scanCanvasRef.current) return;
    const video = videoRef.current;
    const canvas = scanCanvasRef.current;

    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const code = scanCanvasForQr(canvas);
        if (code) {
          try {
            const parsedRoom = JSON.parse(code);
            if (parsedRoom.app === 'scryptChat' && parsedRoom.room) {
              stopCamera();
              handleJoinSignalRoom(parsedRoom.room);
              return;
            }
          } catch {}

          const res = collectorRef.current.processScannedText(code);
          setScanProgress(res.progress);
          if (res.completed && res.fullPayload) {
            stopCamera();
            setManualInputJson(res.fullPayload);
            try {
              const parsed = JSON.parse(res.fullPayload);
              if (parsed.role === 'initiator') {
                peerManager.acceptOffer(parsed).then((ans) => {
                  setAnswerData(ans);
                  const chunks = encodeToQrChunks(JSON.stringify(ans));
                  setQrChunks(chunks);
                  setCurrentChunkIndex(0);
                });
              } else if (parsed.role === 'responder') {
                peerManager.acceptAnswer(parsed).then(() => {
                  onPairSuccess();
                  onClose();
                });
              }
            } catch (pErr: any) {
              setErrorMsg(`Scanned payload error: ${pErr.message}`);
            }
            return;
          }
        }
      }
    }
    requestAnimationFrame(scanVideoLoop);
  };

  const copyRoomCode = () => {
    if (!roomCode) return;
    navigator.clipboard.writeText(roomCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Format 6 character code as e.g. "7249 • AF" or "724 • 9AF"
  const formattedCode = roomCode
    ? `${roomCode.slice(0, 3)} • ${roomCode.slice(3)}`
    : '------';

  if (!isOpen) return null;

  return (
    <div
      id="pairing-modal-backdrop"
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 select-none font-sans"
    >
      <div className="w-full max-w-md bg-[#18181b] border border-[#27272a] rounded-2xl shadow-xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Top Bar */}
        <div className="px-5 py-3.5 flex items-center justify-between border-b border-[#27272a]">
          {screen !== 'menu' ? (
            <button
              onClick={() => {
                stopCamera();
                setScreen('menu');
              }}
              className="p-1 text-[#a1a1aa] hover:text-white rounded-lg transition-colors flex items-center gap-1 text-xs"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back</span>
            </button>
          ) : (
            <div className="text-sm font-semibold text-white tracking-tight">
              Add contact
            </div>
          )}

          <div className="text-xs font-medium text-[#a1a1aa]">
            {screen === 'scan_qr' && 'Scan QR code'}
            {screen === 'share_code' && 'Your pairing code'}
            {screen === 'enter_code' && 'Use pairing code'}
            {screen === 'manual_sdp' && 'Other methods'}
          </div>

          <button
            onClick={onClose}
            className="p-1 text-[#71717a] hover:text-white hover:bg-[#27272a] rounded-lg transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 overflow-y-auto space-y-4">
          {errorMsg && (
            <div className="p-2.5 bg-red-950/40 border border-red-900 text-red-300 rounded-lg text-xs">
              {errorMsg}
            </div>
          )}

          {/* SCREEN 1: ADD CONTACT MENU */}
          {screen === 'menu' && (
            <div className="space-y-3">
              {/* Menu Options */}
              <div className="space-y-2">
                <button
                  onClick={() => {
                    setScreen('scan_qr');
                    startCamera();
                  }}
                  className="w-full p-3 bg-[#09090b] hover:bg-[#27272a] border border-[#27272a] rounded-xl flex items-center justify-between text-left transition-all group"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-[#18181b] border border-[#27272a] flex items-center justify-center text-white">
                      <QrCode className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="text-xs font-medium text-white">Scan QR code</div>
                      <div className="text-[11px] text-[#71717a]">Scan a code with your camera</div>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-[#71717a] group-hover:text-white transition-colors" />
                </button>

                <button
                  onClick={() => setScreen('enter_code')}
                  className="w-full p-3 bg-[#09090b] hover:bg-[#27272a] border border-[#27272a] rounded-xl flex items-center justify-between text-left transition-all group"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-[#18181b] border border-[#27272a] flex items-center justify-center text-white">
                      <Key className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="text-xs font-medium text-white">Enter pairing code</div>
                      <div className="text-[11px] text-[#71717a]">Enter 6-character code from peer</div>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-[#71717a] group-hover:text-white transition-colors" />
                </button>

                <button
                  onClick={() => {
                    setScreen('share_code');
                    if (!roomCode) handleCreateRollingRoom();
                  }}
                  className="w-full p-3 bg-[#09090b] hover:bg-[#27272a] border border-[#27272a] rounded-xl flex items-center justify-between text-left transition-all group"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-[#18181b] border border-[#27272a] flex items-center justify-center text-white">
                      <Share2 className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="text-xs font-medium text-white">Share my code</div>
                      <div className="text-[11px] text-[#71717a]">Show my QR code or pairing code</div>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-[#71717a] group-hover:text-white transition-colors" />
                </button>

                <button
                  onClick={() => setScreen('manual_sdp')}
                  className="w-full p-3 bg-[#09090b] hover:bg-[#27272a] border border-[#27272a] rounded-xl flex items-center justify-between text-left transition-all group"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-[#18181b] border border-[#27272a] flex items-center justify-center text-white">
                      <Layers className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="text-xs font-medium text-white">Manual exchange</div>
                      <div className="text-[11px] text-[#71717a]">Direct SDP handshake</div>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-[#71717a] group-hover:text-white transition-colors" />
                </button>
              </div>
            </div>
          )}

          {/* SCREEN 2: SCAN QR CODE */}
          {screen === 'scan_qr' && (
            <div className="space-y-4 text-center">
              <div className="relative w-full aspect-square max-w-[260px] mx-auto bg-black rounded-xl overflow-hidden border border-[#27272a] shadow-md flex items-center justify-center">
                <video ref={videoRef} className="w-full h-full object-cover" />
                <canvas ref={scanCanvasRef} className="hidden" />

                {/* Viewfinder frame */}
                <div className="absolute inset-0 p-5 pointer-events-none flex flex-col justify-between">
                  <div className="flex justify-between">
                    <div className="w-5 h-5 border-t-2 border-l-2 border-white rounded-tl-md" />
                    <div className="w-5 h-5 border-t-2 border-r-2 border-white rounded-tr-md" />
                  </div>
                  <div className="flex justify-between">
                    <div className="w-5 h-5 border-b-2 border-l-2 border-white rounded-bl-md" />
                    <div className="w-5 h-5 border-b-2 border-r-2 border-white rounded-br-md" />
                  </div>
                  <div className="scan-laser-line" />
                </div>
              </div>

              <p className="text-xs text-[#71717a]">
                {scanProgress}
              </p>

              <div className="flex items-center justify-center gap-2 pt-1">
                <button
                  onClick={() => (isCameraActive ? stopCamera() : startCamera())}
                  className="px-3.5 py-1.5 bg-[#27272a] hover:bg-[#3f3f46] text-white rounded-lg text-xs font-medium transition-colors"
                >
                  {isCameraActive ? 'Pause Camera' : 'Start Camera'}
                </button>
                <button
                  onClick={() => {
                    stopCamera();
                    setScreen('enter_code');
                  }}
                  className="px-3.5 py-1.5 bg-white hover:bg-neutral-200 text-black rounded-lg text-xs font-medium transition-colors"
                >
                  Enter code instead
                </button>
              </div>
            </div>
          )}

          {/* SCREEN 3: SHARE CODE / YOUR PAIRING CODE */}
          {screen === 'share_code' && (
            <div className="space-y-3.5 text-center">
              {/* Dynamic QR Display */}
              <div className="p-3 bg-white rounded-xl inline-block mx-auto shadow-md">
                <canvas ref={rollingQrCanvasRef} className="w-44 h-44 rounded bg-white" />
              </div>

              {/* Formatted Code Card */}
              <div className="p-3 bg-[#09090b] border border-[#27272a] rounded-xl">
                <div className="text-xl font-semibold tracking-widest text-white font-mono">
                  {formattedCode}
                </div>
                <div className="mt-1 flex items-center justify-center gap-1 text-[11px] text-[#71717a]">
                  <Clock className="w-3 h-3 text-amber-400" />
                  <span>Expires in 00:{remainingSeconds.toString().padStart(2, '0')}</span>
                </div>
                <div className="w-full h-1 bg-[#27272a] rounded-full overflow-hidden mt-2">
                  <div
                    className="h-full bg-white transition-all duration-1000 ease-linear rounded-full"
                    style={{ width: `${(remainingSeconds / 60) * 100}%` }}
                  />
                </div>
              </div>

              {/* Action Buttons */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={copyRoomCode}
                  className="py-2 px-3 bg-[#27272a] hover:bg-[#3f3f46] text-white rounded-lg text-xs font-medium transition-colors flex items-center justify-center gap-1.5"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copied ? 'Copied' : 'Copy code'}</span>
                </button>

                <button
                  onClick={handleCreateRollingRoom}
                  disabled={isRoomLoading}
                  className="py-2 px-3 bg-white hover:bg-neutral-200 text-black rounded-lg text-xs font-medium transition-colors flex items-center justify-center gap-1.5"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isRoomLoading ? 'animate-spin' : ''}`} />
                  <span>New code</span>
                </button>
              </div>

              {roomStatusText && (
                <div className="p-2 bg-[#09090b] border border-[#27272a] text-[#71717a] rounded-lg text-[11px] flex items-center justify-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span>{roomStatusText}</span>
                </div>
              )}
            </div>
          )}

          {/* SCREEN 4: USE PAIRING CODE */}
          {screen === 'enter_code' && (
            <div className="space-y-3">
              <div className="p-4 bg-[#09090b] border border-[#27272a] rounded-xl text-center space-y-3">
                <input
                  id="pairing-code-input"
                  type="text"
                  maxLength={6}
                  value={joinCodeInput}
                  onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase())}
                  placeholder="CODE"
                  autoFocus
                  className="w-full bg-[#18181b] border border-[#27272a] rounded-lg py-2.5 text-center text-xl font-semibold tracking-widest text-white uppercase focus:outline-none focus:border-white font-mono transition-colors"
                />

                <button
                  onClick={() => handleJoinSignalRoom()}
                  disabled={isRoomLoading || joinCodeInput.length !== 6}
                  className="w-full py-2.5 bg-white hover:bg-neutral-200 disabled:opacity-30 text-black font-semibold rounded-lg text-xs transition-colors"
                >
                  {isRoomLoading ? 'Connecting...' : 'Connect'}
                </button>
              </div>

              {roomStatusText && (
                <div className="p-2 bg-[#09090b] border border-[#27272a] text-[#71717a] rounded-lg text-[11px] flex items-center justify-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span>{roomStatusText}</span>
                </div>
              )}
            </div>
          )}

          {/* SCREEN 5: MANUAL SDP */}
          {screen === 'manual_sdp' && (
            <div className="space-y-3 text-xs">
              <div className="p-3 bg-[#09090b] border border-[#27272a] rounded-lg space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-white">Your Handshake JSON</span>
                  <button
                    onClick={() => {
                      const text = JSON.stringify(offerData || answerData || '');
                      navigator.clipboard.writeText(text);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    }}
                    className="flex items-center gap-1 text-[#a1a1aa] hover:text-white px-2 py-0.5 bg-[#27272a] rounded text-[11px]"
                  >
                    {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    <span>{copied ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
                <textarea
                  readOnly
                  rows={3}
                  value={JSON.stringify(offerData || answerData || {}, null, 2)}
                  className="w-full bg-[#18181b] border border-[#27272a] rounded p-2 text-[10px] text-[#a1a1aa] font-mono focus:outline-none"
                />
              </div>

              <div className="p-3 bg-[#09090b] border border-[#27272a] rounded-lg space-y-2">
                <span className="font-medium text-white block">Paste Peer Handshake JSON</span>
                <textarea
                  rows={3}
                  value={manualInputJson}
                  onChange={(e) => setManualInputJson(e.target.value)}
                  placeholder="Paste peer JSON..."
                  className="w-full bg-[#18181b] border border-[#27272a] rounded p-2 text-[10px] text-white font-mono focus:outline-none focus:border-white"
                />
                <button
                  onClick={handleProcessManualInput}
                  disabled={!manualInputJson.trim()}
                  className="w-full py-2 bg-white hover:bg-neutral-200 disabled:opacity-30 text-black font-semibold rounded-lg transition-colors text-xs"
                >
                  Establish P2P Channel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

