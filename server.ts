/// <reference types="node" />
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import dotenv from 'dotenv';
import express from 'express';
import { handleInitiateDeposit, handleVerifyDeposit } from './server/paymentGateway.ts';

if (fs.existsSync('.env.local')) {
  dotenv.config({ path: '.env.local' });
}
dotenv.config();

const PORT = Number(process.env.PORT || 3000);
const IS_PROD = process.env.NODE_ENV === 'production';

async function startServer() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '64kb' }));

  app.post('/api/deposit/initiate', async (req, res) => {
    const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'https');
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000');
    const fallbackOrigin = `${proto}://${host}/`;
    const result = await handleInitiateDeposit({
      authHeader: typeof req.headers.authorization === 'string' ? req.headers.authorization : undefined,
      body: (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>,
      fallbackOrigin,
    });
    res.status(result.status).json(result.body);
  });

  app.get('/api/deposit/verify', async (req, res) => {
    const token = typeof req.query.token === 'string' ? req.query.token : '';
    const result = await handleVerifyDeposit({
      authHeader: typeof req.headers.authorization === 'string' ? req.headers.authorization : undefined,
      token,
    });
    res.status(result.status).json(result.body);
  });

  if (!IS_PROD) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('/{*path}', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

void startServer();
