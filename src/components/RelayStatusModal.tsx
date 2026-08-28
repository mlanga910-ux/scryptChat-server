import React, { useState, useEffect } from 'react';
import { PeerManager } from '../webrtc/peerManager';
import { RelayServerStats, RelayStatus } from '../types/index';
import {
  Server,
  CheckCircle,
  XCircle,
  RefreshCw,
  X,
  Shield,
} from 'lucide-react';

interface RelayStatusModalProps {
  isOpen: boolean;
  peerManager: PeerManager;
  relayStatus: RelayStatus;
  relayPingMs: number | null;
  relayStats: RelayServerStats | null;
  relayErrorReason?: string | null;
  onClose: () => void;
}

export const RelayStatusModal: React.FC<RelayStatusModalProps> = ({
  isOpen,
  peerManager,
  relayStatus,
  relayPingMs,
  relayStats,
  relayErrorReason,
  onClose,
}) => {
  const [customUrlInput, setCustomUrlInput] = useState('');
  const [isPinging, setIsPinging] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    pingMs?: number;
    error?: string;
  } | null>(null);

  useEffect(() => {
    if (isOpen) {
      setCustomUrlInput(peerManager.customRelayUrl || '');
      setTestResult(null);
    }
  }, [isOpen, peerManager.customRelayUrl]);

  if (!isOpen) return null;

  const currentEffectiveUrl =
    peerManager.getRelayBaseUrl() ||
    (typeof window !== 'undefined' ? window.location.origin : '');

  const handleTestAndSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setIsPinging(true);
    setTestResult(null);

    const targetUrl = customUrlInput.trim().replace(/\/+$/, '');
    peerManager.setRelayBaseUrl(targetUrl);

    try {
      const startTime = performance.now();
      const res = await peerManager.fetchRelay(
        '/api/signaling/status',
        {
          method: 'GET',
          headers: { Accept: 'application/json' },
        },
        5000
      );

      const elapsed = Math.round(performance.now() - startTime);
      if (res.ok) {
        setTestResult({
          success: true,
          pingMs: elapsed,
        });
        await peerManager.checkRelayHealth();
      } else {
        setTestResult({
          success: false,
          error: `HTTP ${res.status} ${res.statusText}`,
        });
        await peerManager.checkRelayHealth();
      }
    } catch (err: any) {
      const isTimeout = err.name === 'AbortError';
      setTestResult({
        success: false,
        error: isTimeout
          ? 'Timed out (5s) — Instance may be waking up or restarting'
          : err.message || 'Network unreachable',
      });
      await peerManager.checkRelayHealth();
    } finally {
      setIsPinging(false);
    }
  };

  const handleSelectRender = () => {
    const renderUrl = 'https://scryptchat.onrender.com';
    setCustomUrlInput(renderUrl);
    peerManager.setRelayBaseUrl(renderUrl);
    handleTestAndSave();
  };

  const handleResetDefault = () => {
    peerManager.setRelayBaseUrl('');
    setCustomUrlInput('');
    setTestResult(null);
    peerManager.checkRelayHealth();
  };

  const formatUptime = (seconds?: number) => {
    if (!seconds && seconds !== 0) return '—';
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div
        id="relay-status-modal"
        className="w-full max-w-lg bg-[#0c0c0e] border border-[#27272a] rounded-xl shadow-2xl overflow-hidden text-[#e4e4e7] flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#27272a] bg-[#121215]">
          <div className="flex items-center gap-2.5">
            <Server className="w-4 h-4 text-emerald-400" />
            <h3 className="font-semibold text-sm tracking-wide text-white">
              Signaling & Relay Server
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-[#a1a1aa] hover:text-white hover:bg-[#27272a] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 text-xs">
          {/* Current Status Banner */}
          <div className="p-3.5 rounded-lg bg-[#18181b] border border-[#27272a] flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div
                className={`w-3 h-3 rounded-full ${
                  relayStatus === 'ONLINE'
                    ? 'bg-emerald-400 ring-4 ring-emerald-500/20'
                    : relayStatus === 'RESTARTING' || relayStatus === 'CONNECTING'
                    ? 'bg-amber-400 ring-4 ring-amber-500/20 animate-pulse'
                    : 'bg-red-400 ring-4 ring-red-500/20'
                }`}
              />
              <div>
                <div className="font-semibold text-white text-sm">
                  {relayStatus === 'ONLINE'
                    ? 'Signaling Server Online'
                    : relayStatus === 'RESTARTING'
                    ? 'Signaling Server Restarting / Waking Up'
                    : relayStatus === 'CONNECTING'
                    ? 'Connecting to Signaling Server...'
                    : 'Signaling Server Offline'}
                </div>
                <div className="text-[#71717a] font-mono text-[11px] truncate max-w-[280px]">
                  {currentEffectiveUrl}
                </div>
                {relayErrorReason && relayStatus !== 'ONLINE' && (
                  <div className="text-[11px] text-amber-400/90 mt-0.5">
                    {relayErrorReason}
                  </div>
                )}
              </div>
            </div>

            <div className="text-right shrink-0">
              <div className="font-mono text-xs font-semibold text-emerald-400">
                {relayPingMs !== null ? `${relayPingMs} ms` : '—'}
              </div>
              <div className="text-[10px] text-[#71717a]">Round-trip Ping</div>
            </div>
          </div>

          {/* Server Metrics */}
          {relayStats && relayStatus === 'ONLINE' && (
            <div className="grid grid-cols-4 gap-2">
              <div className="p-2.5 rounded-lg bg-[#141417] border border-[#27272a]">
                <div className="text-[10px] text-[#71717a] uppercase tracking-wider font-semibold">
                  Active Rooms
                </div>
                <div className="text-sm font-bold font-mono text-white mt-1">
                  {relayStats.activeRooms ?? 0}
                </div>
              </div>
              <div className="p-2.5 rounded-lg bg-[#141417] border border-[#27272a]">
                <div className="text-[10px] text-[#71717a] uppercase tracking-wider font-semibold">
                  Confirmed
                </div>
                <div className="text-sm font-bold font-mono text-emerald-400 mt-1">
                  {relayStats.confirmedRooms ?? 0}
                </div>
              </div>
              <div className="p-2.5 rounded-lg bg-[#141417] border border-[#27272a]">
                <div className="text-[10px] text-[#71717a] uppercase tracking-wider font-semibold">
                  Devices
                </div>
                <div className="text-sm font-bold font-mono text-white mt-1">
                  {relayStats.activeOnlineDevices ?? 1}
                </div>
              </div>
              <div className="p-2.5 rounded-lg bg-[#141417] border border-[#27272a]">
                <div className="text-[10px] text-[#71717a] uppercase tracking-wider font-semibold">
                  Uptime
                </div>
                <div className="text-sm font-bold font-mono text-white mt-1">
                  {formatUptime(relayStats.uptimeSeconds)}
                </div>
              </div>
            </div>
          )}

          {/* Explanation */}
          <div className="p-3 rounded-lg bg-[#121215] border border-[#27272a]/60 space-y-1.5 leading-relaxed text-[#a1a1aa]">
            <div className="font-medium text-[#e4e4e7] flex items-center gap-1.5">
              <Shield className="w-3.5 h-3.5 text-emerald-400" />
              Role in WebRTC & Handshake Verification
            </div>
            <p>
              The signaling server acts as a temporary matchmaker for peers to exchange ICE candidates and SDP parameters, and confirms the mutual handshake. Once two devices pair and establish a direct connection, the signaling server is no longer used and all messages flow exclusively peer-to-peer (P2P).
            </p>
          </div>

          {/* Quick Target Selector */}
          <div className="space-y-1.5">
            <label className="block text-[11px] font-semibold text-[#a1a1aa] uppercase tracking-wider">
              Quick Presets
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={handleSelectRender}
                className={`p-2 rounded-lg border text-left transition-colors flex flex-col ${
                  currentEffectiveUrl.includes('onrender.com')
                    ? 'border-emerald-500/50 bg-emerald-950/20 text-white'
                    : 'border-[#27272a] bg-[#141417] text-[#a1a1aa] hover:text-white hover:border-[#3f3f46]'
                }`}
              >
                <span className="font-semibold text-xs text-white">Render Primary Relay</span>
                <span className="text-[10px] font-mono text-[#71717a] truncate">https://scryptchat.onrender.com</span>
              </button>

              <button
                type="button"
                onClick={handleResetDefault}
                className={`p-2 rounded-lg border text-left transition-colors flex flex-col ${
                  !peerManager.customRelayUrl
                    ? 'border-emerald-500/50 bg-emerald-950/20 text-white'
                    : 'border-[#27272a] bg-[#141417] text-[#a1a1aa] hover:text-white hover:border-[#3f3f46]'
                }`}
              >
                <span className="font-semibold text-xs text-white">Current Origin</span>
                <span className="text-[10px] font-mono text-[#71717a] truncate">
                  {typeof window !== 'undefined' ? window.location.origin : '/api/signaling'}
                </span>
              </button>
            </div>
          </div>

          {/* Custom Server Configuration Form */}
          <form onSubmit={handleTestAndSave} className="space-y-2.5">
            <div>
              <label className="block text-[11px] font-semibold text-[#a1a1aa] uppercase tracking-wider mb-1">
                Custom Endpoint URL
              </label>
              <div className="flex gap-2">
                <input
                  type="url"
                  placeholder="https://scryptchat.onrender.com"
                  value={customUrlInput}
                  onChange={(e) => setCustomUrlInput(e.target.value)}
                  className="flex-1 px-3 py-2 bg-[#18181b] border border-[#27272a] rounded-lg text-xs font-mono text-white focus:outline-none focus:border-emerald-500 transition-colors"
                />
                <button
                  type="submit"
                  disabled={isPinging}
                  className="px-3.5 py-2 bg-white text-black font-semibold rounded-lg hover:bg-neutral-200 transition-colors disabled:opacity-50 flex items-center gap-1.5 text-xs shrink-0"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isPinging ? 'animate-spin' : ''}`} />
                  <span>Test & Save</span>
                </button>
              </div>
            </div>

            {/* Test result feedback */}
            {testResult && (
              <div
                className={`p-2.5 rounded-lg text-xs flex items-center gap-2 border ${
                  testResult.success
                    ? 'bg-emerald-950/30 border-emerald-800/50 text-emerald-300'
                    : 'bg-red-950/30 border-red-800/50 text-red-300'
                }`}
              >
                {testResult.success ? (
                  <>
                    <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>Connection successful ({testResult.pingMs} ms)</span>
                  </>
                ) : (
                  <>
                    <XCircle className="w-4 h-4 text-red-400 shrink-0" />
                    <span>Connection failed: {testResult.error}</span>
                  </>
                )}
              </div>
            )}
          </form>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-[#27272a] bg-[#121215] flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-[#27272a] hover:bg-[#3f3f46] text-white font-medium rounded-lg text-xs transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
