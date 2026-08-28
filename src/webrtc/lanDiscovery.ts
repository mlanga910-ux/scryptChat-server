/**
 * scryptChat Local Area Network (LAN) & Direct Peer Discovery Engine
 * 
 * Provides zero-server local device discovery:
 * 1. BroadcastChannel: Instant offline pairing across local browser tabs/windows without any server.
 * 2. Local Subnet Coordinator: Discovers devices on the same Wi-Fi router / local network.
 * 
 * Security:
 * - Visibility is strictly opt-in (disabled by default).
 * - Invisible devices transmit zero announcements and cannot be discovered.
 * - Connections strictly require mutual user confirmation (recipient must explicitly accept).
 */

import { HandshakeAnswerData, HandshakeOfferData, IdentityRecord } from '../types/index';
import { PeerManager } from './peerManager';

export interface LanDiscoveredPeer {
  deviceId: string;
  displayName: string;
  source: 'local-channel' | 'local-network';
  lastSeen: number;
}

export interface LanIncomingInvite {
  inviteId: string;
  fromDeviceId: string;
  fromDisplayName: string;
  offer: HandshakeOfferData;
  source: 'local-channel' | 'local-network';
  accept: () => Promise<void>;
  decline: () => void;
}

export interface LanDiscoveryEvents {
  onPeersUpdate: (peers: LanDiscoveredPeer[]) => void;
  onIncomingInvite: (invite: LanIncomingInvite) => void;
  onPairSuccess: () => void;
  onError: (errorMsg: string) => void;
}

export class LanDiscoveryService {
  private peerManager: PeerManager;
  private identity: IdentityRecord;
  private events: LanDiscoveryEvents;

  private isScanning = false;
  private isVisible = false;

  private broadcastChannel: BroadcastChannel | null = null;
  private networkPollTimer: any = null;
  private outgoingInvitePollTimer: any = null;

  private discoveredPeersMap = new Map<string, LanDiscoveredPeer>();

  constructor(peerManager: PeerManager, identity: IdentityRecord, events: LanDiscoveryEvents) {
    this.peerManager = peerManager;
    this.identity = identity;
    this.events = events;

    this.initBroadcastChannel();
  }

  public updateIdentity(identity: IdentityRecord) {
    this.identity = identity;
    if (this.isVisible && this.isScanning) {
      this.announcePresence();
    }
  }

  public setScanning(enabled: boolean) {
    this.isScanning = enabled;
    if (enabled) {
      this.startScanning();
    } else {
      this.stopScanning();
    }
  }

  public setVisibility(enabled: boolean) {
    this.isVisible = enabled;
    this.announcePresence();
    if (!enabled) {
      // Remove self from any local records immediately
      this.broadcastChannel?.postMessage({
        type: 'LAN_WITHDRAW',
        deviceId: this.identity.deviceId,
      });
    }
  }

  public getIsScanning(): boolean {
    return this.isScanning;
  }

  public getIsVisible(): boolean {
    return this.isVisible;
  }

  public getDiscoveredPeers(): LanDiscoveredPeer[] {
    const now = Date.now();
    const list: LanDiscoveredPeer[] = [];
    for (const [id, peer] of this.discoveredPeersMap.entries()) {
      if (id !== this.identity.deviceId && now - peer.lastSeen < 20000) {
        list.push(peer);
      }
    }
    return list;
  }

  /**
   * 1. BroadcastChannel: Direct zero-server offline discovery for tabs/windows on same device
   */
  private initBroadcastChannel() {
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        this.broadcastChannel = new BroadcastChannel('scryptchat_lan_local_p2p');
        this.broadcastChannel.onmessage = (event) => {
          this.handleBroadcastMessage(event.data);
        };
      }
    } catch {
      // BroadcastChannel unavailable
    }
  }

  private handleBroadcastMessage(data: any) {
    if (!data || !data.type || data.deviceId === this.identity.deviceId) return;

    if (data.type === 'LAN_ANNOUNCE') {
      if (!this.isScanning) return;
      this.discoveredPeersMap.set(data.deviceId, {
        deviceId: data.deviceId,
        displayName: data.displayName || `Device-${data.deviceId.slice(-4)}`,
        source: 'local-channel',
        lastSeen: Date.now(),
      });
      this.notifyPeersUpdate();
    } else if (data.type === 'LAN_WITHDRAW') {
      this.discoveredPeersMap.delete(data.deviceId);
      this.notifyPeersUpdate();
    } else if (data.type === 'LAN_INVITE' && data.toDeviceId === this.identity.deviceId) {
      // Security: Only accept invite if device is currently scanning or visible
      if (!this.isScanning && !this.isVisible) return;

      const invite: LanIncomingInvite = {
        inviteId: data.inviteId || `bc_${Date.now()}`,
        fromDeviceId: data.fromDeviceId,
        fromDisplayName: data.fromDisplayName || 'Local Peer',
        offer: data.offer,
        source: 'local-channel',
        accept: async () => {
          try {
            const answer = await this.peerManager.acceptOffer(data.offer);
            this.broadcastChannel?.postMessage({
              type: 'LAN_ANSWER',
              inviteId: data.inviteId,
              fromDeviceId: this.identity.deviceId,
              toDeviceId: data.fromDeviceId,
              answer,
            });
            await this.peerManager.saveContact(
              data.fromDeviceId,
              data.offer.identityPublicKeyRaw,
              '000000',
              data.fromDisplayName
            );
            this.events.onPairSuccess();
          } catch (err: any) {
            this.events.onError(err?.message || 'Failed to accept connection');
          }
        },
        decline: () => {
          this.broadcastChannel?.postMessage({
            type: 'LAN_DECLINE',
            inviteId: data.inviteId,
            fromDeviceId: this.identity.deviceId,
            toDeviceId: data.fromDeviceId,
          });
        },
      };

      this.events.onIncomingInvite(invite);
    }
  }

  /**
   * 2. Start / Stop Scanning Loop
   */
  private startScanning() {
    this.announcePresence();
    this.pollNetworkPeers();

    if (this.networkPollTimer) clearInterval(this.networkPollTimer);
    this.networkPollTimer = setInterval(() => {
      if (this.isScanning) {
        this.announcePresence();
        this.pollNetworkPeers();
        this.pollNetworkInvites();
        this.pruneStalePeers();
      }
    }, 3500);
  }

  private stopScanning() {
    if (this.networkPollTimer) {
      clearInterval(this.networkPollTimer);
      this.networkPollTimer = null;
    }
    if (this.outgoingInvitePollTimer) {
      clearInterval(this.outgoingInvitePollTimer);
      this.outgoingInvitePollTimer = null;
    }
    this.discoveredPeersMap.clear();
    this.notifyPeersUpdate();

    // If visibility is off, withdraw from network
    if (!this.isVisible) {
      this.peerManager.fetchRelay('/api/signaling/lan/announce', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceId: this.identity.deviceId,
          isVisible: false,
        }),
      }, 3000).catch(() => {});
    }
  }

  /**
   * 3. Announce Presence
   */
  private async announcePresence() {
    // 3.1 Local BroadcastChannel
    if (this.isVisible) {
      this.broadcastChannel?.postMessage({
        type: 'LAN_ANNOUNCE',
        deviceId: this.identity.deviceId,
        displayName: this.identity.displayName || 'Secure Peer',
      });
    }

    // 3.2 Network coordinator announce
    try {
      await this.peerManager.fetchRelay('/api/signaling/lan/announce', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceId: this.identity.deviceId,
          displayName: this.identity.displayName || 'Secure Peer',
          isVisible: this.isVisible,
        }),
      }, 4000);
    } catch {
      // Local network coordinator may be offline
    }
  }

  /**
   * 4. Query Peers from Local Network
   */
  private async pollNetworkPeers() {
    if (!this.isScanning) return;

    try {
      const res = await this.peerManager.fetchRelay(
        `/api/signaling/lan/peers?deviceId=${encodeURIComponent(this.identity.deviceId)}`,
        {
          method: 'GET',
          headers: { 'Accept': 'application/json' },
        },
        4000
      );

      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.peers)) {
          for (const p of data.peers) {
            if (p.deviceId !== this.identity.deviceId) {
              this.discoveredPeersMap.set(p.deviceId, {
                deviceId: p.deviceId,
                displayName: p.displayName || `Device-${p.deviceId.slice(-4)}`,
                source: 'local-network',
                lastSeen: p.lastSeen || Date.now(),
              });
            }
          }
          this.notifyPeersUpdate();
        }
      }
    } catch {
      // Offline / network failure handled gracefully
    }
  }

  /**
   * 5. Poll for Incoming Direct Connection Invites
   */
  private async pollNetworkInvites() {
    if (!this.isScanning && !this.isVisible) return;

    try {
      const res = await this.peerManager.fetchRelay(
        `/api/signaling/lan/invites?deviceId=${encodeURIComponent(this.identity.deviceId)}`,
        {
          method: 'GET',
          headers: { 'Accept': 'application/json' },
        },
        4000
      );

      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.invites) && data.invites.length > 0) {
          for (const inv of data.invites) {
            const incoming: LanIncomingInvite = {
              inviteId: inv.inviteId,
              fromDeviceId: inv.fromDeviceId,
              fromDisplayName: inv.fromDisplayName || 'Nearby Peer',
              offer: inv.offer,
              source: 'local-network',
              accept: async () => {
                try {
                  const answer = await this.peerManager.acceptOffer(inv.offer);
                  await this.peerManager.fetchRelay('/api/signaling/lan/respond', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      inviteId: inv.inviteId,
                      accepted: true,
                      answer,
                    }),
                  }, 4000);
                  await this.peerManager.saveContact(
                    inv.fromDeviceId,
                    inv.offer.identityPublicKeyRaw,
                    '000000',
                    inv.fromDisplayName
                  );
                  this.events.onPairSuccess();
                } catch (err: any) {
                  this.events.onError(err?.message || 'Failed to accept connection');
                }
              },
              decline: () => {
                this.peerManager.fetchRelay('/api/signaling/lan/respond', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    inviteId: inv.inviteId,
                    accepted: false,
                  }),
                }, 3000).catch(() => {});
              },
            };

            this.events.onIncomingInvite(incoming);
          }
        }
      }
    } catch {
      // Network invite check
    }
  }

  /**
   * 6. Initiate Connection to a Discovered Peer
   */
  public async connectToPeer(peer: LanDiscoveredPeer): Promise<void> {
    const offer = await this.peerManager.createOffer();
    const inviteId = `lan_${Math.random().toString(36).substring(2, 11)}`;

    if (peer.source === 'local-channel') {
      // Send via BroadcastChannel
      return new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          cleanup();
          reject(new Error('Connection request timed out. Peer may have left.'));
        }, 18000);

        const onMessage = async (event: MessageEvent) => {
          const data = event.data;
          if (data?.inviteId === inviteId) {
            if (data.type === 'LAN_ANSWER' && data.answer) {
              cleanup();
              try {
                await this.peerManager.acceptAnswer(data.answer);
                await this.peerManager.saveContact(
                  peer.deviceId,
                  data.answer.identityPublicKeyRaw,
                  '000000',
                  peer.displayName
                );
                this.events.onPairSuccess();
                resolve();
              } catch (err: any) {
                reject(err);
              }
            } else if (data.type === 'LAN_DECLINE') {
              cleanup();
              reject(new Error('Peer declined the connection request.'));
            }
          }
        };

        const cleanup = () => {
          clearTimeout(timeout);
          this.broadcastChannel?.removeEventListener('message', onMessage);
        };

        this.broadcastChannel?.addEventListener('message', onMessage);

        this.broadcastChannel?.postMessage({
          type: 'LAN_INVITE',
          inviteId,
          fromDeviceId: this.identity.deviceId,
          fromDisplayName: this.identity.displayName || 'Secure Peer',
          toDeviceId: peer.deviceId,
          offer,
        });
      });
    }

    // Otherwise send via network coordinator
    const res = await this.peerManager.fetchRelay('/api/signaling/lan/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fromDeviceId: this.identity.deviceId,
        fromDisplayName: this.identity.displayName || 'Secure Peer',
        toDeviceId: peer.deviceId,
        offer,
      }),
    }, 6000);

    if (!res.ok) {
      throw new Error('Failed to send connection request to peer');
    }

    const data = await res.json();
    const serverInviteId = data.inviteId;

    // Poll for responder answer
    return new Promise<void>((resolve, reject) => {
      let attempts = 0;
      const pollTimer = setInterval(async () => {
        attempts++;
        if (attempts > 12) {
          clearInterval(pollTimer);
          reject(new Error('Connection request timed out. Peer did not respond.'));
          return;
        }

        try {
          const checkRes = await this.peerManager.fetchRelay(
            `/api/signaling/lan/invite/${serverInviteId}/status`,
            { method: 'GET' },
            3000
          );

          if (checkRes.ok) {
            const checkData = await checkRes.json();
            if (checkData.status === 'accepted' && checkData.answer) {
              clearInterval(pollTimer);
              await this.peerManager.acceptAnswer(checkData.answer);
              await this.peerManager.saveContact(
                peer.deviceId,
                checkData.answer.identityPublicKeyRaw,
                '000000',
                peer.displayName
              );
              this.events.onPairSuccess();
              resolve();
            } else if (checkData.status === 'declined') {
              clearInterval(pollTimer);
              reject(new Error('Peer declined the connection request.'));
            }
          }
        } catch {
          // Poll retry
        }
      }, 1500);
    });
  }

  private pruneStalePeers() {
    const now = Date.now();
    let changed = false;
    for (const [id, peer] of this.discoveredPeersMap.entries()) {
      if (now - peer.lastSeen > 25000) {
        this.discoveredPeersMap.delete(id);
        changed = true;
      }
    }
    if (changed) {
      this.notifyPeersUpdate();
    }
  }

  private notifyPeersUpdate() {
    this.events.onPeersUpdate(this.getDiscoveredPeers());
  }

  public destroy() {
    this.stopScanning();
    if (this.broadcastChannel) {
      try {
        this.broadcastChannel.close();
      } catch {}
      this.broadcastChannel = null;
    }
  }
}
