import React, { useState, useEffect, useRef } from 'react';
import { PeerManager } from '../webrtc/peerManager';
import {
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
  Wifi,
  Radio,
  Shield,
  ArrowRight,
  AlertCircle,
} from 'lucide-react';
import {
  LanDiscoveryService,
  LanDiscoveredPeer,
  LanIncomingInvite,
} from '../webrtc/lanDiscovery';

interface PairingModalProps {
  isOpen: boolean;
  peerManager: PeerManager;
  initialCode?: string;
  onClose: () => void;
  onPairSuccess: () => void;
}

type TabType = 'my_code' | 'enter' | 'scan' | 'lan';

export const PairingModal: React.FC<PairingModalProps> = ({
  isOpen,
  peerManager,
  initialCode,
  onClose,
  onPairSuccess,
}) => {
  const [activeTab, setActiveTab] = useState<TabType>(initialCode ? 'enter' : 'my_code');

  // Host code state (MANUAL ONLY)
  const [roomCode, setRoomCode] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [isGeneratingRoom, setIsGeneratingRoom] = useState(false);

  // Join state
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

  // Local Network (LAN) state
  const [isLanScanning, setIsLanScanning] = useState(false);
  const [isLanVisible, setIsLanVisible] = useState(false);
  const [lanPeers, setLanPeers] = useState<LanDiscoveredPeer[]>([]);
  const [incomingInvite, setIncomingInvite] = useState<LanIncomingInvite | null>(null);
  const [lanConnectingPeerId, setLanConnectingPeerId] = useState<string | null>(null);
  const lanDiscoveryRef = useRef<LanDiscoveryService | null>(null);

  // Polling ref
  const pollIntervalRef = useRef<any>(null);
  const countdownIntervalRef = useRef<any>(null);

  useEffect(() => {
    if (initialCode) {
      setJoinInput(initialCode.toUpperCase());
      setActiveTab('enter');
    }
  }, [initialCode]);

  useEffect(() => {
    if (isOpen) {
      setErrorMsg('');
      setIsSuccess(false);
      setStatusMessage('');

      lanDiscoveryRef.current = new LanDiscoveryService(
        peerManager,
        peerManager.identity,
        {
          onPeersUpdate: (peers) => setLanPeers(peers),
          onIncomingInvite: (invite) => setIncomingInvite(invite),
          onPairSuccess: () => {
            setIsSuccess(true);
            setStatusMessage('Connected via local network.');
            setTimeout(() => {
              onPairSuccess();
              onClose();
            }, 700);
          },
          onError: (errText) => setErrorMsg(errText),
        }
      );
    } else {
      stopCamera();
      stopPolling();
      stopCountdown();
      lanDiscoveryRef.current?.destroy();
      lanDiscoveryRef.current = null;
      setIsLanScanning(false);
      setIsLanVisible(false);
      setLanPeers([]);
      setIncomingInvite(null);
    }
  }, [isOpen]);

  useEffect(() => {
    setErrorMsg('');
    setStatusMessage('');
    if (activeTab === 'scan') {
      startCamera();
    } else {
      stopCamera();
    }
  }, [activeTab]);

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
        setStatusMessage('Pairing code expired.');
      }
    };
    updateTime();
    countdownIntervalRef.current = setInterval(updateTime, 1000);
  };

  // 1. MANUAL ROOM GENERATION (User-triggered only)
  const handleGenerateRoom = async () => {
    if (isGeneratingRoom) return;
    try {
      setIsGeneratingRoom(true);
      setErrorMsg('');
      setStatusMessage('Generating keys and pairing code...');

      // Create ECDH/ECDSA offer
      const offer = await peerManager.createOffer();

      // Register room on signaling (15 min TTL)
      const res = await peerManager.fetchRelay('/api/signaling/room/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceId: offer.deviceId,
          offer,
          ttlSeconds: 900,
        }),
      }, 8000);

      const data = await res.json();
      if (!data.success || !data.roomId) {
        throw new Error(data.error || 'Failed to create pairing session');
      }

      const newCode = data.roomId.toUpperCase();
      const newExpiry = data.expiresAt || (Date.now() + 900000);

      setRoomCode(newCode);
      setExpiresAt(newExpiry);
      setRemainingSeconds(Math.max(0, Math.floor((newExpiry - Date.now()) / 1000)));

      // Generate clean QR code
      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      const pairingUrl = `${origin}/?room=${newCode}`;
      const dataUrl = await generateQrDataUrl(pairingUrl);
      setQrDataUrl(dataUrl);

      setStatusMessage('Pairing code generated. Waiting for peer...');
      startCountdown(newExpiry);
      startHostPolling(newCode);
    } catch (err: any) {
      console.error('Failed to generate pairing code:', err);
      setErrorMsg(err.message || 'Signaling server connection error');
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
          setStatusMessage('Peer connected. Verifying cryptographic signatures...');

          await peerManager.acceptAnswer(data.answer);
          await peerManager.confirmPairingOnRelay(code);

          setIsSuccess(true);
          setStatusMessage('Secure E2EE connection established.');
          setTimeout(() => {
            onPairSuccess();
            onClose();
          }, 800);
        }
      } catch {
        // Retry silently
      }
    }, 1500);
  };

  // 2. JOIN ROOM WITH CODE
  const handleJoinRoom = async (codeToJoin?: string) => {
    const rawCode = codeToJoin || joinInput;
    const cleanCode = extractRoomCodeFromScannedText(rawCode).trim().toUpperCase();

    if (!cleanCode) {
      setErrorMsg('Please enter a valid 6-character code.');
      return;
    }

    try {
      setIsConnecting(true);
      setErrorMsg('');
      setStatusMessage('Connecting to pairing session...');

      const res = await peerManager.fetchRelay(`/api/signaling/room/${cleanCode}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceId: peerManager.identity.deviceId,
        }),
      }, 9000);

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Connection error (Code: ${res.status})`);
      }

      const data = await res.json();
      if (!data.success || !data.offer) {
        throw new Error('Key exchange offer was not found.');
      }

      setStatusMessage('Generating answer and safety keys...');
      const answer = await peerManager.acceptOffer(data.offer);

      await peerManager.fetchRelay(`/api/signaling/room/${cleanCode}/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer }),
      }, 9000);

      setStatusMessage('Finalizing verification...');
      await pollForHandshakeFinalize(cleanCode);
    } catch (err: any) {
      console.error('Join error:', err);
      setErrorMsg(err.message || 'Pairing code not found or expired.');
      setStatusMessage('');
    } finally {
      setIsConnecting(false);
    }
  };

  const pollForHandshakeFinalize = async (code: string) => {
    let attempts = 0;
    const maxAttempts = 15;
    return new Promise<void>((resolve, reject) => {
      const timer = setInterval(async () => {
        attempts++;
        try {
          const res = await peerManager.fetchRelay(`/api/signaling/room/${code}/status`, {
            method: 'GET',
          }, 3000);
          const data = await res.json();
          if (data.isConfirmed || peerManager.isConnected()) {
            clearInterval(timer);
            setIsSuccess(true);
            setStatusMessage('Pairing successful!');
            setTimeout(() => {
              onPairSuccess();
              onClose();
              resolve();
            }, 600);
            return;
          }
        } catch {}

        if (attempts >= maxAttempts) {
          clearInterval(timer);
          if (peerManager.isConnected()) {
            setIsSuccess(true);
            setTimeout(() => {
              onPairSuccess();
              onClose();
              resolve();
            }, 600);
          } else {
            reject(new Error('Verification timeout.'));
          }
        }
      }, 1000);
    });
  };

  // 3. QR CAMERA SCANNER
  const startCamera = async () => {
    stopCamera();
    setCameraError('');
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Camera is not supported in this browser.');
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      cameraStreamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.setAttribute('playsinline', 'true');
        await videoRef.current.play();
        setIsCameraRunning(true);
        isScanningRef.current = true;
        scanLoop();
      }
    } catch (err: any) {
      console.error('Camera error:', err);
      setCameraError(err.message || 'Failed to start camera.');
      setIsCameraRunning(false);
    }
  };

  const stopCamera = () => {
    isScanningRef.current = false;
    if (scanAnimFrameRef.current) {
      cancelAnimationFrame(scanAnimFrameRef.current);
      scanAnimFrameRef.current = null;
    }
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach((t) => t.stop());
      cameraStreamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsCameraRunning(false);
  };

  const scanLoop = () => {
    if (!isScanningRef.current) return;
    const video = videoRef.current;
    const canvas = scanCanvasRef.current;
    if (video && canvas && video.readyState === video.HAVE_ENOUGH_DATA) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const code = scanCanvasForQr(canvas);
        if (code) {
          stopCamera();
          const cleanCode = extractRoomCodeFromScannedText(code);
          setJoinInput(cleanCode);
          setActiveTab('enter');
          handleJoinRoom(cleanCode);
          return;
        }
      }
    }
    scanAnimFrameRef.current = requestAnimationFrame(scanLoop);
  };

  // 4. LAN DISCOVERY
  const handleToggleLanScan = () => {
    if (!lanDiscoveryRef.current) return;
    const next = !isLanScanning;
    setIsLanScanning(next);
    lanDiscoveryRef.current.setScanning(next);
  };

  const handleToggleLanVisibility = () => {
    if (!lanDiscoveryRef.current) return;
    const next = !isLanVisible;
    setIsLanVisible(next);
    lanDiscoveryRef.current.setVisibility(next);
  };

  const handleConnectLanPeer = async (peer: LanDiscoveredPeer) => {
    if (!lanDiscoveryRef.current) return;
    try {
      setLanConnectingPeerId(peer.deviceId);
      setErrorMsg('');
      setStatusMessage(`Connecting to ${peer.displayName}...`);
      await lanDiscoveryRef.current.connectToPeer(peer);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to connect to LAN device');
      setStatusMessage('');
    } finally {
      setLanConnectingPeerId(null);
    }
  };

  const handleAcceptIncomingInvite = async (invite: LanIncomingInvite) => {
    if (!lanDiscoveryRef.current) return;
    try {
      setStatusMessage('Accepting LAN invite...');
      await lanDiscoveryRef.current.acceptInvite(invite);
      setIncomingInvite(null);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to accept LAN invite');
    }
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-150 font-sans select-none">
      <div
        id="pairing-modal-container"
        className="w-full max-w-md bg-[#09090b] border border-[#27272a] rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden"
      >
        {/* Top Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#1f1f23] bg-[#0c0c0e]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#18181b] border border-[#27272a] flex items-center justify-center text-white">
              <Shield className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white tracking-tight">
                Pair New Device
              </h3>
              <p className="text-[11px] text-[#71717a]">
                Direct end-to-end encrypted P2P pairing
              </p>
            </div>
          </div>
          <button
            id="close-pairing-modal-btn"
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#a1a1aa] hover:text-white hover:bg-[#18181b] transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Minimalist Segmented Tabs */}
        <div className="p-2 border-b border-[#1f1f23] bg-[#09090b]">
          <div className="flex p-1 bg-[#141418] border border-[#222226] rounded-xl gap-1">
            <button
              id="tab-my-code-btn"
              onClick={() => setActiveTab('my_code')}
              className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                activeTab === 'my_code'
                  ? 'bg-white text-black font-semibold shadow-sm'
                  : 'text-[#a1a1aa] hover:text-white'
              }`}
            >
              <QrCode className="w-3.5 h-3.5" />
              <span>My Code</span>
            </button>

            <button
              id="tab-enter-code-btn"
              onClick={() => setActiveTab('enter')}
              className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                activeTab === 'enter'
                  ? 'bg-white text-black font-semibold shadow-sm'
                  : 'text-[#a1a1aa] hover:text-white'
              }`}
            >
              <Key className="w-3.5 h-3.5" />
              <span>Enter Code</span>
            </button>

            <button
              id="tab-scan-qr-btn"
              onClick={() => setActiveTab('scan')}
              className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                activeTab === 'scan'
                  ? 'bg-white text-black font-semibold shadow-sm'
                  : 'text-[#a1a1aa] hover:text-white'
              }`}
            >
              <Camera className="w-3.5 h-3.5" />
              <span>Scan QR</span>
            </button>

            <button
              id="tab-lan-btn"
              onClick={() => setActiveTab('lan')}
              className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                activeTab === 'lan'
                  ? 'bg-white text-black font-semibold shadow-sm'
                  : 'text-[#a1a1aa] hover:text-white'
              }`}
            >
              <Wifi className="w-3.5 h-3.5" />
              <span>LAN</span>
            </button>
          </div>
        </div>

        {/* Status / Alert Banners */}
        {errorMsg && (
          <div className="mx-4 mt-3 p-2.5 rounded-xl bg-red-950/40 border border-red-900/50 flex items-center gap-2 text-red-300 text-xs animate-in fade-in">
            <AlertCircle className="w-4 h-4 flex-shrink-0 text-red-400" />
            <div className="flex-1 font-medium">{errorMsg}</div>
          </div>
        )}

        {statusMessage && !errorMsg && (
          <div className="mx-4 mt-3 p-2.5 rounded-xl bg-[#141418] border border-[#27272a] flex items-center gap-2 text-[#e4e4e7] text-xs">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>{statusMessage}</span>
          </div>
        )}

        {/* Modal Body */}
        <div className="p-4 overflow-y-auto flex-1 space-y-4">
          {/* TAB 1: MANUAL CODE GENERATION */}
          {activeTab === 'my_code' && (
            <div className="space-y-4">
              {!roomCode ? (
                <div className="text-center py-8 px-4 bg-[#121215] rounded-xl border border-[#222226] space-y-4">
                  <div className="w-12 h-12 rounded-xl bg-[#1a1a20] border border-[#2e2e38] text-white flex items-center justify-center mx-auto shadow-inner">
                    <Key className="w-6 h-6 text-[#a1a1aa]" />
                  </div>
                  <div className="space-y-1">
                    <h4 className="text-sm font-semibold text-white">Generate Pairing Code</h4>
                    <p className="text-xs text-[#71717a] max-w-xs mx-auto">
                      A code and QR token are generated on-demand with fresh ephemeral keys.
                    </p>
                  </div>
                  <button
                    id="generate-code-submit-btn"
                    onClick={handleGenerateRoom}
                    disabled={isGeneratingRoom}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white hover:bg-neutral-200 text-black font-semibold text-xs shadow-md transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
                  >
                    {isGeneratingRoom ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <QrCode className="w-3.5 h-3.5" />
                    )}
                    <span>{isGeneratingRoom ? 'Generating...' : 'Generate Code & QR'}</span>
                  </button>
                </div>
              ) : (
                <div className="space-y-3 animate-in fade-in">
                  {/* Code Card */}
                  <div className="p-4 bg-[#121215] rounded-xl border border-[#222226] flex flex-col items-center text-center space-y-3">
                    <div className="flex items-center justify-between w-full text-xs text-[#a1a1aa]">
                      <span>One-Time Pairing Code</span>
                      <div className="flex items-center gap-1 font-mono text-emerald-400 text-[11px]">
                        <Clock className="w-3 h-3" />
                        <span>{Math.floor(remainingSeconds / 60)}:{(remainingSeconds % 60).toString().padStart(2, '0')}</span>
                      </div>
                    </div>

                    <div className="text-3xl font-black font-mono tracking-widest text-white bg-[#09090b] px-6 py-2.5 rounded-xl border border-[#27272a] shadow-inner select-all">
                      {roomCode}
                    </div>

                    <div className="flex items-center gap-2 w-full pt-1">
                      <button
                        id="copy-room-code-btn"
                        onClick={() => handleCopy(roomCode)}
                        className="flex-1 py-2 px-3 rounded-lg bg-[#1c1c22] hover:bg-[#27272a] text-white text-xs font-medium flex items-center justify-center gap-1.5 transition-colors border border-[#2c2c36] cursor-pointer"
                      >
                        {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-[#a1a1aa]" />}
                        <span>{copied ? 'Copied' : 'Copy Code'}</span>
                      </button>

                      <button
                        onClick={handleGenerateRoom}
                        disabled={isGeneratingRoom}
                        title="Generate new code"
                        className="p-2 rounded-lg bg-[#1c1c22] hover:bg-[#27272a] text-[#a1a1aa] hover:text-white transition-colors border border-[#2c2c36] cursor-pointer"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${isGeneratingRoom ? 'animate-spin' : ''}`} />
                      </button>
                    </div>
                  </div>

                  {/* QR Code */}
                  {qrDataUrl && (
                    <div className="p-4 bg-[#121215] rounded-xl border border-[#222226] flex flex-col items-center text-center space-y-2">
                      <div className="p-3 bg-white rounded-xl shadow-md">
                        <img src={qrDataUrl} alt="Pairing QR Code" className="w-40 h-40 object-contain" />
                      </div>
                      <p className="text-[11px] text-[#71717a]">
                        Scan this QR code using the camera on your other device
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* TAB 2: ENTER CODE */}
          {activeTab === 'enter' && (
            <div className="space-y-4">
              <div className="p-4 bg-[#121215] rounded-xl border border-[#222226] space-y-3">
                <label className="block text-xs font-medium text-[#e4e4e7]">
                  Enter Peer's 6-character Code
                </label>
                <div className="flex gap-2">
                  <input
                    id="join-code-input"
                    type="text"
                    value={joinInput}
                    onChange={(e) => setJoinInput(e.target.value.toUpperCase())}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !isConnecting) handleJoinRoom();
                    }}
                    placeholder="e.g. 7K9N2P"
                    maxLength={32}
                    className="flex-1 bg-[#09090b] border border-[#27272a] rounded-lg px-3.5 py-2 text-sm font-mono tracking-widest text-white placeholder:text-[#52525b] focus:outline-none focus:border-white uppercase"
                  />
                  <button
                    id="join-code-submit-btn"
                    onClick={() => handleJoinRoom()}
                    disabled={isConnecting || !joinInput.trim()}
                    className="px-4 py-2 bg-white hover:bg-neutral-200 disabled:opacity-40 text-black font-semibold rounded-lg text-xs flex items-center gap-1.5 transition-all shadow-sm active:scale-95 cursor-pointer"
                  >
                    {isConnecting ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <ArrowRight className="w-3.5 h-3.5" />
                    )}
                    <span>{isConnecting ? 'Connecting...' : 'Connect'}</span>
                  </button>
                </div>
                <p className="text-[11px] text-[#71717a]">
                  Generate this code on the other device in the "My Code" tab.
                </p>
              </div>
            </div>
          )}

          {/* TAB 3: CAMERA SCANNER */}
          {activeTab === 'scan' && (
            <div className="space-y-3">
              <div className="relative aspect-square max-h-[260px] w-full mx-auto rounded-xl overflow-hidden bg-black border border-[#27272a] flex items-center justify-center">
                {cameraError ? (
                  <div className="p-4 text-center space-y-2 text-red-400 text-xs">
                    <AlertCircle className="w-6 h-6 mx-auto opacity-80" />
                    <p>{cameraError}</p>
                    <button
                      onClick={startCamera}
                      className="px-3 py-1.5 rounded-lg bg-[#18181b] text-white text-xs font-medium hover:bg-[#27272a] border border-[#27272a] cursor-pointer"
                    >
                      Try Again
                    </button>
                  </div>
                ) : (
                  <>
                    <video ref={videoRef} className="w-full h-full object-cover" />
                    <canvas ref={scanCanvasRef} className="hidden" />
                    {/* Minimalist target frame */}
                    <div className="absolute inset-8 border border-white/40 rounded-xl pointer-events-none">
                      <div className="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-white" />
                      <div className="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-white" />
                      <div className="absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 border-white" />
                      <div className="absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 border-white" />
                    </div>
                  </>
                )}
              </div>
              <p className="text-center text-xs text-[#71717a]">
                Point camera at partner's QR code
              </p>
            </div>
          )}

          {/* TAB 4: LOCAL NETWORK (LAN) */}
          {activeTab === 'lan' && (
            <div className="space-y-3">
              <div className="p-3.5 bg-[#121215] rounded-xl border border-[#222226] flex items-center justify-between">
                <div className="space-y-0.5">
                  <div className="text-xs font-semibold text-white">Local Network Visibility</div>
                  <div className="text-[11px] text-[#71717a]">
                    {isLanVisible ? 'Your device is visible on the LAN' : 'Your device is hidden on the LAN'}
                  </div>
                </div>
                <button
                  id="lan-visibility-toggle-btn"
                  onClick={handleToggleLanVisibility}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                    isLanVisible
                      ? 'bg-emerald-950 text-emerald-400 border border-emerald-800/60'
                      : 'bg-[#1c1c22] text-[#a1a1aa] hover:text-white border border-[#2c2c36]'
                  }`}
                >
                  {isLanVisible ? 'Visible' : 'Hidden'}
                </button>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-[#71717a] px-1">
                  <span>Nearby Devices ({lanPeers.length})</span>
                  <button
                    onClick={handleToggleLanScan}
                    className="text-white hover:text-neutral-300 font-medium flex items-center gap-1 text-[11px] cursor-pointer"
                  >
                    <RefreshCw className={`w-3 h-3 ${isLanScanning ? 'animate-spin' : ''}`} />
                    <span>{isLanScanning ? 'Scanning...' : 'Scan'}</span>
                  </button>
                </div>

                {lanPeers.length === 0 ? (
                  <div className="p-5 text-center bg-[#121215] rounded-xl border border-[#222226] text-xs text-[#71717a]">
                    No devices found on local network. Ensure visibility is enabled on both devices.
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {lanPeers.map((peer) => (
                      <div
                        key={peer.deviceId}
                        className="p-3 bg-[#121215] rounded-xl border border-[#222226] flex items-center justify-between hover:border-[#33333b] transition-colors"
                      >
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-full bg-[#1c1c22] border border-[#2e2e38] flex items-center justify-center font-bold text-white text-xs">
                            {peer.displayName.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <div className="text-xs font-medium text-white">{peer.displayName}</div>
                            <div className="text-[10px] text-[#71717a] font-mono">{peer.deviceId.slice(0, 16)}...</div>
                          </div>
                        </div>

                        <button
                          onClick={() => handleConnectLanPeer(peer)}
                          disabled={lanConnectingPeerId === peer.deviceId}
                          className="px-3 py-1.5 bg-white hover:bg-neutral-200 disabled:opacity-50 text-black rounded-lg text-xs font-semibold transition-colors cursor-pointer"
                        >
                          {lanConnectingPeerId === peer.deviceId ? 'Connecting...' : 'Connect'}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Incoming LAN Invite Alert */}
              {incomingInvite && (
                <div className="p-3.5 bg-[#141418] border border-emerald-500/30 rounded-xl space-y-2.5 animate-in zoom-in-95">
                  <div className="flex items-center gap-2 text-emerald-400 text-xs font-medium">
                    <Radio className="w-3.5 h-3.5 animate-pulse" />
                    <span>Incoming LAN Pairing Request</span>
                  </div>
                  <p className="text-xs text-[#e4e4e7]">
                    Device <strong className="text-white">{incomingInvite.fromDisplayName}</strong> wants to pair.
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleAcceptIncomingInvite(incomingInvite)}
                      className="flex-1 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold transition-colors cursor-pointer"
                    >
                      Accept
                    </button>
                    <button
                      onClick={() => setIncomingInvite(null)}
                      className="px-3 py-1.5 bg-[#1f1f26] hover:bg-[#282832] text-[#a1a1aa] hover:text-white rounded-lg text-xs transition-colors cursor-pointer"
                    >
                      Decline
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
