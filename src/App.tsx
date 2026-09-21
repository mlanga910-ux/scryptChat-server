import React, { useState, useEffect, useRef } from 'react';
import { getOrCreateIdentity, hasWebCrypto, resetIdentityBootstrap } from './crypto/keys';
import { db, describeStorage, initDatabase, StorageDriverName } from './db/index';
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
  RelayStatus,
} from './types/index';
import { ConnectionState, PeerManager } from './webrtc/peerManager';
import { CallManager } from './webrtc/callManager';
import { CallModal } from './components/CallModal';
import { TerminalHeader } from './components/TerminalHeader';
import { ScryptChatLogo } from './components/ScryptChatLogo';
import { PeerList } from './components/PeerList';
import { ChatView } from './components/ChatView';
import { mergeMessageRow } from './utils/messageMerge';
import { PairingModal } from './components/PairingModal';
import { DataWipeDialog } from './components/DataWipeDialog';
import { OnboardingModal } from './components/OnboardingModal';
import { SettingsModal } from './components/SettingsModal';
import { ProfileModal } from './components/ProfileModal';
import { AboutModal, APP_INFO } from './components/AboutModal';
import { ContactDetailsModal } from './components/ContactDetailsModal';
import { GroupCreatorModal } from './components/GroupCreatorModal';
import { GroupDetailsModal } from './components/GroupDetailsModal';

// Marks that this device has completed the first-run welcome setup.
// Bumping the version re-shows the welcome screen once after an upgrade.
const ONBOARDING_FLAG = 'scryptchat_onboarding_v2';

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
  const [relayErrorReason, setRelayErrorReason] = useState<string | null>(null);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  // Contacts currently composing a message, keyed by device id.
  const [typingPeers, setTypingPeers] = useState<Record<string, boolean>>({});
  const typingTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // Call state
  const [callSession, setCallSession] = useState<CallSessionInfo | null>(null);
  const callManagerRef = useRef<CallManager | null>(null);

  // Mobile View Switcher Tab ('peers' vs 'chat')
  const [mobileTab, setMobileTab] = useState<'peers' | 'chat'>('peers');

  // Modals
  const [isPairingOpen, setIsPairingOpen] = useState(false);
  const [initialPairCode, setInitialPairCode] = useState<string | undefined>(undefined);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isAboutOpen, setIsAboutOpen] = useState(false);
  const [isWipeOpen, setIsWipeOpen] = useState(false);
  const [isGroupCreatorOpen, setIsGroupCreatorOpen] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);

  // The signaling client lives in React state (not only a ref) so every screen
  // that talks to it - pairing, chat, calls - mounts even if the relay is slow.
  const [peerManager, setPeerManager] = useState<PeerManager | null>(null);
  const [bootAttempt, setBootAttempt] = useState(0);
  const [bootError, setBootError] = useState<string | null>(null);
  const [storageDriver, setStorageDriver] = useState<StorageDriverName | null>(null);
  const [secureContext, setSecureContext] = useState(true);
  // Contact currently reachable over the local network (host-to-host ICE route).
  const [lanPeerId, setLanPeerId] = useState<string | null>(null);

  // Check URL params for direct pairing link (e.g. ?room=ABC123)
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const roomParam = params.get('room');
      if (roomParam && /^[A-Z0-9]{6}$/i.test(roomParam.trim())) {
        const code = roomParam.trim().toUpperCase();
        setInitialPairCode(code);
        setIsPairingOpen(true);
        window.history.replaceState({}, '', window.location.pathname);
      }
    } catch {}
  }, []);

  // Peer Manager ref
  const peerManagerRef = useRef<PeerManager | null>(null);
  const activeChatKeyRef = useRef<string | null>(null);
  /** Mirror of the contact list so event handlers never read a stale closure. */
  const contactsRef = useRef<ContactRecord[]>([]);
  const pendingCallSignalsRef = useRef<any[]>([]);

  // Initialize identity, the local vault and the signaling client. Every step
  // is isolated so a failure in one never makes the rest of the app unusable.
  useEffect(() => {
    let isMounted = true;

    async function init() {
      setBootError(null);

      // 0. Resolve a storage backend that works on this device. Never rejects:
      //    it degrades from IndexedDB to localStorage to session memory.
      const driver = await initDatabase().catch(() => null);
      if (!isMounted) return;
      setStorageDriver(driver);
      setSecureContext(hasWebCrypto());

      // 1. Local identity. Keys need WebCrypto, everything else does not.
      let idRecord: IdentityRecord | null = null;
      try {
        idRecord = await getOrCreateIdentity();
      } catch (err) {
        console.error('Identity bootstrap error:', err);
      }
      if (!isMounted) return;
      setIdentity(idRecord);

      if (idRecord) {
        // First time this device is opened (or right after a data wipe): show
        // the welcome page before unlocking the chat workspace.
        let onboardingDone = false;
        try {
          onboardingDone = localStorage.getItem(ONBOARDING_FLAG) === 'true';
        } catch {}
        const hasName = !!idRecord.displayName && idRecord.displayName.trim() !== '';
        if (!onboardingDone || !hasName) {
          setShowOnboarding(true);
        }
      } else {
        setBootError('scryptChat could not start on this browser. Reload the page to try again.');
        return;
      }

      // 2. Local vault: contacts, groups and history are read straight from
      // this device and never depend on a signaling server.
      try {
        const loadedContacts = await db.contacts.toArray();
        const loadedGroups = await db.groups.toArray();
        if (!isMounted) return;
        contactsRef.current = loadedContacts;
        setContacts(loadedContacts);
        setGroups(loadedGroups);
        if (loadedContacts.length > 0 && loadedGroups.length === 0) {
          setActiveContact(loadedContacts[0]);
          activeChatKeyRef.current = loadedContacts[0].deviceId;
        }
        await reloadLastMessages();
      } catch (err) {
        console.warn('Local vault load error:', err);
      }

      if (!isMounted) return;

      // 3. Signaling client. If it cannot start, the app still runs locally.
      try {
        // Initialize Peer Manager
        const pm = new PeerManager(idRecord, {
          onStateChange: (state) => {
            setConnectionState(state);
            if (state === 'CONNECTED') {
              setMobileTab('chat');
            }
          },
          onRelayStatusChange: (status, _stats, pingMs, errorReason) => {
            setRelayStatus(status);
            setRelayPingMs(pingMs !== undefined ? pingMs : null);
            setRelayErrorReason(errorReason || null);
          },
          onContactsPresencesUpdate: async () => {
            const updated = await db.contacts.toArray();
            contactsRef.current = updated;
            setContacts(updated);
            // Every view (header, list, details) reads the same fresh record so a
            // contact's photo can never differ from screen to screen.
            const pick = (deviceId?: string) =>
              updated.find((c) => c.deviceId === deviceId) || null;
            setActiveContact((curr) => (curr ? pick(curr.deviceId) : null));
            setSelectedContactForDetails((curr) => (curr ? pick(curr.deviceId) : null));
            await reloadLastMessages();
          },
          onTransportUpdate: ({ deviceId, transport }) => {
            setLanPeerId(transport === 'lan' ? deviceId : null);
          },
          onMessageReceived: async (msg) => {
            soundEngine.playMessageReceived();
            const isActiveChat = activeChatKeyRef.current === msg.chatDeviceId;
            if (isActiveChat) {
              // Merge, never ignore. An attachment is announced first and its
              // bytes land a moment later: the same message id comes back with
              // the complete record. Dropping that update (the old behaviour)
              // left the bubble on its loading placeholder for good.
              setMessages((prev) => mergeMessageRow(prev, msg));
            }
            updateLastMessageFor(msg);
            // A brand new sender may not be in the sidebar yet.
            if (!contactsRef.current.some((c) => c.deviceId === msg.chatDeviceId)) {
              const updated = await db.contacts.toArray();
              contactsRef.current = updated;
              setContacts(updated);
            }
            if (isActiveChat) {
              // The chat is on screen, so the peer can see that it was read.
              acknowledgeVisibleMessages(msg.chatDeviceId, [msg], !!msg.isGroup);
            }
          },
          onMessageStatusChange: (messageId, status, chatDeviceId) => {
            setMessages((prev) =>
              prev.some((m) => m.messageId === messageId)
                ? prev.map((m) => (m.messageId === messageId ? { ...m, status } : m))
                : prev
            );
            setLastMessagesMap((prev) => {
              const current = prev.get(chatDeviceId);
              if (!current || current.messageId !== messageId) return prev;
              const next = new Map(prev);
              next.set(chatDeviceId, { ...current, status });
              return next;
            });
          },
          onTypingState: ({ deviceId, isTyping }) => {
            const timers = typingTimersRef.current;
            if (isTyping) {
              setTypingPeers((prev) => (prev[deviceId] ? prev : { ...prev, [deviceId]: true }));
              if (timers[deviceId]) clearTimeout(timers[deviceId]);
              // A peer that stops mid-word (tab closed, link lost) must not
              // leave a typing bubble behind forever.
              timers[deviceId] = setTimeout(() => {
                delete timers[deviceId];
                setTypingPeers((prev) => {
                  if (!prev[deviceId]) return prev;
                  const next = { ...prev };
                  delete next[deviceId];
                  return next;
                });
              }, 4000);
              return;
            }
            if (timers[deviceId]) {
              clearTimeout(timers[deviceId]);
              delete timers[deviceId];
            }
            setTypingPeers((prev) => {
              if (!prev[deviceId]) return prev;
              const next = { ...prev };
              delete next[deviceId];
              return next;
            });
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
            // A finished transfer lingers briefly (so the last frame is seen)
            // and then leaves the list, keeping this state from growing.
            if (progress.status !== 'transferring') {
              const finishedId = progress.fileId;
              setTimeout(() => {
                setActiveTransfers((prev) => prev.filter((p) => p.fileId !== finishedId));
              }, 1200);
            }
          },
          onFileCompleted: async () => {
            await refreshContacts();
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
            setActiveContact((current) =>
              current && current.deviceId !== contact.deviceId ? current : contact
            );
            setSelectedContactForDetails((current) =>
              current && current.deviceId === contact.deviceId ? contact : current
            );
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
        setPeerManager(pm);

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
        // Networking is optional: the workspace keeps working without it.
        console.warn('Signaling client init error:', err);
      }
    }

    init();

    return () => {
      isMounted = false;
      callManagerRef.current?.destroy();
      callManagerRef.current = null;
      peerManagerRef.current?.destroy();
      peerManagerRef.current = null;
    };
  }, [bootAttempt]);

  const reloadLastMessages = async () => {
    const allMsgs = await db.messages.orderBy('timestamp').reverse().toArray();
    const map = new Map<string, MessageRecord>();
    for (const msg of allMsgs) {
      if (!map.has(msg.chatDeviceId)) {
        map.set(msg.chatDeviceId, msg);
      }
    }
    setLastMessagesMap(map);
  };

  /**
   * A new message only affects one row of the sidebar, so the preview is
   * updated in place instead of re-reading the whole history table.
   */
  const updateLastMessageFor = (msg: MessageRecord) => {
    setLastMessagesMap((prev) => {
      const current = prev.get(msg.chatDeviceId);
      if (current && current.timestamp > msg.timestamp) return prev;
      const next = new Map(prev);
      next.set(msg.chatDeviceId, msg);
      return next;
    });
  };

  /**
   * Marks the conversation on screen as read: the sender sees a read receipt and
   * the unread dot in the sidebar clears. Group messages keep the relay quiet.
   */
  const acknowledgeVisibleMessages = (
    chatKey: string | null,
    msgs: MessageRecord[],
    isGroupChat = false
  ) => {
    const pm = peerManagerRef.current;
    if (!pm || !chatKey || msgs.length === 0 || isGroupChat) return;
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    const unread = msgs.filter(
      (m) => m.direction === 'INBOUND' && !!m.messageId && m.status !== 'read'
    );
    if (unread.length === 0) return;
    void pm.sendReadReceipt(
      chatKey,
      unread.slice(-60).map((m) => m.messageId as string)
    );
    void db.messages
      .filter(
        (m) =>
          m.chatDeviceId === chatKey && m.direction === 'INBOUND' && m.status !== 'read'
      )
      .modify({ status: 'read' })
      .then(async () => {
        const rows = await db.messages.where('chatDeviceId').equals(chatKey).sortBy('timestamp');
        const latest = rows[rows.length - 1];
        if (!latest) return;
        setLastMessagesMap((prev) => {
          const current = prev.get(chatKey);
          if (!current || current.timestamp !== latest.timestamp) return prev;
          const next = new Map(prev);
          next.set(chatKey, { ...current, status: 'read' });
          return next;
        });
      })
      .catch(() => {});
  }

  /**
   * A received attachment whose bytes never arrived. The bubble asks for them
   * again instead of sitting on a spinner nobody can clear.
   */
  const handleRetryAttachment = (message: MessageRecord) => {
    if (!message.messageId || !message.fileId) return;
    peerManagerRef.current?.requestAttachmentBytes?.(
      message.messageId,
      message.fileId,
      message.chatDeviceId,
      true
    );
  };

  const handleRetryMessage = (messageId: string) => {
    void peerManagerRef.current?.retryMessage(messageId).catch(() => {});
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
      acknowledgeVisibleMessages(chatKey, msgs, !!activeGroup);
    }
    loadMessages();
  }, [activeContact, activeGroup]);

  const refreshContacts = async () => {
    const list = await db.contacts.toArray();
    contactsRef.current = list;
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
    // Notify the other peer so it gets deleted from their device as well
    if (peerManagerRef.current) {
      await peerManagerRef.current.notifyContactRemoved(deviceId);
    }
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

  const handleSendMessage = async (text: string) => {
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
    updateLastMessageFor(msg);
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
    // The outbox owns delivery (direct link first, then the durable relay and
    // its receipt), so this returns as soon as the file is stored locally: the
    // photo appears in the conversation instantly and the ticks follow the
    // real delivery state instead of a best-effort upload.
    await peerManagerRef.current.sendAttachment(file, activeContact.deviceId);
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
    try {
      localStorage.setItem(ONBOARDING_FLAG, 'true');
    } catch {}
    if (peerManagerRef.current) {
      peerManagerRef.current.updateIdentity(updatedId);
    }
  };

  /** Retry the signaling relay from the header chip. */
  const handleRetryRelay = () => {
    if (peerManagerRef.current) {
      peerManagerRef.current.reconnectRelay();
      return;
    }
    setBootAttempt((attempt) => attempt + 1);
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

  if (bootError && !identity) {
    return (
      <div className="app-shell-height w-screen flex flex-col items-center justify-center gap-4 bg-zinc-950 text-zinc-300 px-6 text-center font-sans">
        <ScryptChatLogo size={40} />
        <p className="max-w-sm text-sm text-zinc-400">{bootError}</p>
        <button
          onClick={() => setBootAttempt((attempt) => attempt + 1)}
          className="btn-primary px-5 py-2.5 text-xs"
        >
          Try again
        </button>
        <button
          onClick={() => window.location.reload()}
          className="btn-secondary px-5 py-2.5 text-xs"
        >
          Reload page
        </button>
      </div>
    );
  }

  return (
    <div className="app-shell-height w-full max-w-full flex flex-col bg-zinc-950 text-zinc-100 overflow-hidden select-none font-sans">
      {/* Top Header Bar */}
      <TerminalHeader
        identity={identity}
        connectionState={connectionState}
        relayStatus={relayStatus}
        relayPingMs={relayPingMs}
        relayErrorReason={relayErrorReason}
        onRetryRelay={handleRetryRelay}
        activeContact={activeContact}
        latencyMs={latencyMs}
        currentMobileTab={mobileTab}
        onMobileTabChange={setMobileTab}
        onOpenPairing={() => setIsPairingOpen(true)}
        onOpenProfile={() => setIsProfileOpen(true)}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onOpenAbout={() => setIsAboutOpen(true)}
        onOpenWipe={() => setIsWipeOpen(true)}
      />

      {/* Main Workspace Layout */}
      <div className="flex-1 min-h-0 flex overflow-hidden lg:px-3 lg:pb-3">
        {/* Wide screens (laptop and up): two floating panes. Tablets and phones
            use the tabbed single-pane flow so nothing gets stretched. */}
        <div className="hidden lg:flex flex-1 min-h-0 h-full overflow-hidden gap-3">
          <div className="w-[320px] xl:w-[352px] shrink-0 min-h-0 rounded-3xl border border-zinc-800 panel-surface overflow-hidden shadow-[var(--sc-shadow-sm)]">
          <PeerList
            contacts={contacts}
            groups={groups}
            activeContactId={activeContact?.deviceId || null}
            activeGroupId={activeGroup?.groupId || null}
            connectedPeerId={
              connectionState === 'CONNECTED' ? activeContact?.deviceId || null : null
            }
            lanPeerId={lanPeerId}
            typingPeerIds={typingPeers}
            lastMessages={lastMessagesMap}
            onSelectPeer={handleSelectPeer}
            onSelectGroup={handleSelectGroup}
            onOpenPairing={() => setIsPairingOpen(true)}
            onOpenGroupCreator={() => setIsGroupCreatorOpen(true)}
            onOpenContactDetails={(contact) => setSelectedContactForDetails(contact)}
            onOpenGroupDetails={(group) => setSelectedGroupForDetails(group)}
            onStartCall={handleStartCall}
            onDeleteContact={handleDeleteContact}
          />
          </div>
          <div className="flex-1 min-w-0 min-h-0 rounded-3xl border border-zinc-800 canvas-surface overflow-hidden shadow-[var(--sc-shadow-sm)]
          ">
          <ChatView
            activeContact={activeContact}
            activeGroup={activeGroup}
            messages={messages}
            activeTransfers={activeTransfers}
            isConnected={connectionState === 'CONNECTED'}
            isLanLink={lanPeerId === activeContact?.deviceId}
            latencyMs={latencyMs || undefined}
            peerManager={peerManager}
            onSendMessage={handleSendMessage}
            onSendFile={handleSendFile}
            onStartCall={handleStartCall}
            onRetryMessage={handleRetryMessage}
            onRetryAttachment={handleRetryAttachment}
            isPeerTyping={!!activeContact && !!typingPeers[activeContact.deviceId]}
            onClearHistory={handleClearHistory}
            onDeleteContact={handleDeleteContact}
          />
          </div>
        </div>

        {/* Phones and tablets: single view with the Chats / Chat switcher */}
        <div className="flex lg:hidden flex-1 min-h-0 h-full overflow-hidden">
          {mobileTab === 'peers' ? (
            <PeerList
              contacts={contacts}
              groups={groups}
              activeContactId={activeContact?.deviceId || null}
              activeGroupId={activeGroup?.groupId || null}
              connectedPeerId={
                connectionState === 'CONNECTED' ? activeContact?.deviceId || null : null
              }
              lanPeerId={lanPeerId}
              typingPeerIds={typingPeers}
              lastMessages={lastMessagesMap}
              onSelectPeer={handleSelectPeer}
              onSelectGroup={handleSelectGroup}
              onOpenPairing={() => setIsPairingOpen(true)}
              onOpenGroupCreator={() => setIsGroupCreatorOpen(true)}
              onOpenContactDetails={(contact) => setSelectedContactForDetails(contact)}
              onOpenGroupDetails={(group) => setSelectedGroupForDetails(group)}
              onStartCall={handleStartCall}
              onDeleteContact={handleDeleteContact}
            />
          ) : (
            <ChatView
              activeContact={activeContact}
              activeGroup={activeGroup}
              messages={messages}
              activeTransfers={activeTransfers}
              isConnected={connectionState === 'CONNECTED'}
              isLanLink={lanPeerId === activeContact?.deviceId}
              latencyMs={latencyMs || undefined}
              peerManager={peerManager}
              onSendMessage={handleSendMessage}
              onSendFile={handleSendFile}
              onStartCall={handleStartCall}
              onRetryMessage={handleRetryMessage}
              onRetryAttachment={handleRetryAttachment}
              isPeerTyping={!!activeContact && !!typingPeers[activeContact.deviceId]}
              onBackToPeers={() => setMobileTab('peers')}
              onClearHistory={handleClearHistory}
              onDeleteContact={handleDeleteContact}
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

      {/* Onboarding Welcome Screen (First visit, or after erasing local data) */}
      {showOnboarding && (
        <OnboardingModal
          identity={identity}
          onComplete={handleOnboardingComplete}
        />
      )}

      {/* Pairing Modal (Dynamic QR / OTP) */}
      {peerManager && (
        <PairingModal
          isOpen={isPairingOpen}
          peerManager={peerManager}
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

      {/* Profile window */}
      <ProfileModal
        isOpen={isProfileOpen}
        identity={identity}
        onClose={() => setIsProfileOpen(false)}
        onUpdate={handleProfileUpdate}
      />

      {/* Settings window: sounds and calls */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        relayStatusText={
          relayStatus === 'ONLINE' ? 'Signaling online' : `Signaling ${relayStatus.toLowerCase()}`
        }
        vaultText={
          secureContext
            ? describeStorage(storageDriver)
            : `${describeStorage(storageDriver)} · keys need https`
        }
      />

      {/* About window */}
      <AboutModal
        isOpen={isAboutOpen}
        onClose={() => setIsAboutOpen(false)}
        statusLine={`${APP_INFO.name} ${APP_INFO.version} · ${describeStorage(storageDriver)}`}
      />

      {/* Local Vault Wipe Dialog */}
      <DataWipeDialog
        isOpen={isWipeOpen}
        onClose={() => setIsWipeOpen(false)}
        onWipeCompleted={async () => {
          peerManagerRef.current?.destroy();
          peerManagerRef.current = null;
          callManagerRef.current?.destroy();
          callManagerRef.current = null;
          setPeerManager(null);
          resetIdentityBootstrap();
          setContacts([]);
          setGroups([]);
          setActiveContact(null);
          setActiveGroup(null);
          setMessages([]);
          setLastMessagesMap(new Map());
          setIsWipeOpen(false);
          const freshId = await getOrCreateIdentity();
          setIdentity(freshId);
          try {
            localStorage.removeItem(ONBOARDING_FLAG);
          } catch {}
          setShowOnboarding(true);
        }}
      />
    </div>
  );
}
