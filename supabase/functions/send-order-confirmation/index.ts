import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { Resend } from 'npm:resend';

type OrderRecord = {
  id: string;
  user_id: string;
  status: string;
  shipping_first_name: string | null;
  shipping_last_name: string | null;
};

type WebhookPayload = {
  type?: string;
  table?: string;
  schema?: string;
  record?: OrderRecord | null;
  old_record?: OrderRecord | null;
};

function buildRtlEmailHtml(customerName: string, orderId: string) {
  return `
  <div dir="rtl" style="font-family: Assistant, Arial, sans-serif; background:#F2F0EC; margin:0; padding:24px;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px; margin:0 auto; background:#ffffff; border-radius:16px; overflow:hidden; border:1px solid #e9e3dc;">
      <tr>
        <td style="background:#1E1E1E; color:#F2F0EC; padding:18px 22px; font-size:22px; font-weight:800;">
          FEEL — אישור הזמנה
        </td>
      </tr>
      <tr>
        <td style="padding:22px; color:#1E1E1E; line-height:1.7; font-size:16px;">
          <p style="margin:0 0 10px 0;">היי ${customerName},</p>
          <p style="margin:0 0 10px 0;">הזמנתך אושרה בהצלחה.</p>
          <p style="margin:0 0 14px 0;">
            <strong>מספר הזמנה:</strong>
            <span dir="ltr" style="display:inline-block; background:#F8F6F2; border:1px solid #E8DFD2; border-radius:10px; padding:4px 8px; font-size:14px;">
              ${orderId}
            </span>
          </p>
          <p style="margin:0; font-weight:700; color:#3F524F;">הזיכרונות שלך בדרך לייצור</p>
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

    const { data: userData, error: userErr } = await admin.auth.admin.getUserById(record.user_id);
    if (userErr || !userData?.user?.email) {
      return new Response(JSON.stringify({ error: 'User email not found', details: userErr?.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const customerName = [record.shipping_first_name, record.shipping_last_name]
      .filter(Boolean)
      .join(' ')
      .trim() || 'לקוח/ה יקר/ה';

    const html = buildRtlEmailHtml(customerName, record.id);

    const { error: mailErr } = await resend.emails.send({
      from: fromEmail,
      to: [userData.user.email],
      subject: 'אישור הזמנה - FEEL',
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

