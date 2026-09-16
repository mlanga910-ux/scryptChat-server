import React, { useState, useEffect, useRef } from 'react';
import { PeerManager } from '../webrtc/peerManager';
import { db } from '../db/index';
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
  Share2,
  Link as LinkIcon,
  Infinity as InfinityIcon,
  Info,
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

  // Host code state
  const [roomCode, setRoomCode] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [isGeneratingRoom, setIsGeneratingRoom] = useState(false);
  const [isPermanentMode, setIsPermanentMode] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);

  // Join state
  const [joinInput, setJoinInput] = useState(initialCode || '');
  const [isConnecting, setIsConnecting] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [isSuccess, setIsSuccess] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [alreadyAddedNotice, setAlreadyAddedNotice] = useState('');
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

  const handleGenerateRoom = async () => {
    if (isGeneratingRoom) return;
    try {
      setIsGeneratingRoom(true);
      setErrorMsg('');
      setStatusMessage('Generating keys and pairing code...');

      const offer = await peerManager.createOffer();

      const res = await peerManager.fetchRelay('/api/signaling/room/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceId: offer.deviceId,
          offer,
          ttlSeconds: isPermanentMode ? 31536000 : 900,
          isPermanent: isPermanentMode,
        }),
      }, 8000);

      const data = await res.json();
      if (!data.success || !data.roomId) {
        throw new Error(data.error || 'Failed to create pairing session');
      }

      const newCode = data.roomId.toUpperCase();
      const newExpiry = data.expiresAt || (Date.now() + (isPermanentMode ? 31536000000 : 900000));

      setRoomCode(newCode);
      setExpiresAt(newExpiry);
      setRemainingSeconds(Math.max(0, Math.floor((newExpiry - Date.now()) / 1000)));

      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      const pairingUrl = `${origin}/?room=${newCode}`;
      const dataUrl = await generateQrDataUrl(pairingUrl);
      setQrDataUrl(dataUrl);

      setStatusMessage('Pairing code generated. Waiting for peer...');
      startCountdown(newExpiry);
      startHostPolling(newCode);
    } catch (err: any) {
      console.error('Failed to generate pairing code:', err);
      const message = String(err?.message || '');
      setErrorMsg(
        /fetch|network|load failed|abort/i.test(message) || !message
          ? 'Signaling server unreachable. Check the status chip in the header and tap it to retry.'
          : message
      );
      setStatusMessage('');
    } finally {
      setIsGeneratingRoom(false);
    }
  };

  const startHostPolling = (code: string) => {
    stopPolling();
    pollIntervalRef.current = setInterval(async () => {
      try {
        const res = await peerManager.fetchRelay(`/api/signaling/room/${code}/status`, {
          method: 'GET',
        }, 3000);
        const data = await res.json();
        if (data.hasAnswer && data.answer) {
          if (!isPermanentMode) {
            stopPolling();
            stopCountdown();
          }
          setStatusMessage('Peer connected. Verifying cryptographic signatures...');

          await peerManager.acceptAnswer(data.answer);
          await peerManager.confirmPairingOnRelay(code);

          setIsSuccess(true);
          setStatusMessage('Connected.');
          setTimeout(() => {
            onPairSuccess();
            onClose();
          }, 800);
        }
      } catch (err: any) {
        if (!isPermanentMode) {
          stopPolling();
        }
        setErrorMsg(err?.message || 'Cryptographic verification failed.');
        setStatusMessage('');
      }
    }, 1500);
  };

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
      setAlreadyAddedNotice('');
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

      const existingContact = await db.contacts.get(data.offer.deviceId);
      if (existingContact) {
        setAlreadyAddedNotice(`This contact (${existingContact.alias || existingContact.deviceId}) is already in your contacts list.`);
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
    const maxAttempts = 30;
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
    <div
      id="pairing-modal-backdrop"
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-150 font-sans select-none"
    >
      <div
        id="pairing-modal-container"
        className="w-full max-w-md h-[560px] max-h-[92vh] bg-zinc-950 border border-zinc-800 rounded-2xl shadow-xl flex flex-col overflow-hidden"
      >
        {/* Top Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800 bg-zinc-950/50 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center text-white">
              <Shield className="w-4 h-4 text-emerald-400" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white tracking-tight">
                Pair New Device
              </h3>
            </div>
          </div>
          <button
            id="close-pairing-modal-btn"
            onClick={onClose}
            className="p-1.5 text-zinc-500 hover:text-white hover:bg-zinc-900 rounded-lg transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Segmented Tabs */}
        <div className="p-2.5 border-b border-zinc-800 bg-zinc-950/50 shrink-0">
          <div className="flex p-1 bg-zinc-900 border border-zinc-800 rounded-xl gap-1">
            <button
              id="tab-my-code-btn"
              onClick={() => setActiveTab('my_code')}
              className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                activeTab === 'my_code'
                  ? 'bg-white text-zinc-950 font-semibold shadow-sm'
                  : 'text-zinc-500 hover:text-white'
              }`}
              aria-label="My Code"
            >
              <QrCode className="w-3.5 h-3.5" />
              <span>Code</span>
            </button>

            <button
              id="tab-enter-code-btn"
              onClick={() => setActiveTab('enter')}
              className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                activeTab === 'enter'
                  ? 'bg-white text-zinc-950 font-semibold shadow-sm'
                  : 'text-zinc-500 hover:text-white'
              }`}
              aria-label="Enter Code"
            >
              <Key className="w-3.5 h-3.5" />
              <span>Enter</span>
            </button>

            <button
              id="tab-scan-qr-btn"
              onClick={() => setActiveTab('scan')}
              className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                activeTab === 'scan'
                  ? 'bg-white text-zinc-950 font-semibold shadow-sm'
                  : 'text-zinc-500 hover:text-white'
              }`}
              aria-label="Scan QR"
            >
              <Camera className="w-3.5 h-3.5" />
              <span>Scan</span>
            </button>

            <button
              id="tab-lan-btn"
              onClick={() => setActiveTab('lan')}
              className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                activeTab === 'lan'
                  ? 'bg-white text-zinc-950 font-semibold shadow-sm'
                  : 'text-zinc-500 hover:text-white'
              }`}
              aria-label="LAN"
            >
              <Wifi className="w-3.5 h-3.5" />
              <span>LAN</span>
            </button>
          </div>
        </div>

        {/* Status / Alert Banners */}
        {alreadyAddedNotice && (
          <div className="mx-4 mt-3 p-2.5 rounded-xl bg-blue-950/40 border border-blue-800/60 flex items-center gap-2 text-blue-300 text-xs animate-in fade-in">
            <Info className="w-4 h-4 flex-shrink-0 text-blue-400" />
            <div className="flex-1 font-medium">{alreadyAddedNotice}</div>
          </div>
        )}

        {errorMsg && (
          <div className="mx-4 mt-3 p-2.5 rounded-xl bg-rose-950/40 border border-rose-800/60 flex items-center gap-2 text-rose-300 text-xs animate-in fade-in">
            <AlertCircle className="w-4 h-4 flex-shrink-0 text-rose-400" />
            <div className="flex-1 font-medium">{errorMsg}</div>
          </div>
        )}

        {statusMessage && !errorMsg && (
          <div className="mx-4 mt-3 p-2.5 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center gap-2 text-zinc-200 text-xs">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>{statusMessage}</span>
          </div>
        )}

        {/* Modal Body */}
        <div className="p-4 overflow-y-auto flex-1 space-y-4">
          {/* TAB 1: MANUAL CODE GENERATION */}
          {activeTab === 'my_code' && (
            <div className="space-y-4">
              {/* Link Expiry Type Selector */}
              <div className="p-3 bg-zinc-900/50 rounded-xl border border-zinc-800 space-y-2">
                <div className="text-[11px] font-medium text-zinc-500 uppercase tracking-wider">
                  Pairing Link Type
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setIsPermanentMode(false);
                      setRoomCode('');
                    }}
                    className={`p-2 rounded-lg text-xs font-medium border text-left transition-all cursor-pointer ${
                      !isPermanentMode
                        ? 'bg-zinc-950 border-emerald-400/40 text-white'
                        : 'bg-zinc-900 border-transparent text-zinc-500'
                    }`}
                    aria-label="One-time link"
                  >
                    <div className="flex items-center gap-1.5 font-semibold text-emerald-400 mb-0.5">
                      <Clock className="w-3.5 h-3.5" />
                      <span>One-Time</span>
                    </div>
                    <p className="text-[10px] text-zinc-500 leading-tight">15 min / 1 pairing</p>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setIsPermanentMode(true);
                      setRoomCode('');
                    }}
                    className={`p-2 rounded-lg text-xs font-medium border text-left transition-all cursor-pointer ${
                      isPermanentMode
                        ? 'bg-zinc-950 border-purple-500/40 text-white'
                        : 'bg-zinc-900 border-transparent text-zinc-500'
                    }`}
                    aria-label="Permanent link"
                  >
                    <div className="flex items-center gap-1.5 font-semibold text-purple-400 mb-0.5">
                      <InfinityIcon className="w-3.5 h-3.5" />
                      <span>Permanent</span>
                    </div>
                    <p className="text-[10px] text-zinc-500 leading-tight">Reusable</p>
                  </button>
                </div>
              </div>

              {!roomCode ? (
                <div className="text-center py-6 px-4 bg-zinc-900/50 rounded-xl border border-zinc-800 space-y-3">
                  <div className="w-10 h-10 rounded-xl bg-zinc-900 border border-zinc-800 text-white flex items-center justify-center mx-auto shadow-inner">
                    <Key className="w-5 h-5 text-zinc-500" />
                  </div>
                  <div className="space-y-1">
                    <h4 className="text-sm font-semibold text-white">
                      {isPermanentMode ? 'Create Permanent Link' : 'Generate 15-Minute Code'}
                    </h4>
                    <p className="text-xs text-zinc-500 max-w-xs mx-auto">
                      {isPermanentMode
                        ? 'Reusable shareable link for multiple contacts.'
                        : 'Single-use code and link that expires in 15 minutes.'}
                    </p>
                  </div>
                  <button
                    id="generate-code-submit-btn"
                    onClick={handleGenerateRoom}
                    disabled={isGeneratingRoom}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white hover:bg-neutral-200 text-zinc-950 font-semibold text-xs shadow-md transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
                    aria-label="Create code and link"
                  >
                    {isGeneratingRoom ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <QrCode className="w-3.5 h-3.5" />
                    )}
                    <span>{isGeneratingRoom ? 'Generating...' : 'Create Code & Link'}</span>
                  </button>
                </div>
              ) : (
                <div className="space-y-3 animate-in fade-in">
                  {/* Code Card */}
                  <div className="p-4 bg-zinc-900/50 rounded-xl border border-zinc-800 flex flex-col items-center text-center space-y-3">
                    <div className="flex items-center justify-between w-full text-xs text-zinc-500">
                      <span>{isPermanentMode ? 'Permanent Pairing Code' : 'One-Time Pairing Code'}</span>
                      {isPermanentMode ? (
                        <div className="flex items-center gap-1 font-mono text-purple-400 text-[11px]">
                          <InfinityIcon className="w-3.5 h-3.5" />
                          <span>Permanent</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 font-mono text-emerald-400 text-[11px]">
                          <Clock className="w-3.5 h-3.5" />
                          <span>
                            {Math.floor(remainingSeconds / 60)}:{(remainingSeconds % 60).toString().padStart(2, '0')}
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="text-3xl font-black font-mono tracking-widest text-white bg-zinc-950 px-6 py-2.5 rounded-xl border border-zinc-800 shadow-inner select-all">
                      {roomCode}
                    </div>

                    {/* Shareable URL Section */}
                    <div className="w-full bg-zinc-950 p-2.5 rounded-xl border border-zinc-800 flex flex-col gap-2">
                      <div className="flex items-center gap-1.5 text-[11px] text-zinc-500">
                        <LinkIcon className="w-3 h-3 text-emerald-400" />
                        <span className="truncate">
                          {typeof window !== 'undefined'
                            ? `${window.location.origin}/?room=${roomCode}`
                            : `/?room=${roomCode}`}
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => {
                            const url = `${window.location.origin}/?room=${roomCode}`;
                            navigator.clipboard.writeText(url);
                            setCopiedUrl(true);
                            setTimeout(() => setCopiedUrl(false), 2000);
                          }}
                          className="flex-1 py-1.5 px-2.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-white text-xs font-medium flex items-center justify-center gap-1.5 transition-colors border border-zinc-800 cursor-pointer"
                          aria-label="Copy link"
                        >
                          {copiedUrl ? (
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                          ) : (
                            <Copy className="w-3.5 h-3.5 text-zinc-500" />
                          )}
                          <span>{copiedUrl ? 'Link Copied' : 'Copy Link'}</span>
                        </button>

                        {typeof navigator !== 'undefined' && typeof navigator.share === 'function' && (
                          <button
                            onClick={async () => {
                              try {
                                const url = `${window.location.origin}/?room=${roomCode}`;
                                await navigator.share({
                                  title: 'Add me on scryptChat',
                                  text: 'Pair with me on scryptChat:',
                                  url,
                                });
                              } catch {}
                            }}
                            className="py-1.5 px-3 rounded-lg bg-emerald-400 hover:bg-emerald-300 text-zinc-950 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer shadow-sm"
                            aria-label="Share link"
                          >
                            <Share2 className="w-3.5 h-3.5" />
                            <span>Share</span>
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 w-full pt-1">
                      <button
                        id="copy-room-code-btn"
                        onClick={() => handleCopy(roomCode)}
                        className="flex-1 py-2 px-3 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-white text-xs font-medium flex items-center justify-center gap-1.5 transition-colors border border-zinc-800 cursor-pointer"
                        aria-label="Copy code only"
                      >
                        {copied ? (
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                        ) : (
                          <Copy className="w-3.5 h-3.5 text-zinc-500" />
                        )}
                        <span>{copied ? 'Code Copied' : 'Copy Code Only'}</span>
                      </button>

                      <button
                        onClick={handleGenerateRoom}
                        disabled={isGeneratingRoom}
                        title="Generate new code"
                        className="p-2 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-500 hover:text-white transition-colors border border-zinc-800 cursor-pointer"
                        aria-label="Regenerate code"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${isGeneratingRoom ? 'animate-spin' : ''}`} />
                      </button>
                    </div>
                  </div>

                  {/* QR Code */}
                  {qrDataUrl && (
                    <div className="p-4 bg-zinc-900/50 rounded-xl border border-zinc-800 flex flex-col items-center text-center space-y-2">
                      <div className="p-3 bg-white rounded-xl shadow-md">
                        <img src={qrDataUrl} alt="Pairing QR Code" className="w-40 h-40 object-contain" />
                      </div>
                      <p className="text-[11px] text-zinc-500">
                        Scan this QR code on the other device
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
              <div className="p-4 bg-zinc-900/50 rounded-xl border border-zinc-800 space-y-3">
                <label className="block text-xs font-medium text-zinc-300">
                  Enter 6-character Code
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
                    className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg px-3.5 py-2 text-sm font-mono tracking-widest text-white placeholder-zinc-600 input-base focus:ring-1 focus:ring-emerald-400/20"
                    aria-label="Enter pairing code"
                  />
                  <button
                    id="join-code-submit-btn"
                    onClick={() => handleJoinRoom()}
                    disabled={isConnecting || !joinInput.trim()}
                    className="px-4 py-2 bg-white hover:bg-neutral-200 disabled:opacity-40 text-zinc-950 font-semibold rounded-lg text-xs flex items-center gap-1.5 transition-all shadow-sm active:scale-95 cursor-pointer"
                    aria-label="Connect"
                  >
                    {isConnecting ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <ArrowRight className="w-3.5 h-3.5" />
                    )}
                    <span>{isConnecting ? 'Connecting...' : 'Connect'}</span>
                  </button>
                </div>
                <p className="text-[11px] text-zinc-500">
                  Generate this code in the "Code" tab on the other device.
                </p>
              </div>
            </div>
          )}

          {/* TAB 3: CAMERA SCANNER */}
          {activeTab === 'scan' && (
            <div className="space-y-3">
              <div className="relative aspect-square max-h-[260px] w-full mx-auto rounded-xl overflow-hidden bg-black border border-zinc-800 flex items-center justify-center">
                {cameraError ? (
                  <div className="p-4 text-center space-y-2 text-rose-400 text-xs">
                    <AlertCircle className="w-6 h-6 mx-auto opacity-80" />
                    <p>{cameraError}</p>
                    <button
                      onClick={startCamera}
                      className="px-3 py-1.5 rounded-lg bg-zinc-900 text-white text-xs font-medium hover:bg-zinc-800 border border-zinc-800 cursor-pointer"
                      aria-label="Try again"
                    >
                      Try Again
                    </button>
                  </div>
                ) : (
                  <>
                    <video ref={videoRef} className="w-full h-full object-cover" playsInline />
                    <canvas ref={scanCanvasRef} className="hidden" />
                    {/* Minimalist target frame */}
                    <div className="absolute inset-8 border border-white/30 rounded-xl pointer-events-none">
                      <div className="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-white" />
                      <div className="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-white" />
                      <div className="absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 border-white" />
                      <div className="absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 border-white" />
                    </div>
                  </>
                )}
              </div>
              <p className="text-center text-xs text-zinc-500">
                Point camera at partner's QR code
              </p>
            </div>
          )}

          {/* TAB 4: LOCAL NETWORK (LAN) */}
          {activeTab === 'lan' && (
            <div className="space-y-3">
              <div className="p-3.5 bg-zinc-900/50 rounded-xl border border-zinc-800 flex items-center justify-between">
                <div className="space-y-0.5">
                  <div className="text-xs font-semibold text-white">Local Network Visibility</div>
                  <div className="text-[11px] text-zinc-500">
                    {isLanVisible ? 'Your device is visible on the LAN' : 'Your device is hidden on the LAN'}
                  </div>
                </div>
                <button
                  id="lan-visibility-toggle-btn"
                  onClick={handleToggleLanVisibility}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                    isLanVisible
                      ? 'bg-emerald-950 text-emerald-400 border border-emerald-800/60'
                      : 'bg-zinc-900 text-zinc-500 border border-zinc-800 hover:text-white'
                  }`}
                  aria-label={isLanVisible ? 'Hide device' : 'Show device'}
                >
                  {isLanVisible ? 'Visible' : 'Hidden'}
                </button>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-zinc-500 px-1">
                  <span>Nearby Devices ({lanPeers.length})</span>
                  <button
                    onClick={handleToggleLanScan}
                    className="text-white hover:text-zinc-300 font-medium flex items-center gap-1 text-[11px] cursor-pointer"
                    aria-label={isLanScanning ? 'Stop scanning' : 'Scan'}
                  >
                    <RefreshCw className={`w-3 h-3 ${isLanScanning ? 'animate-spin' : ''}`} />
                    <span>{isLanScanning ? 'Scanning...' : 'Scan'}</span>
                  </button>
                </div>

                {lanPeers.length === 0 ? (
                  <div className="p-5 text-center bg-zinc-900/50 rounded-xl border border-zinc-800 text-xs text-zinc-500">
                    No devices found on local network.
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {lanPeers.map((peer) => (
                      <div
                        key={peer.deviceId}
                        className="p-3 bg-zinc-900/50 rounded-xl border border-zinc-800 flex items-center justify-between hover:border-zinc-700 transition-colors"
                      >
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center font-bold text-white text-xs">
                            {peer.displayName.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <div className="text-xs font-medium text-white">{peer.displayName}</div>
                            <div className="text-[10px] text-zinc-500 font-mono">{peer.deviceId.slice(0, 16)}...</div>
                          </div>
                        </div>

                        <button
                          onClick={() => handleConnectLanPeer(peer)}
                          disabled={lanConnectingPeerId === peer.deviceId}
                          className="px-3 py-1.5 bg-white hover:bg-neutral-200 disabled:opacity-50 text-zinc-950 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
                          aria-label={`Connect to ${peer.displayName}`}
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
                <div className="p-3.5 bg-zinc-900/50 border border-emerald-400/30 rounded-xl space-y-2.5 animate-in zoom-in-95">
                  <div className="flex items-center gap-2 text-emerald-400 text-xs font-medium">
                    <Radio className="w-3.5 h-3.5 animate-pulse" />
                    <span>Incoming LAN Pairing Request</span>
                  </div>
                  <p className="text-xs text-zinc-200">
                    Device <strong className="text-white">{incomingInvite.fromDisplayName}</strong> wants to pair.
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleAcceptIncomingInvite(incomingInvite)}
                      className="flex-1 py-1.5 bg-emerald-400 hover:bg-emerald-300 text-zinc-950 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
                      aria-label="Accept invite"
                    >
                      Accept
                    </button>
                    <button
                      onClick={() => setIncomingInvite(null)}
                      className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-xs transition-colors cursor-pointer"
                      aria-label="Decline invite"
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