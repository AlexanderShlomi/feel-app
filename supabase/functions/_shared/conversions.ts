/**
 * Server-side conversion reporting (Law E).
 *
 * Why this exists: the browser-side `purchase` event on the success page is lost
 * whenever an ad-blocker, ITP, or a closed tab gets in the way — typically a
 * double-digit share of real conversions. This fires the same event from the
 * server, at the only moment we are certain money moved: the verified notify.
 *
 * Dedup: GA4 collapses `purchase` events that share a `transaction_id`, so both
 * copies use the order UUID — exactly what the success page sends.
 *
 * Consent: never inferred. The snapshot captured at checkout is read back from
 * `orders.analytics_consent`; no snapshot means no send.
 *
 * PII: the payload carries value, currency and item types only. No email, no
 * name, no address, no card data.
 */

export type ConsentSnapshot = {
  analytics?: boolean;
  ads?: boolean;
  ga_client_id?: string;
} | null;

export type PurchaseItem = {
  item_id: string;
  item_name: string;
  price: number;
  quantity: number;
};

export type PurchasePayload = {
  transactionId: string;
  value: number;
  currency: string;
  items: PurchaseItem[];
};

const GA4_ENDPOINT = 'https://www.google-analytics.com/mp/collect';

/**
 * Fire the GA4 Measurement Protocol `purchase`.
 *
 * Returns a short status string for logging — this is best-effort telemetry and
 * must never affect whether an order is treated as paid.
 */
export async function sendGa4Purchase(
  consent: ConsentSnapshot,
  payload: PurchasePayload
): Promise<string> {
  if (!consent?.analytics) return 'skipped_no_consent';

  const measurementId = Deno.env.get('GA4_MEASUREMENT_ID');
  const apiSecret = Deno.env.get('GA4_API_SECRET');
  if (!measurementId || !apiSecret) return 'skipped_not_configured';

  /* GA4 requires a client_id to attach the event to a session. The browser one
     is captured at checkout; without it the event would land as a detached
     session and pollute attribution, so we skip instead. */
  const clientId = consent.ga_client_id;
  if (!clientId) return 'skipped_no_client_id';

  const body = {
    client_id: clientId,
    non_personalized_ads: !consent.ads,
    events: [
      {
        name: 'purchase',
        params: {
          transaction_id: payload.transactionId,
          value: payload.value,
          currency: payload.currency,
          items: payload.items
        }
      }
    ]
  };

  const url = `${GA4_ENDPOINT}?measurement_id=${encodeURIComponent(
    measurementId
  )}&api_secret=${encodeURIComponent(apiSecret)}`;

  try {
    const res = await fetch(url, { method: 'POST', body: JSON.stringify(body) });
    // MP answers 204 on success and does not validate the payload; use the
    // /debug/mp/collect endpoint manually when tuning.
    return res.ok ? 'sent' : `http_${res.status}`;
  } catch (err) {
    return `error_${(err as Error)?.name ?? 'unknown'}`;
  }
}

/** Parse the consent snapshot defensively — it is free-form jsonb. */
export function readConsent(raw: unknown): ConsentSnapshot {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  return {
    analytics: o.analytics === true,
    ads: o.ads === true,
    ga_client_id: typeof o.ga_client_id === 'string' ? o.ga_client_id : undefined
  };
}
