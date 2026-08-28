import React, { useState, useEffect, useRef } from 'react';
import { PeerManager } from '../webrtc/peerManager';
import {
  HandshakeAnswerData,
  HandshakeOfferData,
} from '../types/index';
import {
  encodeToQrChunks,
  QrChunkCollector,
  generateQrDataUrl,
  scanCanvasForQr,
  extractRoomCodeFromScannedText,
} from '../webrtc/qrStream';
import {
  X,
  QrCode,
  Key,
  Camera,
  Copy,
  Check,
  RefreshCw,
  Clock,
  Layers,
  Sparkles,
} from 'lucide-react';

interface PairingModalProps {
  isOpen: boolean;
  peerManager: PeerManager;
  initialCode?: string;
  onClose: () => void;
  onPairSuccess: () => void;
}

type TabType = 'my_code' | 'scan' | 'enter' | 'manual';

export const PairingModal: React.FC<PairingModalProps> = ({
  isOpen,
  peerManager,
  initialCode,
  onClose,
  onPairSuccess,
}) => {
  const [activeTab, setActiveTab] = useState<TabType>(initialCode ? 'enter' : 'my_code');

  // Active host room state
  const [roomCode, setRoomCode] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState(120);
  const [isGeneratingRoom, setIsGeneratingRoom] = useState(false);

  // Join input state
  const [joinInput, setJoinInput] = useState(initialCode || '');
  const [isConnecting, setIsConnecting] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [isSuccess, setIsSuccess] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [copied, setCopied] = useState(false);

  // Camera state
  const [isCameraRunning, setIsCameraRunning] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const scanCanvasRef = useRef<HTMLCanvasElement>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const isScanningRef = useRef(false);
  const scanAnimFrameRef = useRef<number | null>(null);
  const collectorRef = useRef<QrChunkCollector>(new QrChunkCollector());

  // Manual SDP state
  const [offerData, setOfferData] = useState<HandshakeOfferData | null>(null);
  const [answerData, setAnswerData] = useState<HandshakeAnswerData | null>(null);
  const [manualInputJson, setManualInputJson] = useState('');

  // Polling ref
  const pollIntervalRef = useRef<any>(null);
  const countdownIntervalRef = useRef<any>(null);

  // When initialCode changes or modal opens with one
  useEffect(() => {
    if (initialCode) {
      setJoinInput(initialCode.toUpperCase());
      setActiveTab('enter');
    }
  }, [initialCode]);

  // When modal opens/closes
  useEffect(() => {
    if (isOpen) {
      setErrorMsg('');
      setIsSuccess(false);
      setStatusMessage('');
      if (initialCode) {
        setJoinInput(initialCode.toUpperCase());
        setActiveTab('enter');
      } else {
        // Check if existing room is still valid (> 10s remaining)
        const now = Date.now();
        if (!roomCode || !expiresAt || expiresAt - now < 10000) {
          handleGenerateRoom();
        } else {
          // Resume countdown
          startCountdown(expiresAt);
          startHostPolling(roomCode);
        }
      }
    } else {
      stopCamera();
      stopPolling();
      stopCountdown();
    }
  }, [isOpen]);

  // Handle Tab Switch
  useEffect(() => {
    setErrorMsg('');
    setStatusMessage('');
    if (activeTab === 'scan') {
      startCamera();
    } else {
      stopCamera();
    }

    if (activeTab === 'my_code') {
      const now = Date.now();
      if (!roomCode || !expiresAt || expiresAt - now < 10000) {
        handleGenerateRoom();
      } else {
        startHostPolling(roomCode);
        startCountdown(expiresAt);
      }
    }
  }, [activeTab]);

  // Clean intervals on unmount
  useEffect(() => {
    return () => {
      stopCamera();
      stopPolling();
      stopCountdown();
    };
  }, []);

  const stopPolling = () => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  };

  const stopCountdown = () => {
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
  };

  const startCountdown = (expiryTimestamp: number) => {
    stopCountdown();
    const updateTime = () => {
      const diff = Math.max(0, Math.floor((expiryTimestamp - Date.now()) / 1000));
      setRemainingSeconds(diff);
      if (diff <= 0) {
        stopCountdown();
        stopPolling();
        setStatusMessage('Code expired. Generating a new code...');
        handleGenerateRoom();
      }
    };
    updateTime();
    countdownIntervalRef.current = setInterval(updateTime, 1000);
  };

  // Host: Generate room and render QR
  const handleGenerateRoom = async () => {
    if (isGeneratingRoom) return;
    try {
      setIsGeneratingRoom(true);
      setErrorMsg('');
      setStatusMessage('Creating cryptographic key pair and code...');

      // 1. Create WebRTC offer
      const offer = await peerManager.createOffer();
      setOfferData(offer);

      // 2. Register room on signaling server with offer included
      const res = await peerManager.fetchRelay('/api/signaling/room/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceId: offer.deviceId,
          offer,
          ttlSeconds: 120,
        }),
      }, 5000);

      const data = await res.json();
      if (!data.success || !data.roomId) {
        throw new Error(data.error || 'Failed to create pairing room');
      }

      const newCode = data.roomId.toUpperCase();
      const newExpiry = data.expiresAt || (Date.now() + 120000);

      setRoomCode(newCode);
      setExpiresAt(newExpiry);
      setRemainingSeconds(Math.max(0, Math.floor((newExpiry - Date.now()) / 1000)));

      // 3. Generate QR code as stable data URL
      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      const pairingUrl = `${origin}/?room=${newCode}`;
      const dataUrl = await generateQrDataUrl(pairingUrl);
      setQrDataUrl(dataUrl);

      setStatusMessage('Waiting for peer to scan or enter code...');
      startCountdown(newExpiry);
      startHostPolling(newCode);
    } catch (err: any) {
      console.error('Failed to generate pairing room:', err);
      setErrorMsg(err.message || 'Could not connect to signaling server');
      setStatusMessage('');
    } finally {
      setIsGeneratingRoom(false);
    }
  };

  // Host: Poll for peer's answer
  const startHostPolling = (code: string) => {
    stopPolling();
    pollIntervalRef.current = setInterval(async () => {
      try {
        const res = await peerManager.fetchRelay(`/api/signaling/room/${code}/status`, {
          method: 'GET',
        }, 3000);
        const data = await res.json();
        if (data.hasAnswer && data.answer) {
          stopPolling();
          stopCountdown();
          setStatusMessage('Peer response received. Authenticating cryptographic key...');

          await peerManager.acceptAnswer(data.answer);

          // Confirm handshake
          await peerManager.confirmPairingOnRelay(code);

          setIsSuccess(true);
          setStatusMessage('Connected. Direct P2P channel established.');
          setTimeout(() => {
            onPairSuccess();
            onClose();
          }, 800);
        }
      } catch (pollErr) {
        // Silently retry on next poll tick
      }
    }, 1100);
  };

  // Join: Connect with room code
  const handleJoinSignalRoom = async (codeToUse?: string) => {
    const raw = (codeToUse || joinInput).trim().toUpperCase();
    const code = extractRoomCodeFromScannedText(raw) || raw;

    if (!code || code.length !== 6) {
      setErrorMsg('Please enter a valid 6-character pairing code');
      return;
    }

    try {
      setIsConnecting(true);
      setErrorMsg('');
      setStatusMessage(`Connecting to peer with code ${code}...`);

      const joinRes = await peerManager.fetchRelay(`/api/signaling/room/${code}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: 'responder' }),
      }, 5000);

      const joinData = await joinRes.json();
      if (!joinData.success || !joinData.offer) {
        throw new Error(joinData.error || 'This code has expired or was not found. Please ask for a new code.');
      }

      setStatusMessage('Authenticating ECDSA identity & computing session keys...');
      const answer = await peerManager.acceptOffer(joinData.offer);
      setAnswerData(answer);

      setStatusMessage('Transmitting answer to peer...');
      await peerManager.fetchRelay(`/api/signaling/room/${code}/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer }),
      }, 5000);

      // Confirm match on signaling server
      await peerManager.confirmPairingOnRelay(code);

      setIsSuccess(true);
      setStatusMessage('Connected. Direct P2P channel established.');
      setTimeout(() => {
        onPairSuccess();
        onClose();
      }, 800);
    } catch (err: any) {
      console.error('Join signal room error:', err);
      setErrorMsg(err.message || 'Connection failed. Please check the code.');
      setStatusMessage('');
    } finally {
      setIsConnecting(false);
    }
  };

  // Camera Management
  const startCamera = async () => {
    try {
      setCameraError('');
      setErrorMsg('');
      isScanningRef.current = true;
      collectorRef.current.reset();

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });

      cameraStreamRef.current = stream;
      setIsCameraRunning(true);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.setAttribute('playsinline', 'true');
        videoRef.current.muted = true;
        await videoRef.current.play();
        runScanLoop();
      }
    } catch (err: any) {
      console.warn('Camera access error:', err);
      isScanningRef.current = false;
      setIsCameraRunning(false);
      setCameraError('Camera access is unavailable. You can enter the 6-character code manually.');
    }
  };

  const stopCamera = () => {
    isScanningRef.current = false;
    if (scanAnimFrameRef.current) {
      cancelAnimationFrame(scanAnimFrameRef.current);
      scanAnimFrameRef.current = null;
    }
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach((track) => track.stop());
      cameraStreamRef.current = null;
    }
    setIsCameraRunning(false);
  };

  // Continuous Camera Scan Loop
  const runScanLoop = () => {
    if (!isScanningRef.current) return;
    const video = videoRef.current;
    const canvas = scanCanvasRef.current;

    if (video && canvas && video.readyState >= video.HAVE_CURRENT_DATA) {
      // Scale down to max 640px for instant scanning performance
      const MAX_DIM = 640;
      let w = video.videoWidth;
      let h = video.videoHeight;
      if (w > MAX_DIM || h > MAX_DIM) {
        if (w > h) {
          h = Math.round((h * MAX_DIM) / w);
          w = MAX_DIM;
        } else {
          w = Math.round((w * MAX_DIM) / h);
          h = MAX_DIM;
        }
      }

      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        ctx.drawImage(video, 0, 0, w, h);
        const scannedText = scanCanvasForQr(canvas);

        if (scannedText) {
          const matchedCode = extractRoomCodeFromScannedText(scannedText);
          if (matchedCode) {
            stopCamera();
            setStatusMessage(`Scanned code: ${matchedCode}. Connecting...`);
            handleJoinSignalRoom(matchedCode);
            return;
          }

          // Chunked fallback for offline SDP
          const chunkRes = collectorRef.current.processScannedText(scannedText);
          if (chunkRes.completed && chunkRes.fullPayload) {
            stopCamera();
            try {
              const parsed = JSON.parse(chunkRes.fullPayload);
              if (parsed.role === 'initiator') {
                peerManager.acceptOffer(parsed).then(() => {
                  onPairSuccess();
                  onClose();
                });
              } else if (parsed.role === 'responder') {
                peerManager.acceptAnswer(parsed).then(() => {
                  onPairSuccess();
                  onClose();
                });
              }
            } catch (err: any) {
              setErrorMsg('Invalid QR payload');
            }
            return;
          }
        }
      }
    }

    if (isScanningRef.current) {
      scanAnimFrameRef.current = requestAnimationFrame(runScanLoop);
    }
  };

  // Manual SDP Processing
  const handleProcessManualInput = async () => {
    try {
      setErrorMsg('');
      const parsed = JSON.parse(manualInputJson.trim());
      if (parsed.role === 'initiator') {
        const ans = await peerManager.acceptOffer(parsed);
        setAnswerData(ans);
      } else if (parsed.role === 'responder') {
        await peerManager.acceptAnswer(parsed);
        setIsSuccess(true);
        setTimeout(() => {
          onPairSuccess();
          onClose();
        }, 700);
      }
    } catch (err: any) {
      setErrorMsg(`Manual handshake error: ${err.message}`);
    }
  };

  const copyRoomCode = () => {
    if (!roomCode) return;
    navigator.clipboard.writeText(roomCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!isOpen) return null;

  const formattedCode = roomCode
    ? `${roomCode.slice(0, 3)} • ${roomCode.slice(3)}`
    : '------';

  return (
    <div
      id="pairing-modal-backdrop"
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 select-none font-sans"
    >
      <div className="w-full max-w-md bg-[#18181b] border border-[#27272a] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Top Header */}
        <div className="px-5 py-3.5 flex items-center justify-between border-b border-[#27272a]">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-white tracking-tight">
              Connect Device
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-[#71717a] hover:text-white hover:bg-[#27272a] rounded-lg transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="grid grid-cols-3 p-1.5 mx-4 mt-3 bg-[#09090b] border border-[#27272a] rounded-xl text-xs font-medium">
          <button
            onClick={() => setActiveTab('my_code')}
            className={`py-1.5 rounded-lg transition-all flex items-center justify-center gap-1.5 ${
              activeTab === 'my_code'
                ? 'bg-[#27272a] text-white font-semibold shadow-sm'
                : 'text-[#71717a] hover:text-white'
            }`}
          >
            <QrCode className="w-3.5 h-3.5" />
            <span>My QR Code</span>
          </button>
          <button
            onClick={() => setActiveTab('scan')}
            className={`py-1.5 rounded-lg transition-all flex items-center justify-center gap-1.5 ${
              activeTab === 'scan'
                ? 'bg-[#27272a] text-white font-semibold shadow-sm'
                : 'text-[#71717a] hover:text-white'
            }`}
          >
            <Camera className="w-3.5 h-3.5" />
            <span>Scan QR</span>
          </button>
          <button
            onClick={() => setActiveTab('enter')}
            className={`py-1.5 rounded-lg transition-all flex items-center justify-center gap-1.5 ${
              activeTab === 'enter'
                ? 'bg-[#27272a] text-white font-semibold shadow-sm'
                : 'text-[#71717a] hover:text-white'
            }`}
          >
            <Key className="w-3.5 h-3.5" />
            <span>Enter Code</span>
          </button>
        </div>

        {/* Body Content */}
        <div className="p-5 overflow-y-auto space-y-4">
          {errorMsg && (
            <div className="p-2.5 bg-red-950/40 border border-red-900/60 text-red-300 rounded-xl text-xs">
              {errorMsg}
            </div>
          )}

          {/* TAB 1: MY QR CODE & PAIRING CODE */}
          {activeTab === 'my_code' && (
            <div className="space-y-4 text-center">
              {/* QR Image Display */}
              <div className="p-3 bg-white rounded-2xl inline-block mx-auto shadow-md">
                {qrDataUrl ? (
                  <img
                    src={qrDataUrl}
                    alt="Pairing QR Code"
                    className="w-48 h-48 block mx-auto rounded bg-white"
                  />
                ) : (
                  <div className="w-48 h-48 flex items-center justify-center text-black text-xs">
                    <RefreshCw className="w-5 h-5 animate-spin" />
                  </div>
                )}
              </div>

              {/* 6-Character Code Card */}
              <div className="p-3.5 bg-[#09090b] border border-[#27272a] rounded-xl space-y-1.5">
                <div className="text-2xl font-bold tracking-widest text-white font-mono">
                  {formattedCode}
                </div>
                <div className="flex items-center justify-center gap-1.5 text-[11px] text-[#71717a]">
                  <Clock className="w-3.5 h-3.5 text-amber-400" />
                  <span>
                    Valid for {Math.floor(remainingSeconds / 60)}:
                    {(remainingSeconds % 60).toString().padStart(2, '0')}
                  </span>
                </div>
                {/* Progress bar */}
                <div className="w-full h-1 bg-[#27272a] rounded-full overflow-hidden mt-2">
                  <div
                    className="h-full bg-white transition-all duration-1000 ease-linear rounded-full"
                    style={{ width: `${(remainingSeconds / 120) * 100}%` }}
                  />
                </div>
              </div>

              {/* Action Buttons */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={copyRoomCode}
                  disabled={!roomCode}
                  className="py-2 px-3 bg-[#27272a] hover:bg-[#3f3f46] disabled:opacity-50 text-white rounded-lg text-xs font-medium transition-colors flex items-center justify-center gap-1.5"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copied ? 'Copied' : 'Copy Code'}</span>
                </button>

                <button
                  onClick={handleGenerateRoom}
                  disabled={isGeneratingRoom}
                  className="py-2 px-3 bg-white hover:bg-neutral-200 disabled:opacity-50 text-black rounded-lg text-xs font-medium transition-colors flex items-center justify-center gap-1.5"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isGeneratingRoom ? 'animate-spin' : ''}`} />
                  <span>New Code</span>
                </button>
              </div>
            </div>
          )}

          {/* TAB 2: SCAN CAMERA */}
          {activeTab === 'scan' && (
            <div className="space-y-4 text-center">
              <div className="relative w-full aspect-square max-w-[260px] mx-auto bg-black rounded-2xl overflow-hidden border border-[#27272a] shadow-inner flex items-center justify-center">
                <video
                  ref={videoRef}
                  className="w-full h-full object-cover"
                  playsInline
                  muted
                />
                <canvas ref={scanCanvasRef} className="hidden" />

                {/* Viewfinder Target */}
                <div className="absolute inset-0 p-6 pointer-events-none flex flex-col justify-between">
                  <div className="flex justify-between">
                    <div className="w-6 h-6 border-t-2 border-l-2 border-white rounded-tl" />
                    <div className="w-6 h-6 border-t-2 border-r-2 border-white rounded-tr" />
                  </div>
                  <div className="flex justify-between">
                    <div className="w-6 h-6 border-b-2 border-l-2 border-white rounded-bl" />
                    <div className="w-6 h-6 border-b-2 border-r-2 border-white rounded-br" />
                  </div>
                  <div className="scan-laser-line" />
                </div>
              </div>

              {cameraError ? (
                <div className="p-3 bg-amber-950/40 border border-amber-900 text-amber-200 rounded-xl text-xs space-y-2">
                  <p>{cameraError}</p>
                  <button
                    onClick={() => setActiveTab('enter')}
                    className="px-3 py-1.5 bg-white text-black font-semibold rounded-lg text-xs transition-colors"
                  >
                    Enter Code Instead
                  </button>
                </div>
              ) : (
                <p className="text-xs text-[#71717a]">
                  Point camera at peer&apos;s pairing QR code to connect automatically.
                </p>
              )}

              <div className="flex justify-center gap-2">
                <button
                  onClick={() => (isCameraRunning ? stopCamera() : startCamera())}
                  className="px-3.5 py-1.5 bg-[#27272a] hover:bg-[#3f3f46] text-white rounded-lg text-xs font-medium transition-colors"
                >
                  {isCameraRunning ? 'Pause Camera' : 'Start Camera'}
                </button>
              </div>
            </div>
          )}

          {/* TAB 3: ENTER CODE */}
          {activeTab === 'enter' && (
            <div className="space-y-4">
              <div className="p-4 bg-[#09090b] border border-[#27272a] rounded-xl text-center space-y-3">
                <label htmlFor="pair-code-input" className="text-xs text-[#71717a] block">
                  Enter the 6-character code displayed on your other device
                </label>
                <input
                  id="pair-code-input"
                  type="text"
                  maxLength={6}
                  value={joinInput}
                  onChange={(e) => setJoinInput(e.target.value.toUpperCase())}
                  placeholder="ABCDEF"
                  autoFocus
                  className="w-full bg-[#18181b] border border-[#27272a] rounded-lg py-3 text-center text-2xl font-bold tracking-widest text-white uppercase focus:outline-none focus:border-white font-mono transition-colors"
                />

                <button
                  onClick={() => handleJoinSignalRoom()}
                  disabled={isConnecting || joinInput.trim().length !== 6}
                  className="w-full py-2.5 bg-white hover:bg-neutral-200 disabled:opacity-30 text-black font-semibold rounded-lg text-xs transition-colors"
                >
                  {isConnecting ? 'Connecting...' : 'Connect Peer'}
                </button>
              </div>
            </div>
          )}

          {/* TAB 4: MANUAL SDP (Optional expander) */}
          {activeTab === 'manual' && (
            <div className="space-y-3 text-xs">
              <div className="p-3 bg-[#09090b] border border-[#27272a] rounded-xl space-y-2">
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

              <div className="p-3 bg-[#09090b] border border-[#27272a] rounded-xl space-y-2">
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

          {/* Status notification banner */}
          {statusMessage && (
            <div className="p-2.5 bg-[#09090b] border border-[#27272a] text-[#a1a1aa] rounded-xl text-xs flex items-center justify-center gap-2">
              <div
                className={`w-2 h-2 rounded-full ${
                  isSuccess ? 'bg-emerald-400' : 'bg-emerald-400 animate-pulse'
                }`}
              />
              <span>{statusMessage}</span>
            </div>
          )}

          {/* Toggle Manual SDP */}
          <div className="text-center pt-1">
            <button
              onClick={() => setActiveTab(activeTab === 'manual' ? 'my_code' : 'manual')}
              className="text-[11px] text-[#71717a] hover:text-[#a1a1aa] transition-colors"
            >
              {activeTab === 'manual' ? 'Show QR & Code' : 'Manual SDP exchange'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
