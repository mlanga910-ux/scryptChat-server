import React, { useState, useRef } from 'react';
import { ContactRecord, GroupRecord, IdentityRecord } from '../types/index';
import { db } from '../db/index';
import {
  X,
  Users,
  Search,
  Check,
  Plus,
  Shield,
  Hash,
  Camera,
  Upload,
  Trash2,
} from 'lucide-react';
import { fileToAvatarDataUrl } from '../utils/imageHelper';

interface GroupCreatorModalProps {
  isOpen: boolean;
  identity: IdentityRecord | null;
  contacts: ContactRecord[];
  onClose: () => void;
  onGroupCreated: (group: GroupRecord) => void;
}

const GROUP_COLORS = [
  '#2563eb', // Royal Blue
  '#059669', // Emerald
  '#d97706', // Amber
  '#dc2626', // Crimson
  '#7c3aed', // Violet
  '#0891b2', // Cyan
  '#db2777', // Pink
  '#4f46e5', // Indigo
];

export const GroupCreatorModal: React.FC<GroupCreatorModalProps> = ({
  isOpen,
  identity,
  contacts,
  onClose,
  onGroupCreated,
}) => {
  const [groupName, setGroupName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedColor, setSelectedColor] = useState(GROUP_COLORS[0]);
  const [avatarUrl, setAvatarUrl] = useState<string | undefined>(undefined);
  const [selectedDeviceIds, setSelectedDeviceIds] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen || !identity) return null;

  const handleAvatarFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await fileToAvatarDataUrl(file);
      setAvatarUrl(dataUrl);
    } catch (err) {
      console.error('Error processing group avatar:', err);
    }
  };

  const filteredContacts = contacts.filter((c) =>
    (c.alias || c.deviceId).toLowerCase().includes(searchQuery.toLowerCase())
  );

  const toggleSelectMember = (deviceId: string) => {
    if (selectedDeviceIds.includes(deviceId)) {
      setSelectedDeviceIds(selectedDeviceIds.filter((id) => id !== deviceId));
    } else {
      setSelectedDeviceIds([...selectedDeviceIds, deviceId]);
    }
  };

  const handleSelectAll = () => {
    if (selectedDeviceIds.length === contacts.length) {
      setSelectedDeviceIds([]);
    } else {
      setSelectedDeviceIds(contacts.map((c) => c.deviceId));
    }
  };

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!groupName.trim()) {
      setErrorMsg('Please enter a group name');
      return;
    }
    if (selectedDeviceIds.length === 0) {
      setErrorMsg('Please select at least one contact for the group');
      return;
    }

    setIsCreating(true);
    setErrorMsg('');

    try {
      const newGroupId = `grp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const allMembers = Array.from(new Set([identity.deviceId, ...selectedDeviceIds]));

      const groupRecord: GroupRecord = {
        groupId: newGroupId,
        name: groupName.trim(),
        description: description.trim() || undefined,
        avatarColor: selectedColor,
        avatarUrl,
        adminDeviceId: identity.deviceId,
        memberDeviceIds: allMembers,
        createdAt: Date.now(),
        lastActivityAt: Date.now(),
        unreadCount: 0,
      };

      await db.groups.put(groupRecord);

      // Add a system welcome message
      await db.messages.add({
        chatDeviceId: newGroupId,
        isGroup: true,
        groupId: newGroupId,
        senderDeviceId: identity.deviceId,
        senderDisplayName: identity.displayName || 'You',
        direction: 'OUTBOUND',
        payloadText: `Group "${groupName.trim()}" created with ${allMembers.length} members. Direct end-to-end encrypted group chat.`,
        mediaType: 'text',
        timestamp: Date.now(),
        status: 'verified',
      });

      onGroupCreated(groupRecord);
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to create group');
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div
      id="group-creator-modal-backdrop"
      className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 select-none font-sans text-xs animate-in fade-in duration-150"
    >
      <div className="w-full max-w-md h-[580px] max-h-[92vh] bg-[#0c0c0e] border border-[#27272a] rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-[#1f1f23] bg-[#09090b] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#18181b] border border-[#27272a] flex items-center justify-center text-white">
              <Users className="w-4 h-4 text-blue-400" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white tracking-tight">
                Create Group Chat
              </h3>
              <p className="text-[11px] text-[#71717a]">
                Multi-peer encrypted chat and group calls
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-[#71717a] hover:text-white hover:bg-[#18181b] rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Form */}
        <form onSubmit={handleCreateGroup} className="flex-1 overflow-y-auto p-5 space-y-4">
          {errorMsg && (
            <div className="p-2.5 bg-rose-950/40 border border-rose-900/60 rounded-xl text-rose-300 text-[11px]">
              {errorMsg}
            </div>
          )}

          {/* Group Avatar Preview & Name */}
          <div className="flex items-center gap-3.5 p-3.5 bg-[#09090b] border border-[#1f1f23] rounded-xl">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleAvatarFileSelect}
              accept="image/*"
              className="hidden"
            />
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center text-white font-bold text-lg shadow-md shrink-0 relative group cursor-pointer overflow-hidden"
              style={{ backgroundColor: avatarUrl ? '#18181b' : selectedColor }}
              onClick={() => fileInputRef.current?.click()}
              title="Upload custom group icon"
            >
              {avatarUrl ? (
                <img src={avatarUrl} alt="Group Icon" className="w-full h-full object-cover" />
              ) : groupName.trim() ? (
                groupName.trim().charAt(0).toUpperCase()
              ) : (
                <Hash className="w-5 h-5" />
              )}
              <div className="absolute inset-0 bg-black/60 rounded-xl opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity text-white">
                <Camera className="w-4 h-4" />
              </div>
            </div>

            <div className="flex-1 min-w-0">
              <input
                type="text"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder="Group Name (e.g. Core Team, Project Alpha)"
                className="w-full px-3 py-1.5 bg-[#141418] border border-[#27272a] rounded-lg text-white placeholder-[#71717a] text-xs focus:outline-none focus:border-white"
                autoFocus
              />
              <div className="flex items-center gap-2 mt-1.5">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="text-[10px] text-blue-400 hover:underline flex items-center gap-1 cursor-pointer"
                >
                  <Upload className="w-3 h-3" />
                  <span>{avatarUrl ? 'Change image' : 'Add custom image'}</span>
                </button>
                {avatarUrl && (
                  <button
                    type="button"
                    onClick={() => {
                      setAvatarUrl(undefined);
                      if (fileInputRef.current) fileInputRef.current.value = '';
                    }}
                    className="text-[10px] text-rose-400 hover:underline cursor-pointer"
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Color Chooser */}
          <div>
            <label className="text-[11px] font-medium text-[#a1a1aa] block mb-2">Group Color</label>
            <div className="flex items-center gap-2 flex-wrap">
              {GROUP_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setSelectedColor(c)}
                  className={`w-7 h-7 rounded-lg transition-transform flex items-center justify-center ${
                    selectedColor === c ? 'scale-110 ring-2 ring-white' : 'opacity-80 hover:opacity-100'
                  }`}
                  style={{ backgroundColor: c }}
                >
                  {selectedColor === c && <Check className="w-3.5 h-3.5 text-white stroke-[3]" />}
                </button>
              ))}
            </div>
          </div>

          {/* Optional Topic */}
          <div>
            <label className="text-[11px] font-medium text-[#a1a1aa] block mb-1">Description (Optional)</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this group about?"
              className="w-full px-3 py-1.5 bg-[#141418] border border-[#27272a] rounded-lg text-white placeholder-[#71717a] text-xs focus:outline-none focus:border-white"
            />
          </div>

          {/* Member Selection */}
          <div className="space-y-2 pt-1">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-medium text-[#a1a1aa]">
                Select Members ({selectedDeviceIds.length}/{contacts.length})
              </label>
              {contacts.length > 0 && (
                <button
                  type="button"
                  onClick={handleSelectAll}
                  className="text-[11px] text-blue-400 hover:text-blue-300 font-medium"
                >
                  {selectedDeviceIds.length === contacts.length ? 'Deselect All' : 'Select All'}
                </button>
              )}
            </div>

            {contacts.length > 3 && (
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[#71717a]" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Filter contacts..."
                  className="w-full pl-8 pr-3 py-1 bg-[#141418] border border-[#27272a] rounded-lg text-xs text-white placeholder-[#71717a] focus:outline-none focus:border-neutral-400"
                />
              </div>
            )}

            {contacts.length === 0 ? (
              <div className="p-4 bg-[#09090b] border border-[#1f1f23] rounded-xl text-center text-[#71717a] text-xs">
                No paired contacts available. Pair with peers first to add them to groups.
              </div>
            ) : (
              <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                {filteredContacts.map((contact) => {
                  const isSelected = selectedDeviceIds.includes(contact.deviceId);
                  return (
                    <button
                      key={contact.deviceId}
                      type="button"
                      onClick={() => toggleSelectMember(contact.deviceId)}
                      className={`w-full flex items-center justify-between p-2.5 rounded-xl border transition-colors text-left ${
                        isSelected
                          ? 'bg-[#18181b] border-blue-500/50 text-white'
                          : 'bg-[#09090b] border-[#1f1f23] text-[#a1a1aa] hover:border-[#27272a] hover:text-white'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div
                          className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-xs font-semibold shrink-0"
                          style={{ backgroundColor: contact.avatarColor || '#3b82f6' }}
                        >
                          {(contact.alias || contact.deviceId.slice(4, 6)).charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium text-white truncate text-xs">
                            {contact.alias || contact.deviceId}
                          </p>
                          <p className="font-mono text-[10px] text-[#71717a] truncate">
                            {contact.deviceId}
                          </p>
                        </div>
                      </div>

                      <div
                        className={`w-5 h-5 rounded-md flex items-center justify-center border transition-colors shrink-0 ${
                          isSelected
                            ? 'bg-blue-600 border-blue-500 text-white'
                            : 'border-[#3f3f46] bg-[#141418]'
                        }`}
                      >
                        {isSelected && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Action Footer */}
          <div className="pt-2">
            <button
              type="submit"
              disabled={isCreating || contacts.length === 0}
              className="w-full py-2.5 bg-white hover:bg-neutral-200 text-black font-semibold rounded-xl text-xs transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <Plus className="w-4 h-4" />
              <span>{isCreating ? 'Creating Group...' : 'Create Group'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
