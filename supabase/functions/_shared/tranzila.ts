/**
 * Shared Tranzila helpers (Law D — secrets stay server-side).
 *
 * Nothing in this file may be imported by client code: it reads
 * TRANZILA_APP_KEY / TRANZILA_SECRET from the Edge Function environment.
 */

export const HANDSHAKE_URL = 'https://api.tranzila.com/v2/handshake/create';
export const REPORTS_TXN_URL = 'https://report.tranzila.com/v1/transaction';
export const IFRAME_BASE = 'https://directng.tranzila.com';

/** ILS. Tranzila currency codes: 1=ILS, 2=USD, 978=EUR, 826=GBP. */
export const CURRENCY_ILS = '1';

export type TranzilaConfig = {
  terminal: string;
  appKey: string;
  secret: string;
};

export function readTranzilaConfig(): TranzilaConfig {
  const terminal = Deno.env.get('TRANZILA_TERMINAL');
  const appKey = Deno.env.get('TRANZILA_APP_KEY');
  const secret = Deno.env.get('TRANZILA_SECRET');
  if (!terminal || !appKey || !secret) {
    throw new Error('missing_tranzila_secrets');
  }
  return { terminal, appKey, secret };
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** 40-character random nonce, per the Tranzila auth spec. */
function randomNonce(): string {
  return toHex(crypto.getRandomValues(new Uint8Array(20)));
}

async function hmacSha256Hex(key: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(message));
  return toHex(new Uint8Array(sig));
}

/**
 * Tranzila API authentication headers.
 *
 * The access token is `hash_hmac('sha256', app_key, secret + request_time + nonce)`
 * — i.e. the APP KEY is the signed message and the concatenation is the HMAC key.
 * Getting these two the wrong way round yields a valid-looking hash that the API
 * always rejects, so keep the argument order explicit.
 */
export async function tranzilaAuthHeaders(cfg: TranzilaConfig): Promise<Record<string, string>> {
  const requestTime = Math.floor(Date.now() / 1000).toString();
  const nonce = randomNonce();
  const accessToken = await hmacSha256Hex(cfg.secret + requestTime + nonce, cfg.appKey);

  return {
    'Content-Type': 'application/json',
    'X-tranzila-api-app-key': cfg.appKey,
    'X-tranzila-api-request-time': requestTime,
    'X-tranzila-api-nonce': nonce,
    'X-tranzila-api-access-token': accessToken
  };
}

/**
 * Handshake V2 — locks the amount server-side before the customer ever sees the
 * payment page. If the `sum` on the checkout page does not match the amount
 * registered here, Tranzila blocks the transaction (error 912791).
 *
 * The returned token is valid for 20 minutes.
 */
export async function createHandshakeToken(cfg: TranzilaConfig, sum: number): Promise<string> {
  const headers = await tranzilaAuthHeaders(cfg);

  /* Only the two documented required fields.
     `sum` must be a JSON NUMBER — sending the formatted string "119.00" is
     rejected with error 20004 ("Json does not match validation schema"), which
     is a body-shape error, not an auth error.
     `request_params` is optional and omitted deliberately: we already correlate
     the transaction through our own order id in the notify URL, so passing
     extra keys only adds schema surface that can fail. */
  const payload = {
    terminal_name: cfg.terminal,
    sum: Number(sum.toFixed(2))
  };

  const res = await fetch(HANDSHAKE_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload)
  });

  const raw = await res.text();
  let body: Record<string, unknown> | null = null;
  try {
    body = JSON.parse(raw);
  } catch {
    body = null;
  }

  if (!res.ok) {
    console.error('[tranzila] handshake http error', { status: res.status, body: raw.slice(0, 400) });
    throw new Error(`handshake_http_${res.status}`);
  }

  if (!body || Number(body.error_code) !== 0 || !body.thtk) {
    /* Log the whole response: field-level validation detail lives here and it
       is the only way to tell a schema problem from a terminal-config one.
       The response carries no secrets — the request did, and that is not
       logged. Nothing from here reaches the client (Law D). */
    console.error('[tranzila] handshake rejected', {
      sent_sum: payload.sum,
      sent_terminal: payload.terminal_name,
      response: raw.slice(0, 600)
    });
    throw new Error('handshake_rejected');
  }

  return String(body.thtk);
}

export type VerifiedTransaction = {
  index: number;
  amount: number;
  currency: string | number | null;
  responseCode: string;
  approved: boolean;
  /** Last 4 digits only — display data, never the PAN. */
  cardLast4: string | null;
  cardBrand: string | null;
};

/**
 * Tranzila `cardtype` codes.
 * The reports API sometimes returns the code, sometimes a name — handle both.
 */
const CARD_BRANDS: Record<string, string> = {
  '1': 'Mastercard',
  '2': 'Visa',
  '3': 'Diners',
  '4': 'American Express',
  '5': 'Isracard',
  '6': 'Maestro'
};

export function resolveCardBrand(value: unknown): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  if (CARD_BRANDS[raw]) return CARD_BRANDS[raw];
  // Already a name — pass it through, bounded.
  return /^[A-Za-z ]{2,24}$/.test(raw) ? raw : null;
}

/**
 * Pull the last 4 digits out of whatever shape the field arrives in: bare
 * "1234", or a masked PAN like "4580********1234".
 *
 * Returns null unless the result is exactly 4 digits — so a full PAN can never
 * be mistaken for a last-4 and stored.
 */
export function resolveCardLast4(value: unknown): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 4) return null;
  return digits.slice(-4);
}

/**
 * Re-fetch a transaction from Tranzila's reports API.
 *
 * This is the load-bearing security step: the notify callback carries no
 * signature, so the POST body is treated purely as a pointer ("look at
 * transaction N") and every value that matters is read back from here.
 */
export async function fetchTransaction(
  cfg: TranzilaConfig,
  transactionIndex: number
): Promise<VerifiedTransaction | null> {
  const headers = await tranzilaAuthHeaders(cfg);
  const res = await fetch(REPORTS_TXN_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      terminal_name: cfg.terminal,
      transaction_index: transactionIndex
    })
  });

  if (!res.ok) {
    throw new Error(`reports_http_${res.status}`);
  }

  const body = await res.json().catch(() => null);
  const row = Array.isArray(body?.transactions)
    ? body.transactions[0]
    : Array.isArray(body?.data)
      ? body.data[0]
      : (body?.transaction ?? null);

  if (!row) return null;

  const responseCode = String(
    row.processor_response_code ?? row.Response ?? row.response ?? ''
  ).trim();

  return {
    index: Number(row.index ?? row.transaction_index ?? transactionIndex),
    amount: Number(row.amount ?? row.sum ?? NaN),
    currency: row.currency ?? null,
    responseCode,
    // Tranzila approves with '000'; the field is sometimes zero-padded, sometimes not.
    approved: responseCode === '000' || responseCode === '0',
    cardLast4: resolveCardLast4(
      row.card_number ?? row.ccno ?? row.credit_card_number ?? row.card_last4
    ),
    cardBrand: resolveCardBrand(row.card_type ?? row.cardtype ?? row.card_brand)
  };
}

/** Tranzila reports ILS as code 1; the orders table stores the ISO string. */
export function currencyCodeToIso(code: string | number | null | undefined): string {
  const c = String(code ?? '').trim();
  if (c === '1' || c.toUpperCase() === 'ILS') return 'ILS';
  if (c === '2' || c.toUpperCase() === 'USD') return 'USD';
  if (c === '978' || c.toUpperCase() === 'EUR') return 'EUR';
  if (c === '826' || c.toUpperCase() === 'GBP') return 'GBP';
  return c.toUpperCase();
}
