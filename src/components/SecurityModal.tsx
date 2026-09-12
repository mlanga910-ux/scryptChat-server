import React, { useState } from 'react';
import { ContactRecord, IdentityRecord } from '../types/index';
import { db } from '../db/index';
import {
  ShieldCheck,
  X,
  Copy,
  Check,
  KeyRound,
  Hash,
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
  const [activeTab, setActiveTab] = useState<'safety_number' | 'identity_key'>('safety_number');

  if (!isOpen) return null;

  const handleToggleVerify = async () => {
    if (!activeContact) return;
    const newStatus = activeContact.verificationStatus === 'VERIFIED' ? 'TOFU' : 'VERIFIED';
    await db.contacts.update(activeContact.deviceId, { verificationStatus: newStatus });
    activeContact.verificationStatus = newStatus;
    onContactUpdated();
  };

  const copyIdentityKey = () => {
    if (!identity) return;
    navigator.clipboard.writeText(identity.publicKeyRaw);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  };

  return (
    <div
      id="security-modal-backdrop"
      className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 select-none font-sans text-xs animate-in fade-in duration-150"
    >
      <div className="w-full max-w-md h-[480px] max-h-[90vh] bg-zinc-950 border border-zinc-800 rounded-2xl shadow-xl flex flex-col overflow-hidden">
        {/* Modal Header */}
        <div className="px-5 py-4 border-b border-zinc-800 bg-zinc-950/50 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center text-white">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white tracking-tight">
                Security
              </h3>
              <p className="text-[11px] text-zinc-500">
                End-to-end encryption key verification
              </p>
            </div>
          </div>
          <button
            id="close-security-modal-btn"
            onClick={onClose}
            className="p-1.5 text-zinc-500 hover:text-white hover:bg-zinc-900 rounded-lg transition-colors"
            aria-label="Close security"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="grid grid-cols-2 border-b border-zinc-800 bg-zinc-950/50 p-1.5 gap-1.5 text-center shrink-0">
          <button
            id="tab-safety-number"
            onClick={() => setActiveTab('safety_number')}
            className={`py-1.5 rounded-lg text-xs font-medium transition-all ${
              activeTab === 'safety_number'
                ? 'bg-zinc-900 text-white border border-zinc-800 font-semibold shadow-sm'
                : 'text-zinc-500 hover:text-white'
            }`}
            aria-label="Safety number"
          >
            Safety Number
          </button>
          <button
            id="tab-identity-key"
            onClick={() => setActiveTab('identity_key')}
            className={`py-1.5 rounded-lg text-xs font-medium transition-all ${
              activeTab === 'identity_key'
                ? 'bg-zinc-900 text-white border border-zinc-800 font-semibold shadow-sm'
                : 'text-zinc-500 hover:text-white'
            }`}
            aria-label="Identity key"
          >
            Identity Key
          </button>
        </div>

        {/* Modal Body with Fixed Height & Scroll */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* TAB 1: SAFETY NUMBER VERIFICATION */}
          {activeTab === 'safety_number' && (
            <div className="space-y-3">
              {activeContact ? (
                <>
                  <div className="p-4 bg-zinc-950/50 border border-zinc-800 rounded-xl text-center space-y-2">
                    <span className="text-[11px] text-zinc-500 block">
                      Safety number with <strong className="text-white">{activeContact.alias}</strong>
                    </span>
                    <div className="text-2xl font-bold tracking-widest text-emerald-400 my-2 font-mono">
                      {activeContact.safetyNumber}
                    </div>
                    <p className="text-zinc-500 text-[11px] max-w-sm mx-auto leading-relaxed">
                      Compare this number in person or over another secure channel to verify that your connection is direct and untampered.
                    </p>
                  </div>

                  <div className="flex items-center justify-between p-3.5 bg-zinc-950/50 border border-zinc-800 rounded-xl">
                    <div>
                      <div className="font-medium text-white text-xs">
                        Status:{' '}
                        <span
                          className={
                            activeContact.verificationStatus === 'VERIFIED'
                              ? 'text-emerald-400 font-semibold'
                              : 'text-zinc-400'
                          }
                        >
                          {activeContact.verificationStatus === 'VERIFIED' ? 'Verified' : 'Unverified'}
                        </span>
                      </div>
                      <div className="text-[11px] text-zinc-500 mt-0.5">
                        {activeContact.verificationStatus === 'VERIFIED'
                          ? 'Identity confirmed with peer.'
                          : 'Not yet manually confirmed.'}
                      </div>
                    </div>

                    <button
                      id="toggle-verify-status-btn"
                      onClick={handleToggleVerify}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                        activeContact.verificationStatus === 'VERIFIED'
                          ? 'bg-zinc-900 text-zinc-400 hover:text-white border border-zinc-800'
                          : 'bg-emerald-400 text-zinc-950 hover:bg-emerald-300 font-semibold'
                      }`}
                      aria-label={
                        activeContact.verificationStatus === 'VERIFIED'
                          ? 'Unmark as verified'
                          : 'Mark as verified'
                      }
                    >
                      {activeContact.verificationStatus === 'VERIFIED'
                        ? 'Unmark'
                        : 'Mark as Verified'}
                    </button>
                  </div>
                </>
              ) : (
                <div className="p-8 text-center text-zinc-500">
                  <p>No active contact selected. Open a chat with a contact to verify safety numbers.</p>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: IDENTITY KEY */}
          {activeTab === 'identity_key' && (
            <div className="space-y-3">
              <div className="p-3.5 bg-zinc-950/50 border border-zinc-800 rounded-xl space-y-2">
                <span className="text-[11px] font-medium text-zinc-500 block">
                  Your Device ID
                </span>
                <p className="font-mono text-xs text-white break-all select-text">
                  {identity?.deviceId}
                </p>
              </div>

              <div className="p-3.5 bg-zinc-950/50 border border-zinc-800 rounded-xl space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-medium text-zinc-500">
                    Public Identity Key
                  </span>
                  <button
                    onClick={copyIdentityKey}
                    className="flex items-center gap-1 text-[11px] text-blue-400 hover:text-blue-300 font-medium"
                    aria-label="Copy identity key"
                  >
                    {copiedKey ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedKey ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
                <div className="p-2.5 bg-zinc-950 border border-zinc-800 rounded-lg font-mono text-[11px] text-zinc-500 break-all max-h-24 overflow-y-auto select-text">
                  {identity?.publicKeyRaw}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};