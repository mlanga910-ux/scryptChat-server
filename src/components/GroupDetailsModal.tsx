import React, { useState, useRef } from 'react';
import { ContactRecord, GroupRecord, IdentityRecord } from '../types/index';
import { db } from '../db/index';
import {
  X,
  Users,
  Phone,
  Video,
  UserPlus,
  Trash2,
  LogOut,
  Crown,
  Check,
  Shield,
  Search,
  Camera,
  Upload,
} from 'lucide-react';
import { fileToAvatarDataUrl } from '../utils/imageHelper';

interface GroupDetailsModalProps {
  isOpen: boolean;
  group: GroupRecord | null;
  identity: IdentityRecord | null;
  contacts: ContactRecord[];
  onClose: () => void;
  onUpdateGroup: (updated: GroupRecord) => void;
  onDeleteGroup: (groupId: string) => void;
  onStartGroupCall?: (group: GroupRecord, type: 'audio' | 'video') => void;
}

export const GroupDetailsModal: React.FC<GroupDetailsModalProps> = ({
  isOpen,
  group,
  identity,
  contacts,
  onClose,
  onUpdateGroup,
  onDeleteGroup,
  onStartGroupCall,
}) => {
  const [isAddingMembers, setIsAddingMembers] = useState(false);
  const [selectedToAdd, setSelectedToAdd] = useState<string[]>([]);
  const [searchMemberQuery, setSearchMemberQuery] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen || !group || !identity) return null;

  const isAdmin = group.adminDeviceId === identity.deviceId;
  const nonMemberContacts = contacts.filter((c) => !group.memberDeviceIds.includes(c.deviceId));

  const handleAvatarFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await fileToAvatarDataUrl(file);
      const updated: GroupRecord = {
        ...group,
        avatarUrl: dataUrl,
        lastActivityAt: Date.now(),
      };
      await db.groups.put(updated);
      onUpdateGroup(updated);
    } catch (err) {
      console.error('Error updating group icon:', err);
    }
  };

  const handleRemoveAvatar = async () => {
    const updated: GroupRecord = {
      ...group,
      avatarUrl: undefined,
      lastActivityAt: Date.now(),
    };
    await db.groups.put(updated);
    onUpdateGroup(updated);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleAddMembers = async () => {
    if (selectedToAdd.length === 0) return;
    const updatedMembers = Array.from(new Set([...group.memberDeviceIds, ...selectedToAdd]));
    const updated: GroupRecord = {
      ...group,
      memberDeviceIds: updatedMembers,
      lastActivityAt: Date.now(),
    };
    await db.groups.put(updated);
    onUpdateGroup(updated);
    setSelectedToAdd([]);
    setIsAddingMembers(false);
  };

  const handleRemoveMember = async (memberDeviceId: string) => {
    if (!isAdmin) return;
    const updatedMembers = group.memberDeviceIds.filter((id) => id !== memberDeviceId);
    const updated: GroupRecord = {
      ...group,
      memberDeviceIds: updatedMembers,
      lastActivityAt: Date.now(),
    };
    await db.groups.put(updated);
    onUpdateGroup(updated);
  };

  const handleLeaveGroup = async () => {
    const updatedMembers = group.memberDeviceIds.filter((id) => id !== identity.deviceId);
    if (updatedMembers.length === 0) {
      await db.groups.delete(group.groupId);
      onDeleteGroup(group.groupId);
    } else {
      const newAdmin = isAdmin ? updatedMembers[0] : group.adminDeviceId;
      const updated: GroupRecord = {
        ...group,
        adminDeviceId: newAdmin,
        memberDeviceIds: updatedMembers,
      };
      await db.groups.put(updated);
      onUpdateGroup(updated);
    }
    onClose();
  };

  const handleDeleteGroup = async () => {
    await db.groups.delete(group.groupId);
    onDeleteGroup(group.groupId);
    onClose();
  };

  return (
    <div
      id="group-details-modal-backdrop"
      className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 select-none font-sans text-xs animate-in fade-in duration-150"
    >
      <div className="w-full max-w-md h-[580px] max-h-[92vh] bg-[#0c0c0e] border border-[#27272a] rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-[#1f1f23] bg-[#09090b] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 text-xs font-semibold text-[#a1a1aa] uppercase tracking-wider">
            <span>Group Information</span>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-[#71717a] hover:text-white hover:bg-[#18181b] rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Group Profile Header */}
          <div className="flex flex-col items-center text-center space-y-2">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleAvatarFileSelect}
              accept="image/*"
              className="hidden"
            />
            <div
              className={`w-16 h-16 rounded-2xl flex items-center justify-center text-white text-2xl font-bold shadow-lg overflow-hidden relative ${
                isAdmin ? 'cursor-pointer group' : ''
              }`}
              style={{ backgroundColor: group.avatarUrl ? '#18181b' : (group.avatarColor || '#2563eb') }}
              onClick={() => isAdmin && fileInputRef.current?.click()}
              title={isAdmin ? 'Change Group Image' : undefined}
            >
              {group.avatarUrl ? (
                <img src={group.avatarUrl} alt={group.name} className="w-full h-full object-cover" />
              ) : (
                group.name.charAt(0).toUpperCase()
              )}
              {isAdmin && (
                <div className="absolute inset-0 bg-black/60 rounded-2xl opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity text-white">
                  <Camera className="w-5 h-5" />
                </div>
              )}
            </div>

            {isAdmin && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="text-[11px] text-blue-400 hover:underline flex items-center gap-1 cursor-pointer"
                >
                  <Upload className="w-3 h-3" />
                  <span>{group.avatarUrl ? 'Change Photo' : 'Upload Photo'}</span>
                </button>
                {group.avatarUrl && (
                  <button
                    type="button"
                    onClick={handleRemoveAvatar}
                    className="text-[11px] text-rose-400 hover:underline cursor-pointer"
                  >
                    Remove
                  </button>
                )}
              </div>
            )}

            <h3 className="text-base font-semibold text-white">{group.name}</h3>
            {group.description && (
              <p className="text-xs text-[#a1a1aa] max-w-xs">{group.description}</p>
            )}
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-mono bg-[#18181b] border border-[#27272a] text-[#71717a]">
              <span>{group.memberDeviceIds.length} Members</span>
            </div>
          </div>

          {/* Quick Call Actions */}
          <div className="grid grid-cols-2 gap-2.5">
            <button
              onClick={() => onStartGroupCall?.(group, 'audio')}
              className="flex items-center justify-center gap-2 p-3 bg-[#141418] hover:bg-[#1c1c22] border border-[#27272a] rounded-xl text-white font-medium transition-colors"
            >
              <Phone className="w-4 h-4 text-emerald-400" />
              <span>Group Voice</span>
            </button>
            <button
              onClick={() => onStartGroupCall?.(group, 'video')}
              className="flex items-center justify-center gap-2 p-3 bg-[#141418] hover:bg-[#1c1c22] border border-[#27272a] rounded-xl text-white font-medium transition-colors"
            >
              <Video className="w-4 h-4 text-blue-400" />
              <span>Group Video</span>
            </button>
          </div>

          {/* Members List */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-[#a1a1aa] uppercase tracking-wider">
                Members ({group.memberDeviceIds.length})
              </span>
              {isAdmin && nonMemberContacts.length > 0 && (
                <button
                  onClick={() => setIsAddingMembers(!isAddingMembers)}
                  className="flex items-center gap-1 text-[11px] text-blue-400 hover:text-blue-300 font-medium"
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  <span>{isAddingMembers ? 'Cancel' : 'Add Members'}</span>
                </button>
              )}
            </div>

            {/* Add Member Multi-select Drawer */}
            {isAddingMembers && (
              <div className="p-3 bg-[#09090b] border border-[#27272a] rounded-xl space-y-2.5">
                <span className="text-[11px] text-[#a1a1aa] block">Select contacts to add:</span>
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {nonMemberContacts.map((c) => {
                    const isChecked = selectedToAdd.includes(c.deviceId);
                    return (
                      <button
                        key={c.deviceId}
                        onClick={() => {
                          if (isChecked) {
                            setSelectedToAdd(selectedToAdd.filter((id) => id !== c.deviceId));
                          } else {
                            setSelectedToAdd([...selectedToAdd, c.deviceId]);
                          }
                        }}
                        className={`w-full flex items-center justify-between p-2 rounded-lg text-left text-xs transition-colors ${
                          isChecked ? 'bg-[#18181b] text-white' : 'text-[#a1a1aa] hover:bg-[#141418]'
                        }`}
                      >
                        <span>{c.alias || c.deviceId}</span>
                        {isChecked && <Check className="w-3.5 h-3.5 text-blue-400" />}
                      </button>
                    );
                  })}
                </div>
                <button
                  onClick={handleAddMembers}
                  disabled={selectedToAdd.length === 0}
                  className="w-full py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold disabled:opacity-50 transition-colors"
                >
                  Add Selected ({selectedToAdd.length})
                </button>
              </div>
            )}

            {/* Existing Members */}
            <div className="space-y-1.5">
              {group.memberDeviceIds.map((memberId) => {
                const isMe = memberId === identity.deviceId;
                const contact = contacts.find((c) => c.deviceId === memberId);
                const displayName = isMe
                  ? `${identity.displayName || 'You'} (You)`
                  : contact?.alias || memberId;
                const isMemberAdmin = memberId === group.adminDeviceId;

                return (
                  <div
                    key={memberId}
                    className="flex items-center justify-between p-2.5 bg-[#141418] border border-[#1f1f23] rounded-xl"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div
                        className="w-7 h-7 rounded-lg flex items-center justify-center text-white text-xs font-semibold shrink-0"
                        style={{
                          backgroundColor: isMe
                            ? identity.avatarColor || '#2563eb'
                            : contact?.avatarColor || '#3b82f6',
                        }}
                      >
                        {displayName.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-white font-medium truncate text-xs">
                            {displayName}
                          </span>
                          {isMemberAdmin && (
                            <span title="Group Admin" className="shrink-0 inline-flex items-center">
                              <Crown className="w-3 h-3 text-amber-400" />
                            </span>
                          )}
                        </div>
                        <p className="font-mono text-[10px] text-[#71717a] truncate">
                          {memberId}
                        </p>
                      </div>
                    </div>

                    {isAdmin && !isMe && (
                      <button
                        onClick={() => handleRemoveMember(memberId)}
                        className="text-[#71717a] hover:text-rose-400 p-1 transition-colors"
                        title="Remove member"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Danger Zone */}
          <div className="pt-2 border-t border-[#1f1f23] space-y-2">
            <button
              onClick={handleLeaveGroup}
              className="w-full flex items-center justify-center gap-2 p-2.5 bg-[#18181b] hover:bg-rose-950/30 text-rose-300 border border-[#27272a] hover:border-rose-900/50 rounded-xl transition-colors font-medium text-xs"
            >
              <LogOut className="w-4 h-4" />
              <span>Leave Group</span>
            </button>

            {isAdmin && (
              <button
                onClick={handleDeleteGroup}
                className="w-full flex items-center justify-center gap-2 p-2.5 bg-rose-950/20 hover:bg-rose-950/50 text-rose-400 border border-rose-900/40 rounded-xl transition-colors font-medium text-xs"
              >
                <Trash2 className="w-4 h-4" />
                <span>Delete Group</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
