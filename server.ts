import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { signalingRouter } from './server/signaling';

async function startServer() {
  const app = express();
  // Render/Cloud Run injects PORT environment variable; default to 3000
  const PORT = Number(process.env.PORT) || 3000;

  // Relay fallback carries base64-encoded attachments, so leave room for
  // normal phone photos while direct WebRTC remains the preferred path.
  app.use(express.json({ limit: '50mb' }));

  // Serve static assets from public folder
  const publicPath = path.join(process.cwd(), 'public');
  app.use(express.static(publicPath));

  // Handle favicon.ico explicitly to avoid 404 console errors
  app.get('/favicon.ico', (req, res) => {
    res.redirect(301, '/favicon.svg');
  });

  // CORS Middleware for external signalling clients
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
      res.sendStatus(200);
      return;
    }
    next();
  });

  // Security Headers
  app.use((req, res, next) => {
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob:; " +
      "connect-src 'self' wss: ws: stuns: stun: https:; " +
      "img-src 'self' data: blob:; " +
      "media-src 'self' blob:; " +
      "worker-src 'self' blob:;"
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    next();
  });

  // API Routes FIRST
  app.use('/api/signaling', signalingRouter);

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', protocol: 'scryptChat/3.1', service: 'signaling-relay' });
  });

  // Vite middleware for development vs static build in production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`scryptChat Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
