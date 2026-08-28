import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { signalingRouter } from './server/signaling';

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '10mb' }));

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

  // Security Headers (CSP from Section 6)
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
    res.setHeader('X-Frame-Options', 'DENY');
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
