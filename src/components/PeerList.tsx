import React, { useEffect, useRef, useState } from 'react';
import { ContactRecord, GroupRecord, MessageRecord } from '../types/index';
import {
  FileCode,
  FileText,
  Image as ImageIcon,
  Info,
  Mic,
  MoreVertical,
  Phone,
  Plus,
  Search,
  Trash2,
  UserX,
  Users,
  Video,
} from 'lucide-react';

interface PeerListProps {
  contacts: ContactRecord[];
  groups?: GroupRecord[];
  activeContactId: string | null;
  activeGroupId?: string | null;
  connectedPeerId: string | null;
  lastMessages?: Map<string, MessageRecord>;
  onSelectPeer: (peer: ContactRecord) => void;
  onSelectGroup?: (group: GroupRecord) => void;
  onOpenPairing: () => void;
  onOpenGroupCreator?: () => void;
  onOpenContactDetails: (contact: ContactRecord) => void;
  onOpenGroupDetails?: (group: GroupRecord) => void;
  onStartCall?: (deviceId: string, alias: string, type: 'audio' | 'video') => void;
  onDeleteContact?: (deviceId: string) => void;
}

const formatStamp = (timestamp: number): string => {
  const date = new Date(timestamp);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  const sameWeek = now.getTime() - date.getTime() < 6 * 24 * 60 * 60 * 1000;
  if (sameWeek) return date.toLocaleDateString([], { weekday: 'short' });
  return date.toLocaleDateString([], { day: '2-digit', month: '2-digit' });
};

export const PeerList: React.FC<PeerListProps> = ({
  contacts,
  groups = [],
  activeContactId,
  activeGroupId,
  connectedPeerId,
  lastMessages,
  onSelectPeer,
  onSelectGroup,
  onOpenPairing,
  onOpenGroupCreator,
  onOpenContactDetails,
  onOpenGroupDetails,
  onStartCall,
  onDeleteContact,
}) => {
  const [filter, setFilter] = useState('');
  const [currentTab, setCurrentTab] = useState<'all' | 'direct' | 'groups'>('all');
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [contactToDelete, setContactToDelete] = useState<ContactRecord | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpenId) return;
    const close = () => setMenuOpenId(null);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuOpenId]);

  const query = filter.trim().toLowerCase();

  const filteredContacts = contacts.filter(
    (c) => c.deviceId.toLowerCase().includes(query) || c.alias.toLowerCase().includes(query)
  );

  const filteredGroups = groups.filter(
    (g) => g.name.toLowerCase().includes(query) || (g.description || '').toLowerCase().includes(query)
  );

  const renderPreview = (lastMsg?: MessageRecord) => {
    if (!lastMsg) return <span className="text-zinc-500">No messages yet</span>;
    if (lastMsg.mediaType === 'image') {
      return (
        <span className="flex items-center gap-1.5 min-w-0">
          <ImageIcon className="w-3.5 h-3.5 shrink-0 text-zinc-500" />
          <span>Photo</span>
        </span>
      );
    }
    if (lastMsg.mediaType === 'audio') {
      return (
        <span className="flex items-center gap-1.5 min-w-0">
          <Mic className="w-3.5 h-3.5 shrink-0 text-zinc-500" />
          <span>Voice message</span>
        </span>
      );
    }
    if (lastMsg.mediaType === 'code' || lastMsg.codeSnippet) {
      return (
        <span className="flex items-center gap-1.5 min-w-0">
          <FileCode className="w-3.5 h-3.5 shrink-0 text-zinc-500" />
          <span>Snippet</span>
        </span>
      );
    }
    if (lastMsg.fileId) {
      return (
        <span className="flex items-center gap-1.5 min-w-0">
          <FileText className="w-3.5 h-3.5 shrink-0 text-zinc-500" />
          <span>Attachment</span>
        </span>
      );
    }
    return (
      <span className="truncate">
        {lastMsg.direction === 'OUTBOUND' ? 'You: ' : ''}
        {lastMsg.payloadText}
      </span>
    );
  };

  const initialOf = (value: string) => (value || '?').charAt(0).toUpperCase();

  const tabs: Array<{ id: 'all' | 'direct' | 'groups'; label: string }> = [
    { id: 'all', label: 'All' },
    { id: 'direct', label: `Direct ${contacts.length}` },
    { id: 'groups', label: `Groups ${groups.length}` },
  ];

  return (
    <aside className="relative w-full md:w-[320px] lg:w-[340px] h-full min-h-0 flex flex-col select-none md:border-r md:border-zinc-800">
      {/* Search */}
      <div className="px-3 sm:px-4 pb-2 shrink-0">
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <input
            id="peer-search-input"
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search"
            aria-label="Search conversations"
            className="w-full pl-10 pr-3 py-2.5 rounded-full border border-zinc-800 bg-zinc-950 text-white placeholder-zinc-500 text-[13px] focus:outline-none focus:border-zinc-700 transition-colors"
          />
        </div>
      </div>

      {/* Segmented filter */}
      <div className="px-3 sm:px-4 pb-2 shrink-0 flex items-center gap-1">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setCurrentTab(tab.id)}
            className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors cursor-pointer ${
              currentTab === tab.id
                ? 'bg-zinc-900 text-white border border-zinc-800'
                : 'text-zinc-500 hover:text-zinc-300 border border-transparent'
            }`}
          >
            {tab.label}
          </button>
        ))}
        <div className="flex-1" />
        {onOpenGroupCreator && (
          <button
            onClick={onOpenGroupCreator}
            className="p-1.5 rounded-full text-zinc-500 hover:text-white hover:bg-zinc-900 transition-colors cursor-pointer"
            title="New group"
            aria-label="New group"
          >
            <Users className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Conversations */}
      <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto px-2 pb-4 space-y-0.5">
        {(currentTab === 'all' || currentTab === 'groups') &&
          filteredGroups.map((group) => {
            const isSelected = activeGroupId === group.groupId;
            const lastMsg = lastMessages?.get(group.groupId);
            return (
              <div
                key={group.groupId}
                onClick={() => onSelectGroup?.(group)}
                data-selected={isSelected}
                className="row-item flex items-center gap-3 px-2.5 py-2.5 cursor-pointer group"
              >
                <div
                  className="shrink-0 w-11 h-11 rounded-full flex items-center justify-center text-white text-sm font-medium"
                  style={{ backgroundColor: group.avatarColor || '#3f3f46' }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenGroupDetails?.(group);
                  }}
                >
                  {initialOf(group.name)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="flex-1 truncate text-[13px] font-medium text-white">{group.name}</span>
                    {lastMsg && (
                      <span className="shrink-0 text-[11px] text-zinc-500 tabular-nums">
                        {formatStamp(lastMsg.timestamp)}
                      </span>
                    )}
                  </div>
                  <div className="truncate text-[12px] text-zinc-500 mt-0.5">
                    {group.memberDeviceIds.length} members · {renderPreview(lastMsg)}
                  </div>
                </div>
              </div>
            );
          })}

        {currentTab !== 'groups' &&
          filteredContacts.map((contact) => {
            const isConnected = connectedPeerId === contact.deviceId;
            const isSelected = activeContactId === contact.deviceId && !activeGroupId;
            const lastMsg = lastMessages?.get(contact.deviceId);
            const isUnread = lastMsg?.direction === 'INBOUND';
            const online = isConnected || contact.isOnline;
            const label = contact.alias || contact.deviceId;

            return (
              <div
                key={contact.deviceId}
                id={`peer-item-${contact.deviceId}`}
                onClick={() => onSelectPeer(contact)}
                data-selected={isSelected}
                className="row-item flex items-center gap-3 px-2.5 py-2.5 cursor-pointer group"
              >
                <div className="relative shrink-0">
                  {contact.avatarUrl ? (
                    <img
                      src={contact.avatarUrl}
                      alt=""
                      className="w-11 h-11 rounded-full object-cover"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenContactDetails(contact);
                      }}
                    />
                  ) : (
                    <div
                      className="w-11 h-11 rounded-full flex items-center justify-center text-white text-sm font-medium"
                      style={{ backgroundColor: contact.avatarColor || '#3f3f46' }}
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenContactDetails(contact);
                      }}
                    >
                      {initialOf(label)}
                    </div>
                  )}
                  {online && (
                    <span className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-[var(--sc-e400)] border-2 border-zinc-950" />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="flex-1 truncate text-[13px] font-medium text-white">{label}</span>
                    {lastMsg && (
                      <span className="shrink-0 text-[11px] text-zinc-500 tabular-nums">
                        {formatStamp(lastMsg.timestamp)}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <div className="flex-1 min-w-0 truncate text-[12px] text-zinc-500">
                      {renderPreview(lastMsg)}
                    </div>
                    {isUnread && !isSelected && (
                      <span className="shrink-0 w-2 h-2 rounded-full bg-zinc-100" />
                    )}
                  </div>
                </div>

                <div className="relative shrink-0">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuOpenId(menuOpenId === contact.deviceId ? null : contact.deviceId);
                    }}
                    className="p-1.5 rounded-full text-zinc-500 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer opacity-0 group-hover:opacity-100 focus:opacity-100"
                    title="More"
                    aria-label="More options"
                  >
                    <MoreVertical className="w-4 h-4" />
                  </button>

                  {menuOpenId === contact.deviceId && (
                    <div
                      className="absolute right-0 top-full mt-1 w-44 p-1.5 rounded-2xl border border-zinc-800 bg-zinc-950 shadow-xl z-30 animate-in animate-scale-in"
                      onClick={(e) => e.stopPropagation()}
                      onMouseDown={(e) => e.stopPropagation()}
                    >
                      <button
                        onClick={() => {
                          setMenuOpenId(null);
                          onOpenContactDetails(contact);
                        }}
                        className="w-full flex items-center gap-2 px-2.5 py-2 rounded-xl text-xs text-zinc-300 hover:text-white hover:bg-zinc-900 transition-colors cursor-pointer"
                      >
                        <Info className="w-3.5 h-3.5" />
                        <span>Profile</span>
                      </button>
                      {onStartCall && (
                        <>
                          <button
                            onClick={() => {
                              setMenuOpenId(null);
                              onStartCall(contact.deviceId, label, 'audio');
                            }}
                            className="w-full flex items-center gap-2 px-2.5 py-2 rounded-xl text-xs text-zinc-300 hover:text-white hover:bg-zinc-900 transition-colors cursor-pointer"
                          >
                            <Phone className="w-3.5 h-3.5" />
                            <span>Voice call</span>
                          </button>
                          <button
                            onClick={() => {
                              setMenuOpenId(null);
                              onStartCall(contact.deviceId, label, 'video');
                            }}
                            className="w-full flex items-center gap-2 px-2.5 py-2 rounded-xl text-xs text-zinc-300 hover:text-white hover:bg-zinc-900 transition-colors cursor-pointer"
                          >
                            <Video className="w-3.5 h-3.5" />
                            <span>Video call</span>
                          </button>
                        </>
                      )}
                      <div className="my-1 h-px bg-zinc-800" />
                      <button
                        onClick={() => {
                          setMenuOpenId(null);
                          setContactToDelete(contact);
                        }}
                        className="w-full flex items-center gap-2 px-2.5 py-2 rounded-xl text-xs text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Delete chat</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}

        {filteredContacts.length === 0 && filteredGroups.length === 0 && (
          <div className="px-4 py-10 text-center">
            <p className="text-[13px] text-zinc-500">
              {query ? 'Nothing matched that search' : 'No conversations yet'}
            </p>
            {!query && (
              <button
                onClick={onOpenPairing}
                className="mt-3 inline-flex items-center gap-1.5 px-4 py-2 btn-primary text-xs"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Pair a device</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Delete confirmation */}
      {contactToDelete && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setContactToDelete(null)}
        >
          <div
            className="w-full max-w-sm rounded-3xl border border-zinc-800 bg-zinc-950 p-6 space-y-4 shadow-xl animate-in animate-scale-in"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-full bg-rose-500/10 text-rose-400">
                <UserX className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <h4 className="text-sm font-medium text-white">Delete this chat?</h4>
                <p className="text-[11px] text-zinc-500 truncate">
                  {contactToDelete.alias || contactToDelete.deviceId}
                </p>
              </div>
            </div>
            <p className="text-xs text-zinc-400">
              The contact and its message history are removed from this device.
            </p>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                onClick={() => setContactToDelete(null)}
                className="px-4 py-2 btn-secondary text-xs"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (onDeleteContact) onDeleteContact(contactToDelete.deviceId);
                  setContactToDelete(null);
                }}
                className="px-4 py-2 rounded-full bg-rose-600 hover:bg-rose-500 text-white text-xs font-medium transition-colors cursor-pointer"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
};
