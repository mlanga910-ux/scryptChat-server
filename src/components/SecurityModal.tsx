import React, { useState } from 'react';
import { ContactRecord, IdentityRecord } from '../types/index';
import { db } from '../db/index';
import {
  ShieldCheck,
  X,
  Copy,
  Check,
  Lock,
} from 'lucide-react';

interface SecurityModalProps {
  isOpen: boolean;
  identity: IdentityRecord | null;
  activeContact: ContactRecord | null;
  onClose: () => void;
  onContactUpdated: () => void;
}

export const SecurityModal: React.FC<SecurityModalProps> = ({
  isOpen,
  identity,
  activeContact,
  onClose,
  onContactUpdated,
}) => {
  const [copiedKey, setCopiedKey] = useState(false);
  const [activeTab, setActiveTab] = useState<'safety_number' | 'identity_key' | 'architecture'>('safety_number');

  if (!isOpen) return null;

  const handleToggleVerify = async () => {
    if (!activeContact) return;
    const newStatus = activeContact.verificationStatus === 'VERIFIED' ? 'TOFU' : 'VERIFIED';
    await db.contacts.update(activeContact.deviceId, { verificationStatus: newStatus });
    activeContact.verificationStatus = newStatus;
    onContactUpdated();
  };

  return (
    <div
      id="security-modal-backdrop"
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 select-none font-sans text-xs"
    >
      <div className="w-full max-w-xl bg-[#18181b] border border-[#27272a] rounded-2xl shadow-xl flex flex-col max-h-[90vh] overflow-hidden">
        {/* Modal Header */}
        <div className="px-5 py-3.5 border-b border-[#27272a] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-[#09090b] border border-[#27272a] flex items-center justify-center text-white">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <span className="font-semibold text-white tracking-tight text-sm">
              Security &amp; Cryptography
            </span>
          </div>
          <button
            id="close-security-modal-btn"
            onClick={onClose}
            className="p-1.5 text-[#71717a] hover:text-white hover:bg-[#27272a] rounded-lg transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="grid grid-cols-3 border-b border-[#27272a] bg-[#09090b] p-1.5 gap-1.5 text-center">
          <button
            id="tab-safety-number"
            onClick={() => setActiveTab('safety_number')}
            className={`py-1.5 rounded-lg text-xs font-medium transition-colors ${
              activeTab === 'safety_number'
                ? 'bg-white text-black font-semibold'
                : 'text-[#71717a] hover:text-white'
            }`}
          >
            Safety Number
          </button>
          <button
            id="tab-identity-key"
            onClick={() => setActiveTab('identity_key')}
            className={`py-1.5 rounded-lg text-xs font-medium transition-colors ${
              activeTab === 'identity_key'
                ? 'bg-white text-black font-semibold'
                : 'text-[#71717a] hover:text-white'
            }`}
          >
            Identity Key
          </button>
          <button
            id="tab-crypto-architecture"
            onClick={() => setActiveTab('architecture')}
            className={`py-1.5 rounded-lg text-xs font-medium transition-colors ${
              activeTab === 'architecture'
                ? 'bg-white text-black font-semibold'
                : 'text-[#71717a] hover:text-white'
            }`}
          >
            Specs &amp; PFS
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 overflow-y-auto space-y-4">
          {/* TAB 1: SAFETY NUMBER VERIFICATION */}
          {activeTab === 'safety_number' && (
            <div className="space-y-3">
              {activeContact ? (
                <>
                  <div className="p-4 bg-[#09090b] border border-[#27272a] rounded-xl text-center space-y-2">
                    <span className="text-[11px] text-[#71717a] block">
                      Safety number with <strong className="text-white">{activeContact.alias}</strong>
                    </span>
                    <div className="text-2xl font-semibold tracking-widest text-white my-2 font-mono">
                      {activeContact.safetyNumber}
                    </div>
                    <p className="text-[#71717a] text-[11px] max-w-sm mx-auto leading-relaxed">
                      Compare this 6-digit number in person or over another channel to verify your connection.
                    </p>
                  </div>

                  <div className="flex items-center justify-between p-3.5 bg-[#09090b] border border-[#27272a] rounded-xl">
                    <div>
                      <div className="font-medium text-white text-xs">
                        Status: <span className={activeContact.verificationStatus === 'VERIFIED' ? 'text-emerald-400' : 'text-neutral-400'}>{activeContact.verificationStatus}</span>
                      </div>
                      <div className="text-[11px] text-[#71717a] mt-0.5">
                        {activeContact.verificationStatus === 'VERIFIED'
                          ? 'Identity cryptographically confirmed.'
                          : 'Trust On First Use (Unconfirmed).'}
                      </div>
                    </div>

                    <button
                      id="toggle-verify-status-btn"
                      onClick={handleToggleVerify}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                        activeContact.verificationStatus === 'VERIFIED'
                          ? 'bg-[#27272a] text-[#a1a1aa] hover:text-white hover:bg-[#3f3f46]'
                          : 'bg-white text-black hover:bg-neutral-200 font-semibold'
                      }`}
                    >
                      {activeContact.verificationStatus === 'VERIFIED'
                        ? 'Mark Unverified'
                        : 'Mark as Verified'}
                    </button>
                  </div>
                </>
              ) : (
                <div className="p-8 text-center text-[#71717a]">
                  Select a contact to view and verify safety numbers.
                </div>
              )}
            </div>
          )}

          {/* TAB 2: MY IDENTITY KEY */}
          {activeTab === 'identity_key' && identity && (
            <div className="space-y-3">
              <div className="p-3 bg-[#09090b] border border-[#27272a] rounded-xl space-y-1">
                <span className="text-[#71717a] text-[11px] block">Local Device Identifier</span>
                <span className="text-white font-mono text-xs block truncate">{identity.deviceId}</span>
              </div>

              <div className="p-3 bg-[#09090b] border border-[#27272a] rounded-xl space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[#71717a] text-[11px]">
                    ECDSA P-256 Public Key (65B Raw)
                  </span>
                  <button
                    id="copy-my-pubkey-btn"
                    onClick={() => {
                      navigator.clipboard.writeText(identity.publicKeyRaw);
                      setCopiedKey(true);
                      setTimeout(() => setCopiedKey(false), 2000);
                    }}
                    className="flex items-center gap-1 text-[#a1a1aa] hover:text-white text-[11px] bg-[#27272a] px-2 py-0.5 rounded"
                  >
                    {copiedKey ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    <span>{copiedKey ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
                <textarea
                  readOnly
                  rows={3}
                  value={identity.publicKeyRaw}
                  className="w-full bg-[#18181b] border border-[#27272a] rounded p-2 text-[10px] text-[#a1a1aa] font-mono focus:outline-none"
                />
              </div>

              <div className="p-3 bg-[#09090b] border border-[#27272a] text-[#71717a] text-xs space-y-1 rounded-xl">
                <div className="text-white font-medium flex items-center gap-1.5 text-xs">
                  <Lock className="w-3.5 h-3.5 text-white" />
                  <span>Non-Extractable Private Key Policy</span>
                </div>
                <p className="leading-relaxed text-[11px]">
                  ECDSA private key is generated with <code className="text-white font-mono">extractable: false</code> inside WebCrypto.
                </p>
              </div>
            </div>
          )}

          {/* TAB 3: ARCHITECTURE SPEC */}
          {activeTab === 'architecture' && (
            <div className="space-y-2 text-[#a1a1aa] text-xs leading-relaxed">
              <div className="p-3 bg-[#09090b] border border-[#27272a] rounded-xl space-y-1">
                <div className="text-white font-medium text-xs">1. Perfect Forward Secrecy (PFS)</div>
                <p className="text-[11px] text-[#71717a]">
                  Each session establishes an Ephemeral ECDH P-256 keypair.
                </p>
              </div>

              <div className="p-3 bg-[#09090b] border border-[#27272a] rounded-xl space-y-1">
                <div className="text-white font-medium text-xs">2. Directional AES-256-GCM + Nonce Prefix</div>
                <p className="text-[11px] text-[#71717a]">
                  Keys are split: <code className="text-white font-mono">Key_A2B</code> and <code className="text-white font-mono">Key_B2A</code>. 96-bit Nonces are generated as prefix + monotonic counter.
                </p>
              </div>

              <div className="p-3 bg-[#09090b] border border-[#27272a] rounded-xl space-y-1">
                <div className="text-white font-medium text-xs">3. 24-Byte AAD Wire Protocol</div>
                <p className="text-[11px] text-[#71717a]">
                  The unencrypted packet header is bound into AES-GCM Authenticated Additional Data (AAD).
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

