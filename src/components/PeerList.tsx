import React, { useState } from 'react';
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
      return <span className="text-[#52525b] italic">No messages yet</span>;
    }
    if (lastMsg.mediaType === 'image') {
      return (
        <span className="flex items-center gap-1 text-[#a1a1aa]">
          <ImageIcon className="w-3 h-3 text-blue-400" />
          <span>Photo</span>
        </span>
      );
    }
    if (lastMsg.mediaType === 'audio') {
      return (
        <span className="flex items-center gap-1 text-[#a1a1aa]">
          <Mic className="w-3 h-3 text-rose-400" />
          <span>Voice message</span>
        </span>
      );
    }
    if (lastMsg.mediaType === 'code' || lastMsg.codeSnippet) {
      return (
        <span className="flex items-center gap-1 text-[#a1a1aa]">
          <FileCode className="w-3 h-3 text-emerald-400" />
          <span>Code snippet</span>
        </span>
      );
    }
    if (lastMsg.fileId) {
      return (
        <span className="flex items-center gap-1 text-[#a1a1aa]">
          <FileText className="w-3 h-3 text-amber-400" />
          <span>Attachment</span>
        </span>
      );
    }
    return <span className="truncate">{lastMsg.payloadText}</span>;
  };

  return (
    <aside className="relative w-full md:w-80 h-full min-h-0 flex flex-col border-r border-[#27272a] bg-[#09090b] font-sans select-none">
      {/* Top Header */}
      <div className="px-4 pt-3.5 pb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white tracking-tight">
          Chats & Groups
        </h2>
        <div className="flex items-center gap-1.5">
          {onOpenGroupCreator && (
            <button
              id="create-group-btn"
              onClick={onOpenGroupCreator}
              className="p-1.5 bg-[#18181b] hover:bg-[#27272a] text-white rounded-lg border border-[#27272a] transition-all hover:scale-105 active:scale-95 flex items-center gap-1 text-xs font-medium"
              title="Create Group"
            >
              <Users className="w-3.5 h-3.5 text-blue-400" />
              <span className="text-[11px] pr-0.5">Group</span>
            </button>
          )}
          <button
            id="add-contact-btn"
            onClick={onOpenPairing}
            className="p-1.5 bg-[#18181b] hover:bg-[#27272a] text-white rounded-lg border border-[#27272a] transition-all hover:scale-105 active:scale-95 flex items-center gap-1 text-xs font-medium"
            title="Add Contact / Pair Device"
          >
            <Plus className="w-3.5 h-3.5" />
            <span className="text-[11px] pr-0.5">Pair</span>
          </button>
        </div>
      </div>

      {/* Search Bar */}
      <div className="px-3 pb-2">
        <div className="relative">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-[#71717a]">
            <Search className="w-3.5 h-3.5" />
          </div>
          <input
            id="peer-search-input"
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search chats or groups..."
            className="w-full pl-9 pr-3 py-1.5 bg-[#141418] border border-[#222226] rounded-lg text-white placeholder-[#71717a] focus:outline-none focus:border-[#3f3f46] transition-colors text-xs"
          />
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="px-3 pb-2 flex items-center gap-1">
        <button
          onClick={() => setCurrentTab('all')}
          className={`flex-1 py-1 rounded-md text-[11px] font-medium transition-colors ${
            currentTab === 'all'
              ? 'bg-[#18181b] text-white border border-[#27272a]'
              : 'text-[#71717a] hover:text-[#a1a1aa]'
          }`}
        >
          All
        </button>
        <button
          onClick={() => setCurrentTab('direct')}
          className={`flex-1 py-1 rounded-md text-[11px] font-medium transition-colors ${
            currentTab === 'direct'
              ? 'bg-[#18181b] text-white border border-[#27272a]'
              : 'text-[#71717a] hover:text-[#a1a1aa]'
          }`}
        >
          Direct ({contacts.length})
        </button>
        <button
          onClick={() => setCurrentTab('groups')}
          className={`flex-1 py-1 rounded-md text-[11px] font-medium transition-colors ${
            currentTab === 'groups'
              ? 'bg-[#18181b] text-white border border-[#27272a]'
              : 'text-[#71717a] hover:text-[#a1a1aa]'
          }`}
        >
          Groups ({groups.length})
        </button>
      </div>

      {/* List Content */}
      <div className="flex-1 overflow-y-auto px-2 pt-1 space-y-1">
        {/* Groups Section */}
        {(currentTab === 'all' || currentTab === 'groups') && filteredGroups.length > 0 && (
          <div className="space-y-0.5 mb-2">
            {currentTab === 'all' && (
              <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-[#71717a]">
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
                  className={`p-2 rounded-xl cursor-pointer transition-all flex items-center justify-between gap-2.5 group ${
                    isSelected
                      ? 'bg-[#18181b] border border-[#27272a]'
                      : 'hover:bg-[#121215]'
                  }`}
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
                      className="w-9 h-9 rounded-xl flex items-center justify-center text-white font-bold text-xs shadow-sm hover:ring-2 hover:ring-[#3f3f46] transition-all"
                      style={{ backgroundColor: group.avatarColor || '#2563eb' }}
                    >
                      {group.name.charAt(0).toUpperCase()}
                    </div>
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1 mb-0.5">
                      <span className="font-semibold text-xs text-white truncate">
                        {group.name}
                      </span>
                      <span className="text-[10px] text-[#71717a] font-mono">
                        {group.memberDeviceIds.length} members
                      </span>
                    </div>
                    <div className="text-[11px] text-[#a1a1aa] truncate font-sans">
                      {renderLastMessagePreview(lastMsg)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Direct Contacts Section */}
        {(currentTab === 'all' || currentTab === 'direct') && (
          <div className="space-y-0.5">
            {currentTab === 'all' && filteredGroups.length > 0 && (
              <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-[#71717a]">
                Direct Messages
              </div>
            )}

            {filteredContacts.length === 0 && filteredGroups.length === 0 ? (
              <div className="p-6 text-center mt-6">
                <p className="text-xs text-[#71717a] mb-3">No conversations yet</p>
                <button
                  onClick={onOpenPairing}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-neutral-200 text-black font-semibold rounded-lg text-xs transition-colors shadow-sm"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Pair Device</span>
                </button>
              </div>
            ) : (
              filteredContacts.map((contact) => {
                const isConnected = connectedPeerId === contact.deviceId;
                const isSelected = activeContactId === contact.deviceId && !activeGroupId;
                const lastMsg = lastMessages?.get(contact.deviceId);
                const avatarColor = contact.avatarColor || '#3b82f6';
                const initial = (contact.alias || contact.deviceId.slice(4, 6)).charAt(0).toUpperCase();

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
                    className={`p-2 rounded-xl cursor-pointer transition-all flex items-center justify-between gap-2.5 group ${
                      isSelected
                        ? 'bg-[#18181b] border border-[#27272a]'
                        : 'hover:bg-[#121215]'
                    }`}
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
                        className="w-9 h-9 rounded-full flex items-center justify-center text-white font-medium text-xs shadow-sm hover:ring-2 hover:ring-[#3f3f46] transition-all"
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

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1 mb-0.5">
                        <span className="font-medium text-xs text-white truncate">
                          {contact.alias || contact.deviceId}
                        </span>
                        {timeDisplay && (
                          <span className="text-[10px] text-[#71717a] font-mono shrink-0">
                            {timeDisplay}
                          </span>
                        )}
                      </div>

                      <div className="text-[11px] text-[#a1a1aa] truncate font-sans">
                        {renderLastMessagePreview(lastMsg)}
                      </div>
                    </div>

                    {/* Quick Contact Actions: Call, Info, Options Menu */}
                    <div className="relative shrink-0 flex items-center gap-1 opacity-80 group-hover:opacity-100 transition-opacity">
                      {onStartCall && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onStartCall(contact.deviceId, contact.alias, 'audio');
                          }}
                          className="p-1 rounded-lg text-[#a1a1aa] hover:text-emerald-400 hover:bg-[#27272a] transition-colors cursor-pointer"
                          title="Call contact"
                        >
                          <Phone className="w-3.5 h-3.5" />
                        </button>
                      )}

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenContactDetails(contact);
                        }}
                        className="p-1 rounded-lg text-[#a1a1aa] hover:text-blue-400 hover:bg-[#27272a] transition-colors cursor-pointer"
                        title="Contact Info"
                      >
                        <Info className="w-3.5 h-3.5" />
                      </button>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setContactMenuOpenId(contactMenuOpenId === contact.deviceId ? null : contact.deviceId);
                        }}
                        className="p-1 rounded-lg text-[#71717a] hover:text-white hover:bg-[#27272a] transition-colors cursor-pointer"
                        title="More options"
                      >
                        <MoreVertical className="w-3.5 h-3.5" />
                      </button>

                      {/* Contact Menu Popup */}
                      {contactMenuOpenId === contact.deviceId && (
                        <div
                          className="absolute right-0 top-full mt-1 w-44 bg-[#18181b] border border-[#27272a] rounded-xl shadow-2xl py-1 z-30 animate-in fade-in zoom-in-95 font-sans text-xs"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            onClick={() => {
                              setContactMenuOpenId(null);
                              onOpenContactDetails(contact);
                            }}
                            className="w-full px-3 py-2 text-left text-white hover:bg-[#27272a] flex items-center gap-2 transition-colors cursor-pointer"
                          >
                            <Info className="w-3.5 h-3.5 text-blue-400" />
                            <span>Contact Info</span>
                          </button>

                          {onStartCall && (
                            <>
                              <button
                                onClick={() => {
                                  setContactMenuOpenId(null);
                                  onStartCall(contact.deviceId, contact.alias, 'audio');
                                }}
                                className="w-full px-3 py-2 text-left text-white hover:bg-[#27272a] flex items-center gap-2 transition-colors cursor-pointer"
                              >
                                <Phone className="w-3.5 h-3.5 text-emerald-400" />
                                <span>Voice Call</span>
                              </button>
                              <button
                                onClick={() => {
                                  setContactMenuOpenId(null);
                                  onStartCall(contact.deviceId, contact.alias, 'video');
                                }}
                                className="w-full px-3 py-2 text-left text-white hover:bg-[#27272a] flex items-center gap-2 transition-colors cursor-pointer"
                              >
                                <Video className="w-3.5 h-3.5 text-blue-400" />
                                <span>Video Call</span>
                              </button>
                            </>
                          )}

                          <div className="my-1 border-t border-[#27272a]" />

                          <button
                            onClick={() => {
                              setContactMenuOpenId(null);
                              setContactToDelete(contact);
                            }}
                            className="w-full px-3 py-2 text-left text-red-400 hover:bg-red-950/40 flex items-center gap-2 transition-colors cursor-pointer"
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
            )}
          </div>
        )}
      </div>

      {/* Delete Contact Confirmation Modal */}
      {contactToDelete && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 font-sans text-xs"
          onClick={() => setContactToDelete(null)}
        >
          <div
            className="w-full max-w-sm bg-[#18181b] border border-[#27272a] rounded-2xl p-5 shadow-2xl space-y-4 animate-in fade-in zoom-in-95"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2.5 text-red-400">
              <div className="p-2 rounded-xl bg-red-950/50 border border-red-900/50">
                <UserX className="w-5 h-5" />
              </div>
              <div>
                <h4 className="font-semibold text-white text-sm">Delete Contact?</h4>
                <p className="text-[11px] text-[#a1a1aa]">
                  {contactToDelete.alias || contactToDelete.deviceId}
                </p>
              </div>
            </div>

            <p className="text-xs text-[#a1a1aa] leading-relaxed">
              This contact and their entire chat history will be removed. Contact removal is automatically synchronized with the peer device.
            </p>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setContactToDelete(null)}
                className="px-3.5 py-1.5 bg-[#27272a] hover:bg-[#3f3f46] text-[#a1a1aa] hover:text-white rounded-lg text-xs font-medium transition-colors cursor-pointer"
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
                className="px-3.5 py-1.5 bg-red-600 hover:bg-red-500 text-white font-medium rounded-lg flex items-center gap-1.5 transition-colors text-xs shadow-sm cursor-pointer"
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
