/// <reference types="node" />
import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleVerifyDeposit } from '../../server/paymentGateway.ts';

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: false, message: 'Méthode non autorisée.' }));
    return;
  }

  const parsedUrl = new URL(req.url || '/', 'https://localhost');
  const token = parsedUrl.searchParams.get('token') || '';

  const result = await handleVerifyDeposit({
    authHeader: typeof req.headers.authorization === 'string' ? req.headers.authorization : undefined,
    token,
  });

  res.statusCode = result.status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(result.body));
}
