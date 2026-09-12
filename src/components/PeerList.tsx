import React, { useState, useRef, useEffect } from 'react';
import { ContactRecord, GroupRecord, MessageRecord } from '../types/index';
import {
  Plus,
  Search,
  Image as ImageIcon,
  Mic,
  FileText,
  MoreVertical,
  Users,
  MessageSquare,
  FileCode,
  Phone,
  Video,
  Info,
  Trash2,
  UserX,
  Check,
  Copy,
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
  const [contactMenuOpenId, setContactMenuOpenId] = useState<string | null>(null);
  const [contactToDelete, setContactToDelete] = useState<ContactRecord | null>(null);

  const filteredContacts = contacts.filter(
    (c) =>
      c.deviceId.toLowerCase().includes(filter.toLowerCase()) ||
      c.alias.toLowerCase().includes(filter.toLowerCase())
  );

  const filteredGroups = groups.filter(
    (g) =>
      g.name.toLowerCase().includes(filter.toLowerCase()) ||
      (g.description && g.description.toLowerCase().includes(filter.toLowerCase()))
  );

  const renderLastMessagePreview = (lastMsg?: MessageRecord) => {
    if (!lastMsg) {
      return <span className="text-zinc-500 italic">No messages yet</span>;
    }
    if (lastMsg.mediaType === 'image') {
      return (
        <span className="flex items-center gap-1 text-zinc-400">
          <ImageIcon className="w-3.5 h-3.5 text-blue-400" />
          <span>Photo</span>
        </span>
      );
    }
    if (lastMsg.mediaType === 'audio') {
      return (
        <span className="flex items-center gap-1 text-zinc-400">
          <Mic className="w-3.5 h-3.5 text-rose-400" />
          <span>Voice message</span>
        </span>
      );
    }
    if (lastMsg.mediaType === 'code' || lastMsg.codeSnippet) {
      return (
        <span className="flex items-center gap-1 text-zinc-400">
          <FileCode className="w-3.5 h-3.5 text-emerald-400" />
          <span>Code snippet</span>
        </span>
      );
    }
    if (lastMsg.fileId) {
      return (
        <span className="flex items-center gap-1 text-zinc-400">
          <FileText className="w-3.5 h-3.5 text-amber-400" />
          <span>Attachment</span>
        </span>
      );
    }
    return <span className="truncate text-zinc-400">{lastMsg.payloadText}</span>;
  };

  const getAvatarInitial = (contact: ContactRecord) => {
    const alias = contact.alias || contact.deviceId;
    return alias.charAt(0).toUpperCase();
  };

  return (
    <aside className="relative w-full md:w-80 h-full min-h-0 flex flex-col border-r border-zinc-800 bg-zinc-950 font-sans select-none">
      {/* Top Header */}
      <div className="px-4 py-3.5 flex items-center justify-between shrink-0">
        <h2 className="text-sm font-semibold text-white tracking-tight">
          Chats
        </h2>
        <div className="flex items-center gap-1.5">
          {onOpenGroupCreator && (
            <button
              id="create-group-btn"
              onClick={onOpenGroupCreator}
              className="p-1.5 bg-zinc-900 hover:bg-zinc-800 text-white rounded-lg border border-zinc-800 transition-all text-xs font-medium flex items-center gap-1"
              title="Create Group"
              aria-label="Create Group"
            >
              <Users className="w-3.5 h-3.5 text-blue-400" />
              <span className="text-[11px]">Group</span>
            </button>
          )}
          <button
            id="add-contact-btn"
            onClick={onOpenPairing}
            className="p-1.5 bg-zinc-900 hover:bg-zinc-800 text-white rounded-lg border border-zinc-800 transition-all text-xs font-medium flex items-center gap-1"
            title="Add Contact / Pair Device"
            aria-label="Add Contact"
          >
            <Plus className="w-3.5 h-3.5" />
            <span className="text-[11px]">Pair</span>
          </button>
        </div>
      </div>

      {/* Search Bar */}
      <div className="px-3 pb-2.5 shrink-0">
        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-zinc-500">
            <Search className="w-3.5 h-3.5" />
          </div>
          <input
            id="peer-search-input"
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search chats..."
            className="w-full pl-9 pr-3 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-white placeholder-zinc-500 input-base text-xs focus:ring-1 focus:ring-emerald-400/20"
            aria-label="Search chats"
          />
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="px-3 pb-2.5 shrink-0">
        <div className="flex items-center gap-1 bg-zinc-900 border border-zinc-800 rounded-lg p-1">
          <button
            onClick={() => setCurrentTab('all')}
            className={`flex-1 py-1.5 rounded-md text-xs font-medium transition-all ${
              currentTab === 'all'
                ? 'bg-zinc-950 text-white shadow-sm'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
            aria-label="All chats"
          >
            All
          </button>
          <button
            onClick={() => setCurrentTab('direct')}
            className={`flex-1 py-1.5 rounded-md text-xs font-medium transition-all ${
              currentTab === 'direct'
                ? 'bg-zinc-950 text-white shadow-sm'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
            aria-label={`Direct messages (${contacts.length})`}
          >
            Direct ({contacts.length})
          </button>
          <button
            onClick={() => setCurrentTab('groups')}
            className={`flex-1 py-1.5 rounded-md text-xs font-medium transition-all ${
              currentTab === 'groups'
                ? 'bg-zinc-950 text-white shadow-sm'
                : 'text-zinc-500 hover:text-zinc-300'
            }`}
            aria-label={`Groups (${groups.length})`}
          >
            Groups ({groups.length})
          </button>
        </div>
      </div>

      {/* List Content */}
      <div className="flex-1 overflow-y-auto px-2 pt-1 space-y-1">
        {/* Groups Section */}
        {(currentTab === 'all' || currentTab === 'groups') && filteredGroups.length > 0 && (
          <div className="space-y-0.5 mb-2">
            {currentTab === 'all' && (
              <div className="px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                Groups
              </div>
            )}
            {filteredGroups.map((group) => {
              const isSelected = activeGroupId === group.groupId;
              const lastMsg = lastMessages?.get(group.groupId);

              return (
                <div
                  key={group.groupId}
                  onClick={() => onSelectGroup?.(group)}
                  className={`p-2.5 rounded-xl cursor-pointer transition-all flex items-center gap-2.5 group ${
                    isSelected
                      ? 'bg-zinc-950 border border-zinc-800'
                      : 'hover:bg-zinc-900/50'
                  }`}
                  aria-label={group.name}
                >
                  <div
                    className="relative shrink-0 cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenGroupDetails?.(group);
                    }}
                    title="View Group info"
                  >
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold text-xs shadow-sm"
                      style={{ backgroundColor: group.avatarColor || '#2563eb' }}
                    >
                      {group.name.charAt(0).toUpperCase()}
                    </div>
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1 mb-0.5">
                      <span className="font-medium text-xs text-white truncate">
                        {group.name}
                      </span>
                      <span className="text-[10px] text-zinc-500 font-mono">
                        {group.memberDeviceIds.length} members
                      </span>
                    </div>
                    <div className="text-[11px] text-zinc-400 truncate font-sans">
                      {renderLastMessagePreview(lastMsg)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Direct Contacts Section */}
        <div className="space-y-0.5">
          {currentTab === 'all' && filteredGroups.length > 0 && (
            <div className="px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
              Direct Messages
            </div>
          )}

          {filteredContacts.length === 0 && filteredGroups.length === 0 ? (
            <div className="p-6 text-center mt-6">
              <p className="text-xs text-zinc-500 mb-3">No conversations yet</p>
              <button
                onClick={onOpenPairing}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-white hover:bg-neutral-200 text-black font-semibold rounded-lg text-xs transition-colors shadow-sm"
                aria-label="Pair Device"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Pair Device</span>
              </button>
            </div>
          ) : currentTab !== 'groups' ? (
            filteredContacts.map((contact) => {
              const isConnected = connectedPeerId === contact.deviceId;
              const isSelected = activeContactId === contact.deviceId && !activeGroupId;
              const lastMsg = lastMessages?.get(contact.deviceId);
              const avatarColor = contact.avatarColor || '#3b82f6';
              const initial = getAvatarInitial(contact);

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
                  className={`p-2.5 rounded-xl cursor-pointer transition-all flex items-center justify-between gap-2.5 group ${
                    isSelected
                      ? 'bg-zinc-950 border border-zinc-800'
                      : 'hover:bg-zinc-900/50'
                  }`}
                  aria-label={contact.alias || contact.deviceId}
                >
                  <div
                    className="relative shrink-0 cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenContactDetails(contact);
                    }}
                    title="View contact profile"
                  >
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-medium text-xs shadow-sm"
                      style={{ backgroundColor: avatarColor }}
                    >
                      {initial}
                    </div>
                    <div
                      className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-[#0a0a0b] ${
                        isConnected || contact.isOnline ? 'bg-emerald-400' : 'bg-zinc-600'
                      }`}
                    />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1 mb-0.5">
                      <span className="font-medium text-xs text-white truncate">
                        {contact.alias || contact.deviceId}
                      </span>
                      {timeDisplay && (
                        <span className="text-[10px] text-zinc-500 font-mono shrink-0">
                          {timeDisplay}
                        </span>
                      )}
                    </div>

                    <div className="text-[11px] text-zinc-400 truncate font-sans flex items-center gap-1">
                      {contact.verificationStatus === 'VERIFIED' ? (
                        <span className="text-emerald-400 mr-0.5">✓</span>
                      ) : null}
                      {renderLastMessagePreview(lastMsg)}
                    </div>
                  </div>

                  {/* Quick Contact Actions */}
                  <div className="relative shrink-0 flex items-center gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                    {onStartCall && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onStartCall(contact.deviceId, contact.alias, 'audio');
                        }}
                        className="p-1.5 rounded-lg text-zinc-400 hover:text-emerald-400 hover:bg-zinc-800 transition-colors cursor-pointer"
                        title="Voice Call"
                        aria-label="Voice Call"
                      >
                        <Phone className="w-3.5 h-3.5" />
                      </button>
                    )}

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenContactDetails(contact);
                      }}
                      className="p-1.5 rounded-lg text-zinc-400 hover:text-blue-400 hover:bg-zinc-800 transition-colors cursor-pointer"
                      title="Contact Info"
                      aria-label="Contact Info"
                    >
                      <Info className="w-3.5 h-3.5" />
                    </button>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setContactMenuOpenId(contactMenuOpenId === contact.deviceId ? null : contact.deviceId);
                      }}
                      className="p-1.5 rounded-lg text-zinc-500 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer"
                      title="More options"
                      aria-label="More options"
                    >
                      <MoreVertical className="w-3.5 h-3.5" />
                    </button>

                    {/* Contact Menu Popup */}
                    {contactMenuOpenId === contact.deviceId && (
                      <div
                        className="absolute right-0 top-full mt-1 w-48 bg-zinc-950 border border-zinc-800 rounded-xl shadow-xl py-1 z-30 animate-in animate-scale-in"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          onClick={() => {
                            setContactMenuOpenId(null);
                            onOpenContactDetails(contact);
                          }}
                          className="w-full px-3 py-2 text-left text-zinc-300 hover:text-white hover:bg-zinc-800 rounded-lg transition-colors flex items-center gap-2 cursor-pointer"
                        >
                          <Info className="w-3.5 h-3.5 text-blue-400" />
                          <span>View Profile</span>
                        </button>

                        {onStartCall && (
                          <>
                            <button
                              onClick={() => {
                                setContactMenuOpenId(null);
                                onStartCall(contact.deviceId, contact.alias, 'audio');
                              }}
                              className="w-full px-3 py-2 text-left text-zinc-300 hover:text-white hover:bg-zinc-800 rounded-lg transition-colors flex items-center gap-2 cursor-pointer"
                            >
                              <Phone className="w-3.5 h-3.5 text-emerald-400" />
                              <span>Voice Call</span>
                            </button>
                            <button
                              onClick={() => {
                                setContactMenuOpenId(null);
                                onStartCall(contact.deviceId, contact.alias, 'video');
                              }}
                              className="w-full px-3 py-2 text-left text-zinc-300 hover:text-white hover:bg-zinc-800 rounded-lg transition-colors flex items-center gap-2 cursor-pointer"
                            >
                              <Video className="w-3.5 h-3.5 text-blue-400" />
                              <span>Video Call</span>
                            </button>
                          </>
                        )}

                        <div className="my-1 border-t border-zinc-800" />

                        <button
                          onClick={() => {
                            setContactMenuOpenId(null);
                            setContactToDelete(contact);
                          }}
                          className="w-full px-3 py-2 text-left text-rose-400 hover:bg-rose-950/30 rounded-lg transition-colors flex items-center gap-2 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Delete Contact</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          ) : null}
        </div>
      </div>

      {/* Delete Contact Confirmation */}
      {contactToDelete && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 select-none font-sans"
          onClick={() => setContactToDelete(null)}
        >
          <div
            className="w-full max-w-sm bg-zinc-950 border border-zinc-800 rounded-2xl p-6 shadow-xl space-y-4 animate-in animate-scale-in"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 text-rose-400">
              <div className="p-2 rounded-xl bg-rose-950/30 border border-rose-900/40">
                <UserX className="w-5 h-5" />
              </div>
              <div>
                <h4 className="font-semibold text-white text-sm">Delete Contact?</h4>
                <p className="text-[11px] text-zinc-400">
                  {contactToDelete.alias || contactToDelete.deviceId}
                </p>
              </div>
            </div>

            <p className="text-xs text-zinc-400 leading-relaxed">
              This contact and their entire chat history will be removed.
            </p>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setContactToDelete(null)}
                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white rounded-lg text-xs font-medium transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (onDeleteContact && contactToDelete) {
                    onDeleteContact(contactToDelete.deviceId);
                  }
                  setContactToDelete(null);
                }}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white font-medium rounded-lg flex items-center gap-1.5 transition-colors text-xs cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
};