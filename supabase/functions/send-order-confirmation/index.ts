import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { Resend } from 'npm:resend';

type OrderRow = {
  id: string;
  user_id: string;
  status: string;
  order_number?: number | string | null;
  placed_at?: string | null;
  currency?: string | null;
  total_amount?: number | string | null;
  subtotal_amount?: number | string | null;
  discount_amount?: number | string | null;
  coupon_code?: string | null;
  shipping_method?: string | null;
  shipping_amount?: number | string | null;
  gift_enabled?: boolean | null;
  gift_message?: string | null;
  gift_sender_name?: string | null;
  gift_sender_phone?: string | null;
  shipping_first_name?: string | null;
  shipping_last_name?: string | null;
  shipping_city?: string | null;
  shipping_street?: string | null;
  shipping_house_number?: number | null;
  shipping_apartment_number?: number | null;
  shipping_notes?: string | null;
};

type OrderItemRow = {
  title: string | null;
  subtitle: string | null;
  quantity: number | null;
  line_total: number | string | null;
  unit_price: number | string | null;
  thumbnail_url: string | null;
  created_at?: string | null;
};

type WebhookPayload = {
  type?: string;
  table?: string;
  schema?: string;
  record?: OrderRow | null;
  old_record?: OrderRow | null;
};

/** תואם ל־orders/+page — כותרות מקטע */
const COLOR_HEADER_BLUE = '#2F4F6E';
const COLOR_DARK_BLUE = '#1e3a5f';
const COLOR_DARK_GRAY = '#4a4a4a';
const COLOR_MUTED = '#666';
const COLOR_GOLD_BORDER = '#d4c4b0';
const COLOR_CANVAS = '#F2F0EC';
const COLOR_CARD_BG = '#ffffff';

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

function formatDateHe(iso: string | null | undefined): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('he-IL', { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

const STATUS_LABEL: Record<string, string> = {
  pending: 'ממתין לתשלום',
  paid: 'שולם',
  processing: 'בטיפול',
  cancelled: 'בוטל'
};

const SHIPPING_LABEL: Record<string, string> = {
  home_delivery_free: 'משלוח עד הבית'
};

function orderNumberDisplay(o: OrderRow): string {
  const n = o.order_number;
  if (n != null && n !== '') {
    const v = typeof n === 'number' ? n : Number(n);
    if (Number.isFinite(v)) return String(v);
  }
  return '';
}

/** כמו .order-section-title בדף ההזמנות */
function sectionTitleHtml(title: string): string {
  return `<p style="margin:18px 0 10px 0; font-size:13px; font-weight:800; letter-spacing:0.04em; text-transform:uppercase; color:${COLOR_HEADER_BLUE};">${escapeHtml(title)}</p>`;
}

function statusBadgeHtml(status: string): string {
  const label = STATUS_LABEL[status] ?? status;
  let bg = '#f5f0e8';
  let color = COLOR_HEADER_BLUE;
  if (status === 'paid' || status === 'processing') {
    bg = '#e8f5e9';
    color = '#1b5e20';
  } else if (status === 'cancelled') {
    bg = '#fce4ec';
    color = '#880e4f';
  }
  return `<span style="display:inline-block; padding:4px 12px; border-radius:999px; background:${bg}; color:${color}; font-size:13px; font-weight:700; margin-top:8px;">${escapeHtml(label)}</span>`;
}

function shippingLines(o: OrderRow): string[] {
  const lines: string[] = [];
  const name = [o.shipping_first_name, o.shipping_last_name].filter(Boolean).join(' ');
  if (name) lines.push(name);
  const street = o.shipping_street;
  const hn = o.shipping_house_number;
  if (street || hn != null) {
    lines.push([street, hn != null ? String(hn) : ''].filter(Boolean).join(' '));
  }
  if (o.shipping_apartment_number != null) lines.push(`דירה ${o.shipping_apartment_number}`);
  if (o.shipping_city) lines.push(String(o.shipping_city));
  if (o.shipping_notes) lines.push(String(o.shipping_notes));
  return lines;
}

function shippingSectionHtml(o: OrderRow): string {
  const method = o.shipping_method ? SHIPPING_LABEL[o.shipping_method] || o.shipping_method : '';
  const addr = shippingLines(o);
  if (!method && addr.length === 0) return '';

  const inner: string[] = [];
  if (method) {
    inner.push(
      `<div style="font-weight:700; color:${COLOR_DARK_BLUE}; margin-bottom:${addr.length ? '10px' : '0'};">${escapeHtml(method)}</div>`
    );
  }
  for (const line of addr) {
    inner.push(`<div style="margin:0 0 4px 0; color:${COLOR_DARK_GRAY}; font-size:15px;">${escapeHtml(line)}</div>`);
  }

  return `${sectionTitleHtml('משלוח')}
    <div style="background:#F8F6F2; border:1px solid #E8DFD2; border-radius:12px; padding:14px 16px; font-size:15px;">
      ${inner.join('')}
    </div>`;
}

function giftSectionHtml(o: OrderRow): string {
  if (!o.gift_enabled) return '';
  const hasContent = !!(o.gift_message || o.gift_sender_name || o.gift_sender_phone);
  if (!hasContent) {
    return `${sectionTitleHtml('מתנה')}<p style="margin:0; color:${COLOR_MUTED}; font-size:15px;">הזמנה סומנה כמתנה.</p>`;
  }
  const bits: string[] = [
    sectionTitleHtml('מתנה'),
    '<div style="background:#e8f5e9; border:1px solid #c8e6c9; border-radius:12px; padding:14px 16px; font-size:15px;">'
  ];
  if (o.gift_message) bits.push(`<div style="margin:0 0 8px 0; color:${COLOR_DARK_BLUE};">${escapeHtml(o.gift_message)}</div>`);
  if (o.gift_sender_name) {
    bits.push(`<div style="margin:0 0 4px 0; color:${COLOR_DARK_GRAY};"><strong>מאת:</strong> ${escapeHtml(o.gift_sender_name)}</div>`);
  }
  if (o.gift_sender_phone) {
    bits.push(
      `<div style="color:${COLOR_DARK_GRAY};"><strong>טלפון:</strong> <span dir="ltr">${escapeHtml(o.gift_sender_phone)}</span></div>`
    );
  }
  bits.push('</div>');
  return bits.join('');
}

function paymentBreakdownHtml(o: OrderRow): string {
  const sub = num(o.subtotal_amount);
  const disc = num(o.discount_amount);
  const ship = num(o.shipping_amount);
  const total = num(o.total_amount);
  const cur = o.currency || 'ILS';

  const rows: string[] = [];
  rows.push(
    `<tr><td style="padding:6px 0; color:${COLOR_DARK_GRAY};">סכום ביניים</td><td dir="ltr" style="padding:6px 0; text-align:left; font-weight:600;">${formatMoneyILS(sub)}</td></tr>`
  );
  if (disc > 0) {
    rows.push(
      `<tr><td style="padding:6px 0; color:#6d4c41;">הנחה${o.coupon_code ? ` (${escapeHtml(o.coupon_code)})` : ''}</td><td dir="ltr" style="padding:6px 0; text-align:left;">−${formatMoneyILS(disc)}</td></tr>`
    );
  }
  if (ship > 0) {
    rows.push(
      `<tr><td style="padding:6px 0; color:${COLOR_DARK_GRAY};">משלוח</td><td dir="ltr" style="padding:6px 0; text-align:left; font-weight:600;">${formatMoneyILS(ship)}</td></tr>`
    );
  }
  rows.push(
    `<tr><td style="padding:12px 0 6px 0; font-weight:800; color:${COLOR_DARK_BLUE}; border-top:1px solid #E8DFD2;">סה״כ לתשלום</td><td dir="ltr" style="padding:12px 0 6px 0; text-align:left; font-weight:800; border-top:1px solid #E8DFD2; font-size:17px;">${formatMoneyILS(total)}</td></tr>`
  );

  return `${sectionTitleHtml('פירוט תשלום')}
    <table role="presentation" width="100%" style="font-size:15px; margin:0;">
      ${rows.join('')}
    </table>
    <p dir="ltr" style="margin:6px 0 0 0; font-size:12px; font-weight:600; color:${COLOR_MUTED};">${escapeHtml(cur)}</p>`;
}

function itemsSectionHtml(items: OrderItemRow[]): string {
  if (!items.length) {
    return `${sectionTitleHtml('פריטים')}
      <p style="margin:0; color:${COLOR_MUTED}; font-size:15px;">פירוט השורות יופיע בהזמנות שלי באתר.</p>`;
  }

  const blocks = items.map((line, idx) => {
    const title = escapeHtml(line.title || 'פריט');
    const sub = line.subtitle
      ? `<div style="font-size:14px; color:${COLOR_MUTED}; margin-top:3px;">${escapeHtml(line.subtitle)}</div>`
      : '';
    const qty = line.quantity && line.quantity > 1 ? line.quantity : 1;
    const unit = num(line.unit_price);
    const unitStr =
      qty > 1
        ? `<div style="font-size:13px; color:${COLOR_MUTED}; margin-top:5px;">מחיר ליחידה: <span dir="ltr">${formatMoneyILS(unit)}</span></div>`
        : '';
    const lineTotal = formatMoneyILS(num(line.line_total));
    const url = line.thumbnail_url?.trim();
    const bt = idx > 0 ? 'border-top:1px solid rgba(198,178,154,0.28);' : '';
    let thumbCell: string;
    if (url && (url.startsWith('https://') || url.startsWith('http://'))) {
      thumbCell = `<td style="width:76px; vertical-align:top; padding:12px 0; ${bt}">
        <img src="${attrEscape(url)}" alt="" width="64" height="64" style="display:block; border-radius:12px; object-fit:cover; border:1px solid #E8DFD2;" />
      </td>`;
    } else {
      thumbCell = `<td style="width:76px; vertical-align:top; padding:12px 0; ${bt}">
        <div style="width:64px;height:64px;border-radius:12px;background:#f0ebe4;border:1px solid #E8DFD2;"></div>
      </td>`;
    }
    return `<tr>${thumbCell}
        <td style="vertical-align:top; padding:12px 12px 12px 0; text-align:right; ${bt}">
          <div style="font-weight:700; color:${COLOR_DARK_BLUE}; font-size:16px;">${title}</div>
          ${sub}
          ${unitStr}
          <div style="margin-top:8px; font-weight:700; color:${COLOR_HEADER_BLUE};">
            <span dir="ltr">${lineTotal}</span>${qty > 1 ? ` <span style="font-size:14px; font-weight:600;">×${qty}</span>` : ''}
          </div>
        </td>
      </tr>`;
  });

  return `${sectionTitleHtml('פריטים')}
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
      ${blocks.join('')}
    </table>`;
}

function summaryCardHeaderHtml(order: OrderRow): string {
  const pub = orderNumberDisplay(order);
  const orderTitle = pub ? `הזמנה #${escapeHtml(pub)}` : 'הזמנה';
  const placed = formatDateHe(order.placed_at ?? null);
  const total = formatMoneyILS(num(order.total_amount));
  const cur = order.currency || 'ILS';

  return `<table role="presentation" width="100%" style="margin:0 0 4px 0;">
    <tr>
      <td style="vertical-align:top; text-align:right; padding:0 8px 0 0;">
        <div style="font-weight:800; font-size:18px; color:${COLOR_HEADER_BLUE}; letter-spacing:0.02em;">${orderTitle}</div>
        ${placed ? `<div style="font-weight:700; color:${COLOR_DARK_BLUE}; margin-top:8px; font-size:15px;">${escapeHtml(placed)}</div>` : ''}
        ${statusBadgeHtml(order.status)}
      </td>
      <td style="vertical-align:top; text-align:left; width:130px; padding:0;">
        <div style="font-size:11px; font-weight:700; color:${COLOR_MUTED}; text-transform:uppercase; letter-spacing:0.05em;">סה״כ</div>
        <div dir="ltr" style="font-size:26px; font-weight:800; color:${COLOR_DARK_BLUE}; line-height:1.15; margin-top:4px;">${total}</div>
        <div dir="ltr" style="font-size:12px; font-weight:600; color:${COLOR_MUTED}; margin-top:2px;">${escapeHtml(cur)}</div>
      </td>
    </tr>
  </table>
  <div style="border-bottom:1px solid rgba(198,178,154,0.25); margin:16px 0 0 0;"></div>`;
}

function buildRtlEmailHtml(customerName: string, order: OrderRow, items: OrderItemRow[]) {
  return `
  <div dir="rtl" style="font-family: Assistant, Arial, 'Segoe UI', sans-serif; background:${COLOR_CANVAS}; margin:0; padding:24px 16px;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px; margin:0 auto;">
      <tr>
        <td style="background:#1E1E1E; color:#F2F0EC; padding:18px 22px; font-size:20px; font-weight:800; border-radius:16px 16px 0 0;">
          FEEL — אישור הזמנה
        </td>
      </tr>
      <tr>
        <td style="background:${COLOR_CARD_BG}; padding:20px 18px 24px; border:1px solid ${COLOR_GOLD_BORDER}; border-top:none; border-radius:0 0 16px 16px; color:#1E1E1E; line-height:1.65; font-size:16px;">
          <p style="margin:0 0 8px 0;">היי ${escapeHtml(customerName)},</p>
          <p style="margin:0 0 20px 0;">הזמנתך אושרה בהצלחה.</p>

          ${summaryCardHeaderHtml(order)}

          ${itemsSectionHtml(items)}
          ${shippingSectionHtml(order)}
          ${giftSectionHtml(order)}
          ${paymentBreakdownHtml(order)}

          <p style="margin:24px 0 0 0; font-weight:700; color:#3F524F; font-size:16px;">הזיכרונות שלך בדרך לייצור</p>
          <p style="margin:14px 0 0 0; font-size:13px; color:${COLOR_MUTED};">ניתן לצפות בהזמנה בכל עת תחת «ההזמנות שלי» באתר.</p>
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
    const payload = (await req.json()) as WebhookPayload;

    const record = payload.record;
    const oldRecord = payload.old_record;

    if (!record?.id || !record.user_id) {
      return new Response(JSON.stringify({ ok: true, skipped: 'missing_record' }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const becamePaid = record.status === 'paid' && oldRecord?.status !== 'paid';
    if (!becamePaid) {
      return new Response(JSON.stringify({ ok: true, skipped: 'status_not_paid_transition' }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const resendApiKey = Deno.env.get('RESEND_API_KEY');
    const fromEmail = Deno.env.get('ORDER_EMAIL_FROM') ?? 'FEEL <orders@feel-app.example>';

    if (!supabaseUrl || !serviceRoleKey || !resendApiKey) {
      return new Response(JSON.stringify({ error: 'Missing required secrets' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
    const resend = new Resend(resendApiKey);

    const { data: fullOrder, error: orderErr } = await admin
      .from('orders')
      .select(
        [
          'id',
          'user_id',
          'status',
          'order_number',
          'placed_at',
          'currency',
          'total_amount',
          'subtotal_amount',
          'discount_amount',
          'coupon_code',
          'shipping_method',
          'shipping_amount',
          'gift_enabled',
          'gift_message',
          'gift_sender_name',
          'gift_sender_phone',
          'shipping_first_name',
          'shipping_last_name',
          'shipping_city',
          'shipping_street',
          'shipping_house_number',
          'shipping_apartment_number',
          'shipping_notes'
        ].join(', ')
      )
      .eq('id', record.id)
      .maybeSingle();

    const orderForEmail: OrderRow = !orderErr && fullOrder ? (fullOrder as OrderRow) : record;

    const { data: itemRows, error: itemsErr } = await admin
      .from('order_items')
      .select('title, subtitle, quantity, line_total, unit_price, thumbnail_url, created_at')
      .eq('order_id', record.id)
      .order('created_at', { ascending: true });

    const items: OrderItemRow[] = !itemsErr && itemRows ? (itemRows as OrderItemRow[]) : [];

    const { data: userData, error: userErr } = await admin.auth.admin.getUserById(record.user_id);
    if (userErr || !userData?.user?.email) {
      return new Response(JSON.stringify({ error: 'User email not found', details: userErr?.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const customerName = [orderForEmail.shipping_first_name, orderForEmail.shipping_last_name]
      .filter(Boolean)
      .join(' ')
      .trim() || 'לקוח/ה יקר/ה';

    const html = buildRtlEmailHtml(customerName, orderForEmail, items);

    const pub = orderNumberDisplay(orderForEmail);
    const subject = pub ? `אישור הזמנה #${pub} — FEEL` : 'אישור הזמנה — FEEL';

    const { error: mailErr } = await resend.emails.send({
      from: fromEmail,
      to: [userData.user.email],
      subject,
      html
    });

    if (mailErr) {
      return new Response(JSON.stringify({ error: mailErr.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

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
