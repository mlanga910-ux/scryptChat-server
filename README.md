# scryptChat

Peer-to-peer chat, calls and file transfer. Messages are encrypted on the device
with the Web Crypto API and travel directly between peers over WebRTC data
channels; the signaling server only relays connection metadata.

## Run locally

```bash
npm install
npm run dev      # Express + Vite on http://localhost:3000
```

## Build and run in production

```bash
npm run build    # vite build -> dist/, esbuild -> dist/server.cjs
npm start        # NODE_ENV=production node dist/server.cjs
```

In production the same Express process serves `dist/` and the
`/api/signaling/*` relay on `$PORT`, so the browser talks to the relay on its own
origin.

## Deploy on Render

1. Push this repository to GitHub.
2. In Render choose **New → Blueprint** and select the repository.
   `render.yaml` is picked up automatically and configures:
   - build: `npm install && npm run build`
   - start: `npm start`
   - env: `NODE_ENV=production`, health check on `/api/health`
3. Wait for the first deploy, then open the service URL.

The free instance sleeps after ~15 minutes idle; the first request afterwards
takes a few seconds while it wakes up.

### Environment variables

| Key | Required | Notes |
| --- | --- | --- |
| `NODE_ENV` | yes | Set to `production` so the server serves `dist/` instead of Vite middleware. |
| `PORT` | set by Render | The server binds `0.0.0.0:$PORT`. |
| `CORS_ORIGINS` | no | Comma separated extra origins allowed to call the relay API. |

## How it works

- **Local first.** Identity keys, profile, contacts, groups and message history
  live on the device, with a localStorage backup of the keypair. Profile,
  history, chat settings and the welcome flow work with the signaling server
  completely unreachable.
- **Storage that cannot be blocked.** The vault probes IndexedDB and silently
  falls back to localStorage and then to session memory, so blocked-cookies
  policies, private windows, partitioned frames and storage-restricted webviews
  still run the whole app. The active backend is shown under Settings; the app
  never interrupts you with a storage warning.
- **Keyless fallback.** Browsers without WebCrypto (an insecure http origin) get
  a working device without a signing key: everything local works, and pairing
  explains that it needs an https context instead of failing mysteriously.
- **The relay only introduces peers.** It creates pairing rooms, exchanges
  SDP/ICE candidates, keeps presence and stores offline envelopes. Once two
  devices are paired, messages, calls and files travel directly over a WebRTC
  data channel and never touch the server.
- **First run.** A new device (or one whose local data was erased) gets the
  welcome flow: name, profile photo, bio, status and light/dark theme, then the
  chat workspace. It is stored locally and repeated after a wipe.
- **Status chip.** The header always shows the live relay state
  (`Online` / `Connecting…` / `Server offline`) and re-probes the server when
  tapped, so a stale connection never needs a page reload.

## Notes

- Signaling state (rooms, presence, mailboxes) lives in memory, so a single
  instance is expected. Restarting the service clears pending handshakes.
- Devices on the same network negotiate a direct host route, shown as **LAN**
  next to the contact: messages, files and calls then travel host-to-host at
  full local speed and keep working with no internet at all. The relay is only
  needed to find each other the first time.
- Profiles sync both ways: a display name, photo or bio change is pushed over the
  live link (or the encrypted mailbox when the peer is offline), so every view —
  contact list, chat header, call screen — shows the same picture.
