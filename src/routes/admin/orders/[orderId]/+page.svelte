<script>
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { supabase } from '$lib/supabase.js';

  const orderId = $page.params.orderId;

  /** @type {any} */
  let order = null;
  /** @type {any[]} */
  let items = [];
  let loading = true;
  let error = '';
  let statusLoading = false;
  let statusMsg = '';
  let emailLoading = false;
  let emailMsg = '';

  const STATUS_LABELS = {
    pending:    'ממתין לתשלום',
    paid:       'שולם',
    processing: 'בטיפול',
    shipped:    'נשלח',
    delivered:  'נמסר',
    cancelled:  'בוטל'
  };

  const STATUS_COLORS = {
    pending:    '#f5a623',
    paid:       '#4CAF50',
    processing: '#2196F3',
    shipped:    '#9C27B0',
    delivered:  '#3f524f',
    cancelled:  '#e53935'
  };

  // Valid admin transitions
  const TRANSITIONS = {
    paid:       ['processing', 'cancelled'],
    processing: ['shipped',    'cancelled'],
    shipped:    ['delivered',  'cancelled'],
    delivered:  [],
    cancelled:  []
  };

  const TRANSITION_LABELS = {
    processing: 'העבר לעיבוד',
    shipped:    'סמן כנשלח',
    delivered:  'סמן כנמסר',
    cancelled:  'בטל הזמנה'
  };

  async function loadDetail() {
    loading = true;
    error = '';
    const { data, error: rpcErr } = await supabase.rpc('admin_get_order_detail', {
      p_order_id: orderId
    });
    if (rpcErr) {
      error = 'שגיאה בטעינת ההזמנה.';
      loading = false;
      return;
    }
    order = data?.order ?? null;
    items = Array.isArray(data?.items) ? data.items : [];
    loading = false;
  }

  onMount(loadDetail);

  async function updateStatus(newStatus) {
    if (!confirm(`לשנות סטטוס ל"${STATUS_LABELS[newStatus]}"?`)) return;
    statusLoading = true;
    statusMsg = '';
    const { data, error: rpcErr } = await supabase.rpc('admin_update_order_status', {
      p_order_id: orderId,
      p_new_status: newStatus
    });
    if (rpcErr) {
      statusMsg = `שגיאה: ${rpcErr.message}`;
    } else {
      order = { ...order, status: data?.status ?? newStatus };
      statusMsg = `✓ סטטוס עודכן ל"${STATUS_LABELS[newStatus]}"`;
    }
    statusLoading = false;
  }

  async function sendShippingEmail() {
    if (!confirm('לשלוח מייל "ההזמנה בדרך" ללקוח?')) return;
    emailLoading = true;
    emailMsg = '';
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token ?? '';
      const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
      const res = await fetch(`${supabaseUrl}/functions/v1/send-shipping-notification`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ order_id: orderId })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        emailMsg = `שגיאה בשליחת מייל: ${body?.error ?? res.status}`;
      } else {
        emailMsg = '✓ מייל משלוח נשלח ללקוח';
      }
    } catch (e) {
      emailMsg = 'שגיאת רשת — נסה שוב';
    }
    emailLoading = false;
  }

  function formatDate(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString('he-IL', { dateStyle: 'medium', timeStyle: 'short' });
    } catch { return iso; }
  }

  function configSummary(cfg) {
    if (!cfg || typeof cfg !== 'object') return '';
    const parts = [];
    if (cfg.count) parts.push(`${cfg.count} יחידות`);
    const effect = cfg.settingsMeta?.currentEffect ?? cfg.effectId;
    if (effect && effect !== 'original') parts.push(`אפקט: ${effect}`);
    return parts.join(' · ');
  }
</script>

<svelte:head>
  <title>FEEL Admin — הזמנה {order?.order_number ?? ''}</title>
</svelte:head>

<div class="admin-page">
  <a href="/admin" class="back-link">← כל ההזמנות</a>

  {#if loading}
    <p class="admin-hint">טוען…</p>
  {:else if error}
    <p class="admin-error">{error}</p>
  {:else if order}
    <div class="order-header">
      <div>
        <h1 class="order-title">הזמנה #{order.order_number}</h1>
        <span class="status-badge"
          style="background:{STATUS_COLORS[order.status]}22; color:{STATUS_COLORS[order.status]}; border-color:{STATUS_COLORS[order.status]}44;">
          {STATUS_LABELS[order.status] ?? order.status}
        </span>
      </div>
      <p class="order-date">{formatDate(order.placed_at)}</p>
    </div>

    <!-- Actions -->
    <div class="section">
      <h2 class="section-title">פעולות</h2>
      <div class="actions-row">
        {#each TRANSITIONS[order.status] ?? [] as nextStatus}
          <button
            class="admin-btn {nextStatus === 'cancelled' ? 'admin-btn--danger' : ''}"
            disabled={statusLoading}
            on:click={() => updateStatus(nextStatus)}>
            {TRANSITION_LABELS[nextStatus]}
          </button>
        {/each}
        {#if order.status === 'shipped' || order.status === 'processing'}
          <button class="admin-btn admin-btn--secondary" disabled={emailLoading} on:click={sendShippingEmail}>
            {emailLoading ? 'שולח…' : '📧 שלח מייל "ההזמנה בדרך"'}
          </button>
        {/if}
      </div>
      {#if statusMsg}<p class="msg {statusMsg.startsWith('✓') ? 'msg--ok' : 'msg--err'}">{statusMsg}</p>{/if}
      {#if emailMsg}<p class="msg {emailMsg.startsWith('✓') ? 'msg--ok' : 'msg--err'}">{emailMsg}</p>{/if}
    </div>

    <!-- Shipping -->
    <div class="section">
      <h2 class="section-title">פרטי משלוח</h2>
      <div class="info-grid">
        <div class="info-row"><span class="info-label">שם</span><span>{order.shipping_first_name} {order.shipping_last_name}</span></div>
        <div class="info-row"><span class="info-label">כתובת</span><span>{order.shipping_street} {order.shipping_house_number}{order.shipping_apartment_number ? '/' + order.shipping_apartment_number : ''}, {order.shipping_city}</span></div>
        {#if order.shipping_notes}<div class="info-row"><span class="info-label">הערות</span><span>{order.shipping_notes}</span></div>{/if}
      </div>
    </div>

    <!-- Gift -->
    {#if order.gift_enabled}
      <div class="section">
        <h2 class="section-title">מתנה 🎁</h2>
        <div class="info-grid">
          {#if order.gift_message}<div class="info-row"><span class="info-label">הודעה</span><span>{order.gift_message}</span></div>{/if}
          {#if order.gift_sender_name}<div class="info-row"><span class="info-label">שולח</span><span>{order.gift_sender_name}</span></div>{/if}
          {#if order.gift_sender_phone}<div class="info-row"><span class="info-label">טלפון</span><span>{order.gift_sender_phone}</span></div>{/if}
        </div>
      </div>
    {/if}

    <!-- Items -->
    <div class="section">
      <h2 class="section-title">פריטים</h2>
      <div class="items-list">
        {#each items as item}
          <div class="item-card">
            {#if item.thumbnail_url}
              <img class="item-thumb" src={item.thumbnail_url} alt={item.title} loading="lazy" />
            {:else}
              <div class="item-thumb item-thumb--placeholder">📷</div>
            {/if}
            <div class="item-info">
              <p class="item-title">{item.title ?? '—'}</p>
              <p class="item-sub">{item.subtitle ?? ''}</p>
              <p class="item-meta">{configSummary(item.configuration)}</p>
            </div>
            <div class="item-price">₪{Number(item.line_total || 0).toLocaleString('he-IL')}</div>
          </div>
        {/each}
      </div>
    </div>

    <!-- Totals -->
    <div class="section section--totals">
      <h2 class="section-title">תשלום</h2>
      <div class="info-grid">
        <div class="info-row"><span class="info-label">סכום ביניים</span><span>₪{Number(order.subtotal_amount || 0).toLocaleString('he-IL')}</span></div>
        <div class="info-row"><span class="info-label">משלוח</span><span>₪{Number(order.shipping_amount || 0).toLocaleString('he-IL')}</span></div>
        <div class="info-row info-row--total"><span class="info-label">סה"כ</span><span class="total-amount">₪{Number(order.total_amount || 0).toLocaleString('he-IL')}</span></div>
      </div>
    </div>
  {/if}
</div>

<style>
  .admin-page { max-width: 860px; margin: 0 auto; }

  .back-link {
    display: inline-block;
    margin-bottom: 20px;
    color: #3f524f;
    text-decoration: none;
    font-size: 14px;
  }
  .back-link:hover { text-decoration: underline; }

  .order-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    margin-bottom: 24px;
    flex-wrap: wrap;
    gap: 8px;
  }

  .order-title {
    font-size: 24px;
    font-weight: 800;
    color: #1e1e1e;
    margin: 0 0 6px;
  }

  .order-date { color: #888; font-size: 13px; margin: 0; }

  .status-badge {
    display: inline-block;
    padding: 4px 12px;
    border-radius: 12px;
    font-size: 13px;
    font-weight: 700;
    border: 1px solid transparent;
  }

  .section {
    background: #fff;
    border-radius: 10px;
    padding: 20px;
    margin-bottom: 16px;
    box-shadow: 0 1px 4px rgba(0,0,0,0.07);
  }

  .section-title {
    font-size: 13px;
    font-weight: 800;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: #3f524f;
    margin: 0 0 14px;
  }

  .actions-row {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
    align-items: center;
  }

  .admin-btn {
    background: #3f524f;
    color: #fff;
    border: none;
    border-radius: 6px;
    padding: 8px 18px;
    font-size: 14px;
    cursor: pointer;
    transition: opacity 0.15s;
  }
  .admin-btn:hover:not(:disabled) { opacity: 0.85; }
  .admin-btn:disabled { opacity: 0.4; cursor: default; }

  .admin-btn--danger {
    background: #e53935;
  }

  .admin-btn--secondary {
    background: #C6B29A;
    color: #1e1e1e;
  }

  .msg {
    font-size: 13px;
    margin: 10px 0 0;
    padding: 6px 10px;
    border-radius: 6px;
  }
  .msg--ok { background: #e8f5e9; color: #2e7d32; }
  .msg--err { background: #ffeaea; color: #c62828; }

  .info-grid { display: flex; flex-direction: column; gap: 8px; }

  .info-row {
    display: flex;
    gap: 12px;
    font-size: 14px;
    align-items: baseline;
  }

  .info-label {
    font-weight: 700;
    color: #3f524f;
    min-width: 80px;
    flex-shrink: 0;
  }

  .info-row--total { margin-top: 8px; border-top: 1px solid #f0ede9; padding-top: 10px; }

  .total-amount { font-size: 18px; font-weight: 800; color: #1e1e1e; }

  .items-list { display: flex; flex-direction: column; gap: 16px; }

  .item-card {
    display: flex;
    gap: 16px;
    align-items: flex-start;
    border-bottom: 1px solid #f0ede9;
    padding-bottom: 16px;
  }
  .item-card:last-child { border-bottom: none; padding-bottom: 0; }

  .item-thumb {
    width: 72px;
    height: 72px;
    object-fit: cover;
    border-radius: 6px;
    flex-shrink: 0;
    border: 1px solid #e0ddd8;
  }

  .item-thumb--placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 28px;
    background: #f5f0e8;
    border: 1px dashed #c6b29a;
  }

  .item-info { flex: 1; min-width: 0; }
  .item-title { font-weight: 700; font-size: 15px; margin: 0 0 3px; color: #1e1e1e; }
  .item-sub { font-size: 13px; color: #666; margin: 0 0 4px; }
  .item-meta { font-size: 12px; color: #888; margin: 0 0 8px; }

  .item-price {
    font-weight: 700;
    font-size: 15px;
    color: #3f524f;
    white-space: nowrap;
    padding-top: 2px;
  }





  .admin-hint { color: #888; font-size: 14px; text-align: center; padding: 40px 0; margin: 0; }
  .admin-error { color: #e53935; font-size: 14px; padding: 12px; background: #ffeaea; border-radius: 6px; }
</style>
