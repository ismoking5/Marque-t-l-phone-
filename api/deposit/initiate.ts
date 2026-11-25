/// <reference types="node" />
import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleInitiateDeposit } from '../../server/paymentGateway.ts';

async function readJsonBody(req: IncomingMessage & { body?: unknown }): Promise<Record<string, unknown>> {
  if (req.body && typeof req.body === 'object') {
    return req.body as Record<string, unknown>;
  }
  const chunks: Buffer[] = [];
  let totalSize = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    totalSize += buf.length;
    if (totalSize > 65536) {
      throw new Error('Payload too large');
    }
    chunks.push(buf);
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  return JSON.parse(raw) as Record<string, unknown>;
}

export default async function handler(
  req: IncomingMessage & { body?: unknown },
  res: ServerResponse
): Promise<void> {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: false, message: 'Méthode non autorisée.' }));
    return;
  }

  try {
    const body = await readJsonBody(req);
    const proto = String(req.headers['x-forwarded-proto'] || 'https');
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'aureliamobile.africa');
    const result = await handleInitiateDeposit({
      authHeader: typeof req.headers.authorization === 'string' ? req.headers.authorization : undefined,
      body,
      fallbackOrigin: `${proto}://${host}/`,
    });
    res.statusCode = result.status;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(result.body));
  } catch {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: false, message: 'Requête invalide.' }));
  }
}
