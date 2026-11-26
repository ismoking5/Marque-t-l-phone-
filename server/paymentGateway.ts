/// <reference types="node" />
import process from 'node:process';

const ALLOWED_DIAL_PREFIXES = ['225', '229', '237', '226', '221', '228'];
const ADMIN_EMAIL = 'ismailasawadogo10@gmail.com';
const ALLOWED_PAYMENT_HOSTS = new Set([
  'pay.moneyfusion.net',
  'www.pay.moneyfusion.net',
  'api.moneyfusion.net',
  'api.moneyfusion.com',
  'moneyfusion.net',
  'www.moneyfusion.net',
]);

export interface GatewayResult {
  status: number;
  body: Record<string, unknown>;
}

function isPrivateOrInvalidHostname(hostname: string): boolean {
  const host = hostname.trim().toLowerCase();
  if (!host) return true;
  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host === '0.0.0.0' ||
    host.endsWith('.local') ||
    host.endsWith('.internal')
  ) {
    return true;
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    const parts = host.split('.').map(Number);
    if (
      parts[0] === 10 ||
      parts[0] === 127 ||
      parts[0] === 0 ||
      (parts[0] === 169 && parts[1] === 254) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168)
    ) {
      return true;
    }
  }
  return false;
}

function validatePaymentApiUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error('Configuration de passerelle de paiement invalide.');
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('La passerelle de paiement exige HTTPS.');
  }
  const host = parsed.hostname.toLowerCase();
  if (isPrivateOrInvalidHostname(host)) {
    throw new Error('Hôte de passerelle non autorisé.');
  }
  const allowedDomain =
    ALLOWED_PAYMENT_HOSTS.has(host) ||
    host.endsWith('.moneyfusion.net') ||
    host.endsWith('.moneyfusion.com');
  if (!allowedDomain) {
    throw new Error('Domaine de passerelle non autorisé.');
  }
  return parsed;
}

function isEligibleAuthEmail(email?: string): boolean {
  if (!email) return false;
  const lower = email.trim().toLowerCase();
  if (lower === ADMIN_EMAIL) return true;
  const localPart = lower.split('@')[0] || '';
  return ALLOWED_DIAL_PREFIXES.some((prefix) => localPart.startsWith(prefix));
}

async function verifyCallerAuth(
  authHeader: string | undefined
): Promise<{ ok: true; userId: string; email: string } | { ok: false; status: number; message: string }> {
  const supabaseUrl = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim();
  const supabaseKey = (
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    ''
  ).trim();

  if (!supabaseUrl || !supabaseKey) {
    return { ok: true, userId: 'local_session', email: '' };
  }

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { ok: false, status: 401, message: 'Authentification requise pour effectuer un dépôt.' };
  }

  const token = authHeader.slice(7).trim();
  if (!token || token.length < 20) {
    return { ok: false, status: 401, message: 'Session invalide ou expirée.' };
  }

  try {
    const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
      method: 'GET',
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      return { ok: false, status: 401, message: 'Session expirée. Veuillez vous reconnecter.' };
    }

    const user = (await res.json()) as { id?: string; email?: string };
    if (!user?.id || !isEligibleAuthEmail(user.email)) {
      return {
        ok: false,
        status: 403,
        message:
          "Pays non éligible. Seuls le Bénin, le Cameroun, le Burkina Faso, la Côte d'Ivoire, le Sénégal et le Togo sont autorisés.",
      };
    }

    return { ok: true, userId: user.id, email: user.email || '' };
  } catch {
    return { ok: false, status: 502, message: 'Impossible de vérifier votre session pour le moment.' };
  }
}

function sanitizeSafeReturnUrl(rawReturnUrl: unknown, fallbackOrigin: string): string {
  if (typeof rawReturnUrl === 'string' && rawReturnUrl.trim()) {
    try {
      const parsed = new URL(rawReturnUrl.trim());
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
        return parsed.toString();
      }
    } catch {
      // fall through
    }
  }
  return fallbackOrigin || 'https://aureliamobile.africa/';
}

export async function handleInitiateDeposit(params: {
  authHeader?: string;
  body: Record<string, unknown>;
  fallbackOrigin: string;
}): Promise<GatewayResult> {
  const auth = await verifyCallerAuth(params.authHeader);
  if (!auth.ok) {
    return { status: auth.status, body: { ok: false, message: auth.message } };
  }

  const rawPaymentUrl = (process.env.MONEYFUSION_API_URL || '').trim();
  if (!rawPaymentUrl) {
    return {
      status: 503,
      body: {
        ok: false,
        configured: false,
        message:
          'Votre demande de dépôt a été enregistrée. Activez le lien API de paiement côté serveur pour lancer la redirection automatique.',
      },
    };
  }

  let endpointUrl: URL;
  try {
    endpointUrl = validatePaymentApiUrl(rawPaymentUrl);
  } catch (err) {
    return {
      status: 500,
      body: {
        ok: false,
        configured: false,
        message: err instanceof Error ? err.message : 'Passerelle de paiement indisponible.',
      },
    };
  }

  const rawAmount = Number(params.body?.amount);
  const amount = Math.round(rawAmount);
  if (!Number.isFinite(amount) || amount < 500 || amount > 50_000_000) {
    return {
      status: 400,
      body: { ok: false, message: 'Montant de dépôt invalide.' },
    };
  }

  const rawPhone = typeof params.body?.phoneOrAccount === 'string' ? params.body.phoneOrAccount.trim() : '';
  const phoneDigits = rawPhone.replace(/\D/g, '').slice(0, 18);
  if (phoneDigits.length < 7) {
    return {
      status: 400,
      body: { ok: false, message: 'Numéro Mobile Money invalide.' },
    };
  }

  const method =
    typeof params.body?.method === 'string' && params.body.method.trim()
      ? params.body.method.trim().slice(0, 80)
      : 'Mobile Money';

  const txId =
    typeof params.body?.txId === 'string' && /^[a-zA-Z0-9_-]{3,80}$/.test(params.body.txId.trim())
      ? params.body.txId.trim()
      : `dep_${Date.now()}`;

  const returnUrl = sanitizeSafeReturnUrl(params.body?.returnUrl, params.fallbackOrigin);

  const payload = {
    totalPrice: amount,
    article: [
      {
        [`Recharge AURELIA MOBILE (${amount} FCFA)`]: amount,
      },
    ],
    personal_Info: [
      {
        userId: auth.userId,
        txId,
        method,
        phone: rawPhone.slice(0, 40),
      },
    ],
    numeroSend: phoneDigits,
    nomclient: rawPhone.slice(0, 60) || 'Client AURELIA MOBILE',
    return_url: returnUrl,
  };

  try {
    const gatewayRes = await fetch(endpointUrl.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });

    const data = (await gatewayRes.json().catch(() => ({}))) as {
      statut?: boolean;
      status?: string | boolean;
      token?: string;
      tokenPay?: string;
      url?: string;
      message?: string;
    };

    const checkoutRaw = typeof data.url === 'string' ? data.url.trim() : '';
    let safeCheckoutUrl = '';
    if (checkoutRaw) {
      try {
        const parsedCheckout = new URL(checkoutRaw);
        if (parsedCheckout.protocol === 'https:') {
          safeCheckoutUrl = parsedCheckout.toString();
        }
      } catch {
        safeCheckoutUrl = '';
      }
    }

    if (!gatewayRes.ok || !safeCheckoutUrl) {
      return {
        status: 502,
        body: {
          ok: false,
          configured: true,
          message:
            'Impossible de générer la session de paiement pour le moment. Votre demande reste enregistrée.',
        },
      };
    }

    return {
      status: 200,
      body: {
        ok: true,
        configured: true,
        checkoutUrl: safeCheckoutUrl,
        token: typeof data.token === 'string' ? data.token : typeof data.tokenPay === 'string' ? data.tokenPay : '',
      },
    };
  } catch {
    return {
      status: 504,
      body: {
        ok: false,
        configured: true,
        message: 'Délai dépassé lors de la création de la session de paiement.',
      },
    };
  }
}

export async function handleVerifyDeposit(params: {
  authHeader?: string;
  token: string;
}): Promise<GatewayResult> {
  const auth = await verifyCallerAuth(params.authHeader);
  if (!auth.ok) {
    return { status: auth.status, body: { ok: false, message: auth.message } };
  }

  const cleanToken = params.token.trim();
  if (!/^[a-zA-Z0-9_-]{6,128}$/.test(cleanToken)) {
    return { status: 400, body: { ok: false, message: 'Référence de paiement invalide.' } };
  }

  try {
    const verifyRes = await fetch(
      `https://pay.moneyfusion.net/paiementNotif/${encodeURIComponent(cleanToken)}`,
      {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(10000),
      }
    );

    const json = (await verifyRes.json().catch(() => ({}))) as {
      statut?: boolean;
      data?: {
        statut?: string;
        Montant?: number;
        montant?: number;
      };
    };

    const rawStatus = String(json?.data?.statut || '').toLowerCase();
    const status =
      rawStatus === 'paid'
        ? 'paid'
        : rawStatus === 'no paid' || rawStatus === 'failed' || rawStatus === 'failure'
        ? 'failed'
        : 'pending';

    return {
      status: 200,
      body: {
        ok: true,
        status,
        amount: Number(json?.data?.Montant || json?.data?.montant || 0),
      },
    };
  } catch {
    return {
      status: 502,
      body: { ok: false, message: 'Vérification temporairement indisponible.' },
    };
  }
}
