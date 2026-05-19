// send-shipping-notification — Edge Function
// Called manually from the admin order detail page when clicking
// "שלח מייל משלוח". Sends a Hebrew "ההזמנה בדרך" email via Resend.
//
// Request: POST with { order_id: string } + Authorization: Bearer <user_jwt>
// Security:
//   1) Verifies the caller's JWT is valid (user must be authenticated).
//   2) Checks the caller is in admin_users (via service role client).
//   3) Validates the order exists.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { Resend } from 'npm:resend';

const COLOR_HEADER_BLUE = '#2F4F6E';
const COLOR_DARK_BLUE = '#1e3a5f';
const COLOR_DARK_GRAY = '#4a4a4a';
const COLOR_MUTED = '#666';
const COLOR_GOLD_BORDER = '#d4c4b0';
const COLOR_CANVAS = '#F2F0EC';
const COLOR_CARD_BG = '#ffffff';
const COLOR_TEAL = '#3F524F';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function attrEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function num(v: number | string | null | undefined): number {
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function formatMoneyILS(amount: number): string {
  return `₪${amount.toLocaleString('he-IL', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function sectionTitleHtml(title: string): string {
  return `<p style="margin:18px 0 10px 0; font-size:13px; font-weight:800; letter-spacing:0.04em; text-transform:uppercase; color:${COLOR_HEADER_BLUE};">${escapeHtml(title)}</p>`;
}

function logError(code: string, details: Record<string, unknown>) {
  console.error(JSON.stringify({ level: 'error', scope: 'send-shipping-notification', code, ...details }));
}

function itemsSectionHtml(items: Array<{
  title?: string | null;
  subtitle?: string | null;
  quantity?: number | null;
  line_total?: number | string | null;
  unit_price?: number | string | null;
  thumbnail_url?: string | null;
}>): string {
  if (!items.length) return '';
  const blocks = items.map((line, idx) => {
    const title = escapeHtml(line.title || 'פריט');
    const sub = line.subtitle
      ? `<div style="font-size:14px; color:${COLOR_MUTED}; margin-top:3px;">${escapeHtml(line.subtitle)}</div>`
      : '';
    const qty = (line.quantity ?? 1);
    const lineTotal = formatMoneyILS(num(line.line_total));
    const url = line.thumbnail_url?.trim();
    const bt = idx > 0 ? 'border-top:1px solid rgba(198,178,154,0.28);' : '';
    const thumbCell = (url && (url.startsWith('https://') || url.startsWith('http://')))
      ? `<td style="width:76px; vertical-align:top; padding:12px 0; ${bt}">
           <img src="${attrEscape(url)}" alt="" width="64" height="64" style="display:block; border-radius:12px; object-fit:cover; border:1px solid #E8DFD2;" />
         </td>`
      : `<td style="width:76px; vertical-align:top; padding:12px 0; ${bt}">
           <div style="width:64px;height:64px;border-radius:12px;background:#f0ebe4;border:1px solid #E8DFD2;"></div>
         </td>`;
    return `<tr>${thumbCell}
      <td style="vertical-align:top; padding:12px 12px 12px 0; text-align:right; ${bt}">
        <div style="font-weight:700; color:${COLOR_DARK_BLUE}; font-size:16px;">${title}</div>
        ${sub}
        <div style="margin-top:8px; font-weight:700; color:${COLOR_HEADER_BLUE};">
          <span dir="ltr">${lineTotal}</span>${qty > 1 ? ` <span style="font-size:14px;">×${qty}</span>` : ''}
        </div>
      </td>
    </tr>`;
  });
  return `${sectionTitleHtml('הפריטים שלך')}
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
      ${blocks.join('')}
    </table>`;
}

function buildShippingEmailHtml(opts: {
  customerName: string;
  orderNumber: number | string | null;
  orderTotal: number;
  items: Array<{ title?: string | null; subtitle?: string | null; quantity?: number | null; line_total?: number | string | null; unit_price?: number | string | null; thumbnail_url?: string | null }>;
}): string {
  const { customerName, orderNumber, orderTotal, items } = opts;
  const pub = orderNumber != null && orderNumber !== '' ? String(orderNumber) : '';
  const orderTitle = pub ? `הזמנה #${escapeHtml(pub)}` : 'הזמנה';
  const totalStr = formatMoneyILS(orderTotal);

  return `
  <div dir="rtl" style="font-family: Assistant, Arial, 'Segoe UI', sans-serif; background:${COLOR_CANVAS}; margin:0; padding:24px 16px;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px; margin:0 auto;">
      <tr>
        <td style="background:#1E1E1E; color:#F2F0EC; padding:18px 22px; font-size:20px; font-weight:800; border-radius:16px 16px 0 0;">
          FEEL — ההזמנה שלך בדרך! 🚚
        </td>
      </tr>
      <tr>
        <td style="background:${COLOR_CARD_BG}; padding:20px 18px 28px; border:1px solid ${COLOR_GOLD_BORDER}; border-top:none; border-radius:0 0 16px 16px; color:#1E1E1E; line-height:1.65; font-size:16px;">

          <p style="margin:0 0 8px 0;">היי ${escapeHtml(customerName)},</p>
          <p style="margin:0 0 20px 0; font-size:17px; font-weight:700; color:${COLOR_TEAL};">
            ${orderTitle} שלך יצאה לדרך ועומדת להגיע אליך!
          </p>

          <div style="background:#e8f5e9; border:1px solid #c8e6c9; border-radius:12px; padding:14px 16px; margin-bottom:20px;">
            <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
              <div>
                <div style="font-size:13px; font-weight:700; color:${COLOR_MUTED}; text-transform:uppercase; letter-spacing:0.04em;">מספר הזמנה</div>
                <div style="font-size:22px; font-weight:800; color:${COLOR_DARK_BLUE}; margin-top:4px;">${pub ? '#' + escapeHtml(pub) : '—'}</div>
              </div>
              <div style="text-align:left;">
                <div style="font-size:13px; font-weight:700; color:${COLOR_MUTED}; text-transform:uppercase; letter-spacing:0.04em;">סה"כ</div>
                <div dir="ltr" style="font-size:22px; font-weight:800; color:${COLOR_DARK_BLUE}; margin-top:4px;">${totalStr}</div>
              </div>
            </div>
          </div>

          ${itemsSectionHtml(items)}

          <div style="margin-top:24px; padding:14px 16px; background:#F8F6F2; border:1px solid ${COLOR_GOLD_BORDER}; border-radius:12px;">
            <div style="font-weight:700; color:${COLOR_DARK_BLUE}; font-size:15px; margin-bottom:6px;">המגנטים שלך מודפסים עכשיו 🎞️</div>
            <div style="font-size:14px; color:${COLOR_DARK_GRAY};">
              הפריטים שלך הוכנו בקפידה ונשלחו לכתובת שציינת.
              ניתן לעקוב אחר ההזמנה תחת «ההזמנות שלי» באתר.
            </div>
          </div>

          <p style="margin:20px 0 0 0; font-size:13px; color:${COLOR_MUTED};">
            שאלות? תמיד ניתן לפנות אלינו — נשמח לעזור.
          </p>

        </td>
      </tr>
    </table>
  </div>`;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  try {
    const supabaseUrl     = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const resendApiKey    = Deno.env.get('RESEND_API_KEY');
    const fromEmail       = Deno.env.get('ORDER_EMAIL_FROM') ?? 'FEEL <orders@feel-app.example>';

    if (!supabaseUrl || !serviceRoleKey || !resendApiKey) {
      return new Response(JSON.stringify({ error: 'Missing required secrets' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 1) Verify caller is authenticated — extract JWT from Authorization header.
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    const userJwt = authHeader.slice(7);

    // Create a user-scoped client to verify the JWT.
    const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
      global: { headers: { Authorization: `Bearer ${userJwt}` } },
      auth: { persistSession: false }
    });
    const { data: sessionData, error: sessionErr } = await userClient.auth.getUser();
    if (sessionErr || !sessionData?.user?.id) {
      return new Response(JSON.stringify({ error: 'Invalid or expired token' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    const callerId = sessionData.user.id;

    // 2) Verify caller is an admin (via service role — bypasses RLS on admin_users).
    const adminClient = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
    const { data: adminRow } = await adminClient
      .from('admin_users')
      .select('user_id')
      .eq('user_id', callerId)
      .maybeSingle();

    if (!adminRow) {
      return new Response(JSON.stringify({ error: 'Forbidden — not an admin' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 3) Parse request body.
    const body = await req.json().catch(() => ({}));
    const orderId = typeof body?.order_id === 'string' ? body.order_id.trim() : '';
    if (!orderId) {
      return new Response(JSON.stringify({ error: 'Missing order_id' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 4) Fetch order.
    const { data: fullOrder, error: orderErr } = await adminClient
      .from('orders')
      .select([
        'id', 'user_id', 'status', 'order_number', 'placed_at',
        'total_amount', 'subtotal_amount',
        'shipping_first_name', 'shipping_last_name',
        'shipping_city', 'shipping_street',
        'shipping_house_number', 'shipping_apartment_number', 'shipping_notes'
      ].join(', '))
      .eq('id', orderId)
      .maybeSingle();

    if (orderErr || !fullOrder) {
      logError('order_fetch_failed', { order_id: orderId, caller: callerId, message: orderErr?.message });
      return new Response(JSON.stringify({ error: 'Order not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 5) Fetch items.
    const { data: itemRows } = await adminClient
      .from('order_items')
      .select('title, subtitle, quantity, line_total, unit_price, thumbnail_url, created_at')
      .eq('order_id', orderId)
      .order('created_at', { ascending: true });

    const items = Array.isArray(itemRows) ? itemRows : [];

    // 6) Get user email.
    const { data: userData, error: userErr } = await adminClient.auth.admin.getUserById(fullOrder.user_id);
    if (userErr || !userData?.user?.email) {
      logError('user_email_not_found', { order_id: orderId, user_id: fullOrder.user_id, message: userErr?.message });
      return new Response(JSON.stringify({ error: 'User email not found' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 7) Build and send email.
    const customerName = [fullOrder.shipping_first_name, fullOrder.shipping_last_name]
      .filter(Boolean)
      .join(' ')
      .trim() || 'לקוח/ה יקר/ה';

    const html = buildShippingEmailHtml({
      customerName,
      orderNumber: fullOrder.order_number,
      orderTotal: Number(fullOrder.total_amount ?? 0),
      items
    });

    const pub = fullOrder.order_number != null ? String(fullOrder.order_number) : '';
    const subject = pub ? `הזמנה #${pub} בדרך אליך — FEEL 🚚` : 'ההזמנה שלך בדרך — FEEL 🚚';

    const resend = new Resend(resendApiKey);
    const { error: mailErr } = await resend.emails.send({
      from: fromEmail,
      to: [userData.user.email],
      subject,
      html
    });

    if (mailErr) {
      logError('resend_failed', { order_id: orderId, message: mailErr.message });
      return new Response(JSON.stringify({ error: mailErr.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    console.log(JSON.stringify({
      level: 'info',
      scope: 'send-shipping-notification',
      event: 'email_sent',
      order_id: orderId,
      order_number: fullOrder.order_number,
      caller: callerId
    }));

    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
});
