import React, { useState, useEffect, useRef } from 'react';
import { getOrCreateIdentity } from './crypto/keys';
import { db } from './db/index';
import { soundEngine } from './utils/cyberSoundEngine';
import {
  CallSessionInfo,
  CallType,
  ContactRecord,
  FileRecord,
  FileTransferProgress,
  GroupRecord,
  IdentityRecord,
  MessageRecord,
  RelayServerStats,
  RelayStatus,
} from './types/index';
import { ConnectionState, PeerManager } from './webrtc/peerManager';
import { CallManager } from './webrtc/callManager';
import { CallModal } from './components/CallModal';
import { TerminalHeader } from './components/TerminalHeader';
import { PeerList } from './components/PeerList';
import { ChatView } from './components/ChatView';
import { PairingModal } from './components/PairingModal';
import { SecurityModal } from './components/SecurityModal';
import { DataWipeDialog } from './components/DataWipeDialog';
import { OnboardingModal } from './components/OnboardingModal';
import { ProfileModal } from './components/ProfileModal';
import { SettingsModal } from './components/SettingsModal';
import { ContactDetailsModal } from './components/ContactDetailsModal';
import { GroupCreatorModal } from './components/GroupCreatorModal';
import { GroupDetailsModal } from './components/GroupDetailsModal';

export default function App() {
  const [identity, setIdentity] = useState<IdentityRecord | null>(null);
  const [contacts, setContacts] = useState<ContactRecord[]>([]);
  const [groups, setGroups] = useState<GroupRecord[]>([]);
  const [activeContact, setActiveContact] = useState<ContactRecord | null>(null);
  const [activeGroup, setActiveGroup] = useState<GroupRecord | null>(null);
  const [selectedContactForDetails, setSelectedContactForDetails] = useState<ContactRecord | null>(null);
  const [selectedGroupForDetails, setSelectedGroupForDetails] = useState<GroupRecord | null>(null);
  const [messages, setMessages] = useState<MessageRecord[]>([]);
  const [lastMessagesMap, setLastMessagesMap] = useState<Map<string, MessageRecord>>(new Map());
  const [activeTransfers, setActiveTransfers] = useState<FileTransferProgress[]>([]);
  const [connectionState, setConnectionState] = useState<ConnectionState>('DISCONNECTED');
  const [relayStatus, setRelayStatus] = useState<RelayStatus>('CONNECTING');
  const [relayPingMs, setRelayPingMs] = useState<number | null>(null);
  const [relayStats, setRelayStats] = useState<RelayServerStats | null>(null);
  const [relayErrorReason, setRelayErrorReason] = useState<string | null>(null);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);

  // Call state
  const [callSession, setCallSession] = useState<CallSessionInfo | null>(null);
  const callManagerRef = useRef<CallManager | null>(null);

  // Mobile View Switcher Tab ('peers' vs 'chat')
  const [mobileTab, setMobileTab] = useState<'peers' | 'chat'>('peers');

  // Modals
  const [isPairingOpen, setIsPairingOpen] = useState(false);
  const [initialPairCode, setInitialPairCode] = useState<string | undefined>(undefined);
  const [isSecurityOpen, setIsSecurityOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isWipeOpen, setIsWipeOpen] = useState(false);
  const [isGroupCreatorOpen, setIsGroupCreatorOpen] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);

  // Check URL params for direct pairing link (e.g. ?room=ABC123)
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const roomParam = params.get('room');
      if (roomParam && /^[A-Z0-9]{6}$/i.test(roomParam.trim())) {
        setInitialPairCode(roomParam.trim().toUpperCase());
        setIsPairingOpen(true);
        window.history.replaceState({}, '', window.location.pathname);
      }
    } catch {}
  }, []);

  // Peer Manager ref
  const peerManagerRef = useRef<PeerManager | null>(null);
  const activeChatKeyRef = useRef<string | null>(null);
  const pendingCallSignalsRef = useRef<any[]>([]);

  // Initialize Identity & Load Contacts
  useEffect(() => {
    let isMounted = true;

    async function init() {
      try {
        const idRecord = await getOrCreateIdentity();
        if (!isMounted) return;
        setIdentity(idRecord);

        // If user has not set a display name yet, show onboarding
        if (!idRecord.displayName || idRecord.displayName.trim() === '') {
          setShowOnboarding(true);
        }

        // Load contacts
        const loadedContacts = await db.contacts.toArray();
        setContacts(loadedContacts);
        const loadedGroups = await db.groups.toArray();
        setGroups(loadedGroups);
        if (loadedContacts.length > 0 && loadedGroups.length === 0) {
          setActiveContact(loadedContacts[0]);
          activeChatKeyRef.current = loadedContacts[0].deviceId;
        }

        // Load all latest messages for sidebar previews
        await reloadLastMessages();

        // Initialize Peer Manager
        const pm = new PeerManager(idRecord, {
          onStateChange: (state) => {
            setConnectionState(state);
            if (state === 'CONNECTED') {
              setMobileTab('chat');
            }
          },
          onRelayStatusChange: (status, stats, pingMs, errorReason) => {
            setRelayStatus(status);
            if (stats !== undefined) setRelayStats(stats || null);
            setRelayPingMs(pingMs !== undefined ? pingMs : null);
            setRelayErrorReason(errorReason || null);
          },
          onContactsPresencesUpdate: async () => {
            const updated = await db.contacts.toArray();
            setContacts(updated);
            setActiveContact((curr) => {
              if (!curr) return null;
              const found = updated.find((c) => c.deviceId === curr.deviceId);
              return found || curr;
            });
          },
          onMessageReceived: async (msg) => {
            soundEngine.playMessageReceived();
            if (activeChatKeyRef.current === msg.chatDeviceId) {
              setMessages((prev) =>
                prev.some((existing) =>
                  (msg.messageId && existing.messageId === msg.messageId) ||
                  (msg.id !== undefined && existing.id === msg.id)
                )
                  ? prev
                  : [...prev, msg]
              );
            }
            await reloadLastMessages();
          },
          onFileProgress: (progress) => {
            setActiveTransfers((prev) => {
              const idx = prev.findIndex((p) => p.fileId === progress.fileId);
              if (idx >= 0) {
                const next = [...prev];
                next[idx] = progress;
                return next;
              }
              return [...prev, progress];
            });
          },
          onFileCompleted: async () => {
            await refreshContacts();
            await reloadLastMessages();
          },
          onMediaSignal: (signal) => {
            if (callManagerRef.current) {
              callManagerRef.current.handleCallSignal(signal).catch((err) => {
                console.warn('Call signal handling error:', err);
              });
            } else {
              pendingCallSignalsRef.current.push(signal);
            }
          },
          onPeerInfo: (contact) => {
            setActiveContact(contact);
            refreshContacts();
          },
          onError: (err) => {
            console.error('Peer error:', err);
          },
          onLatencyUpdate: (ms) => {
            setLatencyMs(ms);
          },
        });

        peerManagerRef.current = pm;

        // Initialize Call Manager
        const cm = new CallManager(pm, idRecord, {
          onCallStateChange: (session) => {
            setCallSession(session ? { ...session } : null);
          },
          onLocalStream: () => {
            setCallSession((current) => current ? { ...current } : current);
          },
          onRemoteStream: () => {
            setCallSession((current) => current ? { ...current } : current);
          },
          onError: (errMsg) => {
            console.warn('Call error:', errMsg);
          },
        });
        callManagerRef.current = cm;
        const pendingSignals = pendingCallSignalsRef.current.splice(0);
        for (const signal of pendingSignals) {
          await cm.handleCallSignal(signal);
        }
      } catch (err) {
        console.error('Initialization error:', err);
      }
    }

    init();

    return () => {
      isMounted = false;
      callManagerRef.current?.destroy();
      peerManagerRef.current?.destroy();
    };
  }, []);

  const reloadLastMessages = async () => {
    const allMsgs = await db.messages.orderBy('timestamp').toArray();
    const map = new Map<string, MessageRecord>();
    for (const msg of allMsgs) {
      map.set(msg.chatDeviceId, msg);
    }
    setLastMessagesMap(map);
  };

  // Reload messages when activeContact changes
  useEffect(() => {
    async function loadMessages() {
      const chatKey = activeGroup?.groupId || activeContact?.deviceId || null;
      activeChatKeyRef.current = chatKey;
      if (!chatKey) {
        setMessages([]);
        return;
      }
      const msgs = await db.messages
        .where('chatDeviceId')
        .equals(chatKey)
        .sortBy('timestamp');
      setMessages(msgs);
    }
    loadMessages();
  }, [activeContact, activeGroup]);

  const refreshContacts = async () => {
    const list = await db.contacts.toArray();
    setContacts(list);
    await reloadLastMessages();
  };

  const handleSelectPeer = (contact: ContactRecord) => {
    setActiveContact(contact);
    setActiveGroup(null);
    activeChatKeyRef.current = contact.deviceId;
    setMobileTab('chat');
  };

  const handleSelectGroup = (group: GroupRecord) => {
    setActiveGroup(group);
    setActiveContact(null);
    activeChatKeyRef.current = group.groupId;
    setMobileTab('chat');
  };

  const handleDeleteContact = async (deviceId: string) => {
    await db.contacts.delete(deviceId);
    await db.messages.where('chatDeviceId').equals(deviceId).delete();
    const updated = contacts.filter((c) => c.deviceId !== deviceId);
    setContacts(updated);
    if (activeContact?.deviceId === deviceId) {
      setActiveContact(updated[0] || null);
    }
    if (selectedContactForDetails?.deviceId === deviceId) {
      setSelectedContactForDetails(null);
    }
    await reloadLastMessages();
  };

  const handleClearHistory = async (deviceId: string) => {
    await db.messages.where('chatDeviceId').equals(deviceId).delete();
    if (activeContact?.deviceId === deviceId) {
      setMessages([]);
    }
    await reloadLastMessages();
  };

  const handleUpdateContactAlias = async (deviceId: string, newAlias: string) => {
    await db.contacts.update(deviceId, { alias: newAlias });
    await refreshContacts();
    if (activeContact?.deviceId === deviceId) {
      setActiveContact((prev) => (prev ? { ...prev, alias: newAlias } : null));
    }
    if (selectedContactForDetails?.deviceId === deviceId) {
      setSelectedContactForDetails((prev) => (prev ? { ...prev, alias: newAlias } : null));
    }
  };

  const handleToggleVerifyContact = async (deviceId: string, verified: boolean) => {
    const status = verified ? 'VERIFIED' : 'UNVERIFIED';
    await db.contacts.update(deviceId, { verificationStatus: status });
    await refreshContacts();
    if (activeContact?.deviceId === deviceId) {
      setActiveContact((prev) => (prev ? { ...prev, verificationStatus: status } : null));
    }
    if (selectedContactForDetails?.deviceId === deviceId) {
      setSelectedContactForDetails((prev) => (prev ? { ...prev, verificationStatus: status } : null));
    }
  };

  const handleSendMessage = async (
    text: string,
    options?: { codeSnippet?: any; isGroup?: boolean; groupId?: string }
  ) => {
    if (!peerManagerRef.current) return;
    if (activeGroup) {
      const messageId = await peerManagerRef.current.sendGroupTextMessage(text, activeGroup);
      const msg: MessageRecord = {
        messageId,
        chatDeviceId: activeGroup.groupId,
        groupId: activeGroup.groupId,
        isGroup: true,
        senderDeviceId: identity?.deviceId,
        senderDisplayName: identity?.displayName || 'You',
        senderAvatarColor: identity?.avatarColor,
        direction: 'OUTBOUND',
        payloadText: text,
        mediaType: 'text',
        codeSnippet: options?.codeSnippet,
        ...(options?.codeSnippet ? { mediaType: 'code' as const } : {}),
        timestamp: Date.now(),
        status: 'delivered',
      };
      const id = await db.messages.add(msg);
      msg.id = id;
      setMessages((prev) => [...prev, msg]);
      await reloadLastMessages();
      return;
    }
    if (!activeContact) return;
    const msg = await peerManagerRef.current.sendTextMessage(text, activeContact.deviceId);
    soundEngine.playMessageSent();
    setMessages((prev) => [...prev, msg]);
    await reloadLastMessages();
  };

  const handleSendFile = async (
    file: File,
    options?: { isGroup?: boolean; groupId?: string }
  ) => {
    if (!peerManagerRef.current) return;
    soundEngine.playActionPing();
    if (activeGroup) {
      const result = await peerManagerRef.current.sendGroupFile(file, activeGroup);
      const msg: MessageRecord = {
        messageId: result.messageId,
        chatDeviceId: activeGroup.groupId,
        groupId: activeGroup.groupId,
        isGroup: true,
        senderDeviceId: identity?.deviceId,
        senderDisplayName: identity?.displayName || 'You',
        senderAvatarColor: identity?.avatarColor,
        direction: 'OUTBOUND',
        payloadText: file.name,
        fileId: result.fileRecord.fileId,
        fileRecord: result.fileRecord,
        mediaType: result.fileRecord.isImage
          ? 'image'
          : result.fileRecord.isAudio
          ? 'audio'
          : result.fileRecord.isVideo
          ? 'video'
          : 'file',
        timestamp: Date.now(),
        status: 'delivered',
      };
      const id = await db.messages.add(msg);
      msg.id = id;
      setMessages((prev) => [...prev, msg]);
      await reloadLastMessages();
      return;
    }
    if (!activeContact) return;
    await peerManagerRef.current.sendFile(file, activeContact.deviceId);
    await reloadLastMessages();
  };

  const handleUpdateGroup = (updated: GroupRecord) => {
    setGroups((prev) => prev.map((group) => group.groupId === updated.groupId ? updated : group));
    setActiveGroup((current) => current?.groupId === updated.groupId ? updated : current);
    setSelectedGroupForDetails((current) => current?.groupId === updated.groupId ? updated : current);
  };

  const handleDeleteGroup = async (groupId: string) => {
    await db.messages.where('chatDeviceId').equals(groupId).delete();
    setGroups((prev) => prev.filter((group) => group.groupId !== groupId));
    if (activeGroup?.groupId === groupId) {
      const nextContact = contacts[0] || null;
      setActiveGroup(null);
      setActiveContact(nextContact);
      activeChatKeyRef.current = nextContact?.deviceId || null;
    }
    setSelectedGroupForDetails(null);
    await reloadLastMessages();
  };

  const handleGroupCreated = (group: GroupRecord) => {
    setGroups((prev) => [...prev, group]);
    handleSelectGroup(group);
  };

  const handleOnboardingComplete = (updatedId: IdentityRecord) => {
    setIdentity(updatedId);
    setShowOnboarding(false);
    if (peerManagerRef.current) {
      peerManagerRef.current.updateIdentity(updatedId);
    }
  };

  const handleProfileUpdate = (updatedId: IdentityRecord) => {
    setIdentity(updatedId);
    if (peerManagerRef.current) {
      peerManagerRef.current.updateIdentity(updatedId);
    }
  };

  const handleStartCall = async (
    peerDeviceId: string,
    peerDisplayName: string,
    callType: CallType
  ) => {
    if (!callManagerRef.current) return;
    try {
      await callManagerRef.current.startCall(peerDeviceId, peerDisplayName, callType);
    } catch (err: any) {
      console.error('Failed to start call:', err);
    }
  };

  return (
    <div className="h-screen w-screen flex flex-col bg-[#09090b] text-[#f4f4f5] overflow-hidden select-none font-sans">
      {/* Top Header Bar */}
      <TerminalHeader
        identity={identity}
        connectionState={connectionState}
        relayStatus={relayStatus}
        relayPingMs={relayPingMs}
        relayErrorReason={relayErrorReason}
        activeContact={activeContact}
        latencyMs={latencyMs}
        currentMobileTab={mobileTab}
        onMobileTabChange={setMobileTab}
        onOpenPairing={() => setIsPairingOpen(true)}
        onOpenSecurity={() => setIsSecurityOpen(true)}
        onOpenProfile={() => setIsProfileOpen(true)}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onOpenWipe={() => setIsWipeOpen(true)}
      />

      {/* Main Workspace Layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Desktop: Dual-Pane Master-Detail */}
        <div className="hidden md:flex flex-1 overflow-hidden">
          <PeerList
            contacts={contacts}
            groups={groups}
            activeContactId={activeContact?.deviceId || null}
            activeGroupId={activeGroup?.groupId || null}
            connectedPeerId={
              connectionState === 'CONNECTED' ? activeContact?.deviceId || null : null
            }
            lastMessages={lastMessagesMap}
            onSelectPeer={handleSelectPeer}
            onSelectGroup={handleSelectGroup}
            onOpenPairing={() => setIsPairingOpen(true)}
            onOpenGroupCreator={() => setIsGroupCreatorOpen(true)}
            onOpenContactDetails={(contact) => setSelectedContactForDetails(contact)}
            onOpenGroupDetails={(group) => setSelectedGroupForDetails(group)}
          />
          <ChatView
            activeContact={activeContact}
            activeGroup={activeGroup}
            messages={messages}
            activeTransfers={activeTransfers}
            isConnected={connectionState === 'CONNECTED'}
            latencyMs={latencyMs || undefined}
            peerManager={peerManagerRef.current}
            onSendMessage={handleSendMessage}
            onSendFile={handleSendFile}
            onStartCall={handleStartCall}
            onVerifyContact={() => setIsSecurityOpen(true)}
          />
        </div>

        {/* Mobile: Single-View Navigation */}
        <div className="flex md:hidden flex-1 overflow-hidden">
          {mobileTab === 'peers' ? (
            <PeerList
              contacts={contacts}
              groups={groups}
              activeContactId={activeContact?.deviceId || null}
              activeGroupId={activeGroup?.groupId || null}
              connectedPeerId={
                connectionState === 'CONNECTED' ? activeContact?.deviceId || null : null
              }
              lastMessages={lastMessagesMap}
              onSelectPeer={handleSelectPeer}
              onSelectGroup={handleSelectGroup}
              onOpenPairing={() => setIsPairingOpen(true)}
              onOpenGroupCreator={() => setIsGroupCreatorOpen(true)}
              onOpenContactDetails={(contact) => setSelectedContactForDetails(contact)}
              onOpenGroupDetails={(group) => setSelectedGroupForDetails(group)}
            />
          ) : (
            <ChatView
              activeContact={activeContact}
              activeGroup={activeGroup}
              messages={messages}
              activeTransfers={activeTransfers}
              isConnected={connectionState === 'CONNECTED'}
              latencyMs={latencyMs || undefined}
              peerManager={peerManagerRef.current}
              onSendMessage={handleSendMessage}
              onSendFile={handleSendFile}
              onStartCall={handleStartCall}
              onBackToPeers={() => setMobileTab('peers')}
              onVerifyContact={() => setIsSecurityOpen(true)}
            />
          )}
        </div>
      </div>

      {/* Contact Details & Options Modal */}
      {selectedContactForDetails && (
        <ContactDetailsModal
          isOpen={!!selectedContactForDetails}
          contact={selectedContactForDetails}
          isConnected={
            connectionState === 'CONNECTED' &&
            activeContact?.deviceId === selectedContactForDetails.deviceId
          }
          onClose={() => setSelectedContactForDetails(null)}
          onStartChat={(contact) => {
            handleSelectPeer(contact);
            setSelectedContactForDetails(null);
          }}
          onDeleteContact={handleDeleteContact}
          onClearHistory={handleClearHistory}
          onUpdateAlias={handleUpdateContactAlias}
          onToggleVerify={handleToggleVerifyContact}
          onStartCall={(deviceId, alias, type) => {
            handleStartCall(deviceId, alias, type);
            setSelectedContactForDetails(null);
          }}
        />
      )}

      <GroupCreatorModal
        isOpen={isGroupCreatorOpen}
        identity={identity}
        contacts={contacts}
        onClose={() => setIsGroupCreatorOpen(false)}
        onGroupCreated={handleGroupCreated}
      />

      <GroupDetailsModal
        isOpen={!!selectedGroupForDetails}
        group={selectedGroupForDetails}
        identity={identity}
        contacts={contacts}
        onClose={() => setSelectedGroupForDetails(null)}
        onUpdateGroup={handleUpdateGroup}
        onDeleteGroup={handleDeleteGroup}
      />

      {/* Call Modal (Audio & Video E2EE) */}
      {callSession && callManagerRef.current && (
        <CallModal
          session={callSession}
          callManager={callManagerRef.current}
        />
      )}

      {/* Onboarding Welcome Screen (Only on first visit) */}
      {showOnboarding && identity && (
        <OnboardingModal
          identity={identity}
          onComplete={handleOnboardingComplete}
        />
      )}

      {/* Pairing Modal (Dynamic QR / OTP) */}
      {peerManagerRef.current && (
        <PairingModal
          isOpen={isPairingOpen}
          peerManager={peerManagerRef.current}
          initialCode={initialPairCode}
          onClose={() => {
            setIsPairingOpen(false);
            setInitialPairCode(undefined);
          }}
          onPairSuccess={async () => {
            await refreshContacts();
            setMobileTab('chat');
          }}
        />
      )}

      {/* Profile Modal */}
      <ProfileModal
        isOpen={isProfileOpen}
        identity={identity}
        onClose={() => setIsProfileOpen(false)}
        onUpdate={handleProfileUpdate}
      />

      {/* Global Application Settings Modal */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        relayStatus={relayStatus}
        relayPingMs={relayPingMs}
      />

      {/* Cryptographic Security Modal */}
      <SecurityModal
        isOpen={isSecurityOpen}
        identity={identity}
        activeContact={activeContact}
        onClose={() => setIsSecurityOpen(false)}
        onContactUpdated={refreshContacts}
      />

      {/* Local Vault Wipe Dialog */}
      <DataWipeDialog
        isOpen={isWipeOpen}
        onClose={() => setIsWipeOpen(false)}
        onWipeCompleted={() => {
          peerManagerRef.current?.cleanup();
        }}
      />
    </div>
  );
}
