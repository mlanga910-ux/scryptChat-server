import React, { useState } from 'react';
import { ContactRecord, MessageRecord } from '../types/index';
import {
  Plus,
  Search,
  Image as ImageIcon,
  Mic,
  FileText,
  Trash2,
  MessageSquare,
} from 'lucide-react';

interface PeerListProps {
  contacts: ContactRecord[];
  activeContactId: string | null;
  connectedPeerId: string | null;
  lastMessages?: Map<string, MessageRecord>;
  onSelectPeer: (peer: ContactRecord) => void;
  onOpenPairing: () => void;
  onDeleteContact: (deviceId: string) => void;
}

export const PeerList: React.FC<PeerListProps> = ({
  contacts,
  activeContactId,
  connectedPeerId,
  lastMessages,
  onSelectPeer,
  onOpenPairing,
  onDeleteContact,
}) => {
  const [filter, setFilter] = useState('');

  const filtered = contacts.filter(
    (c) =>
      c.deviceId.toLowerCase().includes(filter.toLowerCase()) ||
      c.alias.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <aside className="relative w-full md:w-80 h-full flex flex-col border-r border-[#27272a] bg-[#09090b] font-sans select-none">
      {/* Top Search Input */}
      <div className="p-3 pb-2">
        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-[#71717a]">
            <Search className="w-3.5 h-3.5" />
          </div>
          <input
            id="peer-search-input"
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search chats"
            className="w-full pl-9 pr-3 py-2 bg-[#18181b] border border-[#27272a] rounded-lg text-white placeholder-[#71717a] focus:outline-none focus:border-white transition-colors text-xs"
          />
        </div>
      </div>

      {/* Section Header */}
      <div className="px-4 py-1.5 flex items-center justify-between">
        <span className="text-[11px] font-medium text-[#71717a] uppercase tracking-wider">
          Conversations
        </span>
        <span className="text-[11px] text-[#71717a]">
          {contacts.length}
        </span>
      </div>

      {/* Contacts List */}
      <div className="flex-1 overflow-y-auto px-2 space-y-0.5">
        {filtered.length === 0 ? (
          <div className="p-6 text-center text-[#71717a] space-y-3 mt-6">
            <div className="w-10 h-10 rounded-full bg-[#18181b] border border-[#27272a] flex items-center justify-center mx-auto text-white">
              <MessageSquare className="w-4 h-4" />
            </div>
            <div>
              <p className="text-xs font-medium text-white">No chats yet</p>
              <p className="text-[11px] text-[#71717a] mt-0.5">
                Start a new conversation to begin.
              </p>
            </div>
            <button
              onClick={onOpenPairing}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-white hover:bg-neutral-200 text-black font-semibold rounded-lg text-xs transition-colors shadow-sm"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Chat</span>
            </button>
          </div>
        ) : (
          filtered.map((contact) => {
            const isConnected = connectedPeerId === contact.deviceId;
            const isSelected = activeContactId === contact.deviceId;
            const lastMsg = lastMessages?.get(contact.deviceId);
            const avatarColor = contact.avatarColor || '#3b82f6';
            const initial = (contact.alias || contact.deviceId.slice(4, 6)).charAt(0).toUpperCase();

            // Format message time
            let timeDisplay = '';
            if (lastMsg) {
              const d = new Date(lastMsg.timestamp);
              const now = new Date();
              if (d.toDateString() === now.toDateString()) {
                timeDisplay = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
              } else {
                timeDisplay = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
              }
            }

            return (
              <div
                key={contact.deviceId}
                id={`peer-item-${contact.deviceId}`}
                onClick={() => onSelectPeer(contact)}
                className={`p-2 rounded-xl cursor-pointer transition-all flex items-center justify-between gap-3 group ${
                  isSelected
                    ? 'bg-[#18181b] border border-[#27272a]'
                    : 'hover:bg-[#121215]'
                }`}
              >
                {/* Avatar & Online Dot */}
                <div className="relative flex-shrink-0">
                  <div
                    className="w-9 h-9 rounded-full flex items-center justify-center text-white font-medium text-xs shadow-sm"
                    style={{ backgroundColor: avatarColor }}
                  >
                    {initial}
                  </div>
                  <div
                    className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-[#09090b] ${
                      isConnected ? 'bg-emerald-400' : contact.isOnline ? 'bg-emerald-500' : 'bg-[#52525b]'
                    }`}
                  />
                </div>

                {/* Contact Name & Message Preview */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="font-medium text-white truncate text-xs">
                      {contact.alias}
                    </span>
                    <span className="text-[10px] text-[#71717a] font-sans">
                      {timeDisplay}
                    </span>
                  </div>

                  <div className="text-[11px] text-[#a1a1aa] truncate flex items-center gap-1">
                    {lastMsg ? (
                      <>
                        {lastMsg.mediaType === 'image' ? (
                          <span className="flex items-center gap-1 text-white">
                            <ImageIcon className="w-3 h-3 text-[#a1a1aa]" />
                            <span>Photo</span>
                          </span>
                        ) : lastMsg.mediaType === 'audio' ? (
                          <span className="flex items-center gap-1 text-white">
                            <Mic className="w-3 h-3 text-[#a1a1aa]" />
                            <span>Voice message</span>
                          </span>
                        ) : lastMsg.fileId ? (
                          <span className="flex items-center gap-1 text-white">
                            <FileText className="w-3 h-3 text-[#a1a1aa]" />
                            <span>{lastMsg.payloadText || 'File'}</span>
                          </span>
                        ) : (
                          <span>{lastMsg.payloadText}</span>
                        )}
                      </>
                    ) : (
                      <span className="text-[#71717a] text-[10px]">No messages</span>
                    )}
                  </div>
                </div>

                {/* Delete Hover Action */}
                <button
                  id={`delete-peer-${contact.deviceId}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm(`Remove ${contact.alias} from contacts?`)) {
                      onDeleteContact(contact.deviceId);
                    }
                  }}
                  className="opacity-0 group-hover:opacity-100 p-1 text-[#71717a] hover:text-red-400 hover:bg-[#27272a] rounded-md transition-all"
                  title="Remove contact"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })
        )}
      </div>

      {/* Floating Action Button */}
      <div className="absolute bottom-4 right-4 z-10">
        <button
          id="fab-add-contact-btn"
          onClick={onOpenPairing}
          className="w-10 h-10 rounded-full bg-white hover:bg-neutral-200 text-black shadow-lg flex items-center justify-center transition-all active:scale-95"
          title="New Chat"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>
    </aside>
  );
};


