import React, { useState, useEffect, useRef } from 'react';
import { getOrCreateIdentity } from './crypto/keys';
import { db } from './db/index';
import {
  ContactRecord,
  FileRecord,
  FileTransferProgress,
  IdentityRecord,
  MessageRecord,
  RelayStatus,
} from './types/index';
import { ConnectionState, PeerManager } from './webrtc/peerManager';
import { TerminalHeader } from './components/TerminalHeader';
import { PeerList } from './components/PeerList';
import { ChatView } from './components/ChatView';
import { PairingModal } from './components/PairingModal';
import { SecurityModal } from './components/SecurityModal';
import { DataWipeDialog } from './components/DataWipeDialog';
import { OnboardingModal } from './components/OnboardingModal';
import { ProfileModal } from './components/ProfileModal';

export default function App() {
  const [identity, setIdentity] = useState<IdentityRecord | null>(null);
  const [contacts, setContacts] = useState<ContactRecord[]>([]);
  const [activeContact, setActiveContact] = useState<ContactRecord | null>(null);
  const [messages, setMessages] = useState<MessageRecord[]>([]);
  const [lastMessagesMap, setLastMessagesMap] = useState<Map<string, MessageRecord>>(new Map());
  const [activeTransfers, setActiveTransfers] = useState<FileTransferProgress[]>([]);
  const [connectionState, setConnectionState] = useState<ConnectionState>('DISCONNECTED');
  const [relayStatus, setRelayStatus] = useState<RelayStatus>('CONNECTING');
  const [latencyMs, setLatencyMs] = useState<number | null>(null);

  // Mobile View Switcher Tab ('peers' vs 'chat')
  const [mobileTab, setMobileTab] = useState<'peers' | 'chat'>('peers');

  // Modals
  const [isPairingOpen, setIsPairingOpen] = useState(false);
  const [isSecurityOpen, setIsSecurityOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isWipeOpen, setIsWipeOpen] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);

  // Peer Manager ref
  const peerManagerRef = useRef<PeerManager | null>(null);

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
        if (loadedContacts.length > 0) {
          setActiveContact(loadedContacts[0]);
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
          onRelayStatusChange: (status) => {
            setRelayStatus(status);
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
            setMessages((prev) => {
              if (activeContact && msg.chatDeviceId === activeContact.deviceId) {
                return [...prev, msg];
              }
              return prev;
            });
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
      } catch (err) {
        console.error('Initialization error:', err);
      }
    }

    init();

    return () => {
      isMounted = false;
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
      if (!activeContact) {
        setMessages([]);
        return;
      }
      const msgs = await db.messages
        .where('chatDeviceId')
        .equals(activeContact.deviceId)
        .sortBy('timestamp');
      setMessages(msgs);
    }
    loadMessages();
  }, [activeContact]);

  const refreshContacts = async () => {
    const list = await db.contacts.toArray();
    setContacts(list);
    await reloadLastMessages();
  };

  const handleSelectPeer = (contact: ContactRecord) => {
    setActiveContact(contact);
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
    await reloadLastMessages();
  };

  const handleSendMessage = async (text: string) => {
    if (!peerManagerRef.current || !activeContact) return;
    const msg = await peerManagerRef.current.sendTextMessage(text, activeContact.deviceId);
    setMessages((prev) => [...prev, msg]);
    await reloadLastMessages();
  };

  const handleSendFile = async (file: File) => {
    if (!peerManagerRef.current || !activeContact) return;
    await peerManagerRef.current.sendFile(file, activeContact.deviceId);
    await reloadLastMessages();
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

  return (
    <div className="h-screen w-screen flex flex-col bg-[#09090b] text-[#f4f4f5] overflow-hidden select-none font-sans">
      {/* Top Header Bar */}
      <TerminalHeader
        identity={identity}
        connectionState={connectionState}
        relayStatus={relayStatus}
        activeContact={activeContact}
        latencyMs={latencyMs}
        currentMobileTab={mobileTab}
        onMobileTabChange={setMobileTab}
        onOpenPairing={() => setIsPairingOpen(true)}
        onOpenSecurity={() => setIsSecurityOpen(true)}
        onOpenProfile={() => setIsProfileOpen(true)}
        onOpenWipe={() => setIsWipeOpen(true)}
      />

      {/* Main Workspace Layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Desktop: Dual-Pane Master-Detail */}
        <div className="hidden md:flex flex-1 overflow-hidden">
          <PeerList
            contacts={contacts}
            activeContactId={activeContact?.deviceId || null}
            connectedPeerId={
              connectionState === 'CONNECTED' ? activeContact?.deviceId || null : null
            }
            lastMessages={lastMessagesMap}
            onSelectPeer={handleSelectPeer}
            onOpenPairing={() => setIsPairingOpen(true)}
            onDeleteContact={handleDeleteContact}
          />
          <ChatView
            activeContact={activeContact}
            messages={messages}
            activeTransfers={activeTransfers}
            isConnected={connectionState === 'CONNECTED'}
            latencyMs={latencyMs || undefined}
            onSendMessage={handleSendMessage}
            onSendFile={handleSendFile}
            onVerifyContact={() => setIsSecurityOpen(true)}
          />
        </div>

        {/* Mobile: Single-View Navigation */}
        <div className="flex md:hidden flex-1 overflow-hidden">
          {mobileTab === 'peers' ? (
            <PeerList
              contacts={contacts}
              activeContactId={activeContact?.deviceId || null}
              connectedPeerId={
                connectionState === 'CONNECTED' ? activeContact?.deviceId || null : null
              }
              lastMessages={lastMessagesMap}
              onSelectPeer={handleSelectPeer}
              onOpenPairing={() => setIsPairingOpen(true)}
              onDeleteContact={handleDeleteContact}
            />
          ) : (
            <ChatView
              activeContact={activeContact}
              messages={messages}
              activeTransfers={activeTransfers}
              isConnected={connectionState === 'CONNECTED'}
              latencyMs={latencyMs || undefined}
              onSendMessage={handleSendMessage}
              onSendFile={handleSendFile}
              onBackToPeers={() => setMobileTab('peers')}
              onVerifyContact={() => setIsSecurityOpen(true)}
            />
          )}
        </div>
      </div>

      {/* Onboarding Welcome Screen (Only on first visit) */}
      {showOnboarding && identity && (
        <OnboardingModal
          identity={identity}
          onComplete={handleOnboardingComplete}
        />
      )}

      {/* Pairing Modal (1-Minute Dynamic QR / OTP) */}
      {peerManagerRef.current && (
        <PairingModal
          isOpen={isPairingOpen}
          peerManager={peerManagerRef.current}
          onClose={() => setIsPairingOpen(false)}
          onPairSuccess={async () => {
            await refreshContacts();
            setMobileTab('chat');
          }}
        />
      )}

      {/* Profile Settings Modal */}
      <ProfileModal
        isOpen={isProfileOpen}
        identity={identity}
        onClose={() => setIsProfileOpen(false)}
        onUpdate={handleProfileUpdate}
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
          window.location.reload();
        }}
      />
    </div>
  );
}
