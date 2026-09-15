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

## Notes

- Signaling state (rooms, presence, mailboxes) lives in memory, so a single
  instance is expected. Restarting the service clears pending handshakes.
- Devices on the same network negotiate a direct host route; the relay is only
  needed to find each other.
- Everything the user sends is stored locally in IndexedDB on their device.
