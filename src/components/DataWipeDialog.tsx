import React, { useState } from 'react';
import { clearAllLocalData } from '../db/index';
import { AlertTriangle, Trash2, X } from 'lucide-react';

interface DataWipeDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onWipeCompleted: () => void;
}

export const DataWipeDialog: React.FC<DataWipeDialogProps> = ({
  isOpen,
  onClose,
  onWipeCompleted,
}) => {
  const [isWiping, setIsWiping] = useState(false);

  if (!isOpen) return null;

  const handleConfirmWipe = async () => {
    try {
      setIsWiping(true);
      await clearAllLocalData();
      onWipeCompleted();
    } catch (err) {
      console.error('Wipe error:', err);
      setIsWiping(false);
    }
  };

  return (
    <div
      id="wipe-modal-backdrop"
      className="fixed inset-0 z-50 bg-[#0a0a0b]/92 backdrop-blur-sm flex items-center justify-center p-4 select-none font-sans animate-in fade-in duration-150"
    >
      <div className="w-full max-w-md bg-[#0c0c0e]/90 border border-[#27272a]/60 rounded-2xl shadow-xl flex flex-col overflow-hidden backdrop-blur-xl">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-[#27272a]/60 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 text-rose-400">
            <AlertTriangle className="w-4 h-4" />
            <span className="font-semibold text-white tracking-tight text-sm">
              Clear All Data
            </span>
          </div>
          <button
            id="close-wipe-modal-btn"
            onClick={onClose}
            className="p-1.5 text-[#71717a] hover:text-white hover:bg-[#27272a]/60 rounded-lg transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-3 text-[#a1a1aa]">
          <p className="leading-relaxed">
            This action will permanently delete all stored local data in your browser:
          </p>
          <ul className="list-disc pl-5 space-y-1 text-white text-xs">
            <li>IndexedDB messages transcript history</li>
            <li>Stored and cached file blobs</li>
            <li>Paired contacts &amp; verified Safety Numbers</li>
            <li>Long-term ECDSA Identity Keypair</li>
            <li>Active RAM session keys &amp; WebRTC channels</li>
          </ul>
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-[#27272a]/60 bg-[#0a0a0b]/80 flex items-center justify-end gap-2 shrink-0">
          <button
            id="cancel-wipe-btn"
            onClick={onClose}
            disabled={isWiping}
            className="px-3.5 py-1.5 bg-[#27272a]/60 hover:bg-[#3f3f46] text-[#a1a1aa] hover:text-white rounded-xl text-xs font-medium transition-colors disabled:opacity-40"
            aria-label="Cancel"
          >
            Cancel
          </button>
          <button
            id="confirm-wipe-btn"
            onClick={handleConfirmWipe}
            disabled={isWiping}
            className="px-3.5 py-1.5 bg-rose-600 hover:bg-rose-500 text-white font-medium rounded-xl flex items-center gap-1.5 transition-colors disabled:opacity-40 text-xs shadow-sm"
            aria-label="Clear everything"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>{isWiping ? 'Clearing...' : 'Clear Everything'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
