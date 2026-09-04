# scryptChat

scryptChat is a zero-trust, peer-to-peer secure communication system designed for direct, end-to-end encrypted messaging, voice/video calling, code sharing, and file transfers without intermediate storage servers.

All cryptographic operations run locally on the client using the Web Cryptography API (SubtleCrypto). No message content, private keys, or transferred files ever touch a central database or third-party cloud.

---

## Core Principles

### 1. Zero-Trust Security & Real Cryptography
- **Ephemeral Key Exchange**: Uses ECDH (Elliptic Curve Diffie-Hellman P-256) to derive shared symmetric session keys per peer.
- **Authenticated Encryption**: All message payloads, file chunks, and control packets are encrypted with AES-256-GCM with unique initialization vectors (IV) for every transmission.
- **Key Derivation & Protection**: User identity keys and local database contents are secured client-side using PBKDF2 with SHA-256 key stretching and salt.
- **Safety Numbers & Fingerprints**: Visual cryptographic fingerprint comparisons to verify contact identities out-of-band and protect against active man-in-the-middle attacks.

### 2. Direct P2P Transport & Low Latency
- **Direct WebRTC Data Channels**: Messages, code snippets, and large files stream directly between peers over encrypted WebRTC data channels with DTLS encryption.
- **Zero Central Storage**: Signaling only exchanges ephemeral connection metadata (SDP offers/answers and ICE candidates). Once connected, communication is direct browser-to-browser.
- **Chunked File Pipeline**: High-throughput file transmission engine with transfer progress, checksum validation, and client-side IndexedDB assembly.

### 3. Native Calling Experience
- **Real-Time Voice & Video**: Direct WebRTC peer-to-peer voice and video streams.
- **Synthesized Audio Engine**: Realistic telecommunication ringbacks, dual-frequency dial tones (440Hz + 480Hz), and acoustic notifications generated via the Web Audio API without bulky audio assets.
- **Native Call Interface**: Clean calling dashboard with camera toggle, audio mute, front/back camera switching, screen sharing, and call duration tracking.

### 4. Developer-Focused Code Sharing
- **Automatic Code Detection**: Pasted snippets and code messages are automatically parsed into syntax-highlighted code cards without requiring manual markdown fences.
- **Interactive Tools**: Full-screen code viewer, code search, one-click copy, and file download with detected language extensions (.ts, .py, .go, .rs, .json, etc.).

### 5. Local Data Control & Privacy
- **Encrypted Local Database**: All contact lists, conversation histories, and transferred assets are stored strictly in client-side IndexedDB.
- **Data Export & Import**: Users can export their encrypted identity and conversation archives as a JSON backup or purge all local data instantly with one click.
- **Custom Identities**: Custom contact aliases, group details, and local avatar pictures without uploading images to any external image host.

---

## Tech Stack

- **Frontend**: React 18, TypeScript, Tailwind CSS, Lucide Icons
- **Cryptographic Primitives**: Web Cryptography API (SubtleCrypto, ECDH P-256, AES-GCM 256-bit, PBKDF2)
- **Networking & Transport**: WebRTC (RTCPeerConnection, RTCDataChannel), WebSocket Signaling
- **Local Persistence**: IndexedDB (Dexie.js)
- **Audio Synthesis**: Web Audio API (real-time harmonic frequency generator)

---

## Getting Started

### Prerequisites
- Node.js 18+
- npm or yarn

### Installation

```bash
# Clone the repository
git clone https://github.com/username/scryptchat.git
cd scryptchat

# Install dependencies
npm install

# Start development server
npm run dev
```

### Production Build

```bash
npm run build
```

The compiled static assets will be output to the `dist/` directory, ready to be deployed to any static hosting service or custom server.

---

## Architecture Overview

```
[ Browser A: Client ] <==== Direct WebRTC P2P (DTLS / AES-256-GCM) ====> [ Browser B: Client ]
         |                                                                      |
    (Local Only)                                                           (Local Only)
  [ IndexedDB + Keys ]                                                   [ IndexedDB + Keys ]
         \                                                                      /
          \--- (Ephemeral SDP / ICE exchange only via Signaling Relay) --------/
```

- Messages and files do not pass through the signaling server once the P2P connection is established.
- If a direct peer connection cannot be established due to symmetric NATs, encrypted WebRTC relay channels preserve confidentiality because AES-GCM payload encryption occurs before transport.

---

## License

MIT License. Free for personal and commercial use.
