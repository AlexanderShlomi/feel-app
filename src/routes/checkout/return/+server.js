/**
 * נחיתה חזרה מדף הסליקה של טרנזילה (success_url_address / fail_url_address).
 *
 * טרנזילה שולחת POST עם כל שדות העסקה, כולל ccno ו-TranzilaTK. הנתיב הזה
 * מתעלם מהם לחלוטין: הוא לא כותב לשום מקום ולא מסיק מהם דבר. המעבר של
 * ההזמנה ל-paid נעשה אך ורק ב-tranzila-notify, שמאמת את העסקה מול טרנזילה.
 * מה שמגיע לכאן הוא רמז ניווטי בלבד (Law D).
 *
 * עובד בשני מצבי ההטמעה:
 *   * iframe  — postMessage להורה, שמפעיל את ה-polling ב-checkout
 *   * redirect מלא — ניווט ברמת החלון העליון
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * @param {URL} url
 * @returns {Response}
 */
function renderReturn(url) {
    const rawOrder = url.searchParams.get('order') || '';
    /* רק UUID תקין נכנס ל-HTML — חוסם החדרת סקריפט דרך פרמטר ה-URL. */
    const orderId = UUID_RE.test(rawOrder) ? rawOrder.toLowerCase() : '';
    const success = url.searchParams.get('result') === 'success';

    const target = success && orderId ? `/checkout?resume=${orderId}` : '/checkout?payment=failed';

    const payload = JSON.stringify({
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
  var msg = ${payload};
  try {
    if (window.top && window.top !== window.self) {
      /* ההורה הוא תמיד המקור שלנו — הדף הזה מוגש מאותו דומיין כמו ה-checkout. */
      window.parent.postMessage(msg, window.location.origin);
      return;
    }
  } catch (e) { /* חסימת cross-origin — ממשיכים לניווט מלא */ }
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

/** @type {import('./$types').RequestHandler} */
export async function POST({ url, request }) {
    /* מרוקנים את הגוף כדי לא להשאיר את הבקשה תלויה, בלי לקרוא ממנו דבר. */
    try {
        await request.text();
    } catch {
        /* ignore */
    }
    return renderReturn(url);
}

/** @type {import('./$types').RequestHandler} */
export async function GET({ url }) {
    return renderReturn(url);
}
