/**
 * tranzila-return
 *
 * The landing page Tranzila sends the customer back to (success_url_address /
 * fail_url_address). Requires `verify_jwt = false`.
 *
 * Why this is not a SvelteKit route: Tranzila returns the customer with a
 * cross-site POST carrying no usable `Origin` header (it arrives as `null`, or
 * absent). SvelteKit's built-in CSRF guard rejects that with
 * "Cross-site POST form submissions are forbidden" before any hook or route
 * handler runs — the check sits at the top of `respond()`, so it cannot be
 * relaxed for one path. The alternatives were to trust `Origin: null`, which
 * every sandboxed iframe on the internet also sends, or to disable CSRF app
 * wide. Both trade away real protection to serve one endpoint that needs none,
 * so the endpoint moved to a surface without that middleware instead.
 *
 * This page decides nothing. It does not read the POST body, touch the
 * database, or infer payment state. The order is moved by `tranzila-notify`
 * alone, after re-verifying the transaction against Tranzila (Law D). All this
 * does is tell the checkout tab to start polling.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Same allowlist rule as tranzila-create-payment — never an open redirect. */
function resolveSiteOrigin(requested: string): string {
  const configured = (Deno.env.get('PUBLIC_SITE_URL') ?? '').trim().replace(/\/+$/, '');
  const candidate = requested.trim().replace(/\/+$/, '');
  if (!candidate) return configured;
  if (configured && candidate === configured) return candidate;
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(candidate)) return candidate;
  return configured;
}

function page(siteOrigin: string, orderId: string, success: boolean): Response {
  const target = success && orderId
    ? `${siteOrigin}/checkout?resume=${orderId}`
    : `${siteOrigin}/checkout?payment=failed`;

  const message = JSON.stringify({
    type: 'feel:payment',
    status: success ? 'success' : 'fail',
    orderId
  });

  const html = `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>מאמתים תשלום…</title>
<style>
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
         background:#F2F0EC; color:#1E1E1E;
         font-family:system-ui,-apple-system,"Segoe UI",Arial,sans-serif; font-weight:800; }
  .box { text-align:center; padding:24px; }
  .dot { width:38px; height:38px; margin:0 auto 14px; border-radius:50%;
         border:4px solid rgba(198,178,154,.35); border-top-color:#C6B29A;
         animation:spin 1s linear infinite; }
  @keyframes spin { to { transform:rotate(360deg); } }
  @media (prefers-reduced-motion:reduce) { .dot { animation:none; } }
</style>
</head>
<body>
<div class="box"><div class="dot"></div><div>מאמתים את התשלום…</div></div>
<script>
(function () {
  var msg = ${message};
  var site = ${JSON.stringify(siteOrigin)};
  try {
    if (window.top && window.top !== window.self) {
      /* Targeted at the checkout origin specifically, never "*" — the message
         must not be readable by any other frame that happens to embed us. */
      window.parent.postMessage(msg, site);
      return;
    }
  } catch (e) { /* fall through to a full navigation */ }
  window.location.replace(${JSON.stringify(target)});
})();
</script>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer'
    }
  });
}

Deno.serve(async (req) => {
  const url = new URL(req.url);

  /* Drain the body so the connection closes cleanly. Deliberately not parsed:
     it carries ccno and may carry a card token, and nothing here needs either. */
  if (req.method === 'POST') {
    try {
      await req.text();
    } catch {
      /* ignore */
    }
  }

  const rawOrder = url.searchParams.get('order') ?? '';
  /* Only a well-formed UUID is interpolated into the page — blocks script
     injection through the query string. */
  const orderId = UUID_RE.test(rawOrder) ? rawOrder.toLowerCase() : '';
  const success = url.searchParams.get('result') === 'success';
  const siteOrigin = resolveSiteOrigin(url.searchParams.get('site') ?? '');

  return page(siteOrigin, orderId, success);
});
