<script>
  import { onMount } from 'svelte';
  import { supabase } from '$lib/supabase.js';

  /** @type {any[]} */
  let orders = [];
  let loading = true;
  let error = '';
  let filterStatus = '';
  let page = 0;
  const PAGE_SIZE = 50;
  let hasMore = false;

  const STATUS_LABELS = {
    pending:         'ממתין לתשלום',
    paid:            'שולם',
    processing:      'בעיבוד מקדים',
    ready_for_print: 'מוכן להדפסה',
    printed:         'הודפס',
    shipped:         'נשלח',
    delivered:       'נמסר',
    cancelled:       'בוטל'
  };

  const STATUS_COLORS = {
    pending:         '#f5a623',
    paid:            '#4CAF50',
    processing:      '#ff9800',
    ready_for_print: '#4CAF50',
    printed:         '#2196F3',
    shipped:         '#9C27B0',
    delivered:       '#3f524f',
    cancelled:       '#e53935'
  };

  async function loadOrders() {
    loading = true;
    error = '';
    const { data, error: rpcErr } = await supabase.rpc('admin_get_orders', {
      p_limit:  PAGE_SIZE + 1,
      p_offset: page * PAGE_SIZE,
      p_status: filterStatus || null
    });
    if (rpcErr) {
      error = 'שגיאה בטעינת ההזמנות.';
      loading = false;
      return;
    }
    const list = Array.isArray(data) ? data : [];
    hasMore = list.length > PAGE_SIZE;
    orders = list.slice(0, PAGE_SIZE);
    loading = false;
  }

  onMount(() => { loadOrders(); });

  function formatDate(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' });
    } catch { return iso; }
  }

  function handleFilterChange() {
    page = 0;
    loadOrders();
  }

  function prevPage() { if (page > 0) { page--; loadOrders(); } }
  function nextPage() { if (hasMore) { page++; loadOrders(); } }
</script>

<svelte:head>
  <title>FEEL Admin — הזמנות</title>
</svelte:head>

<div class="admin-page">
  <div class="admin-page-header">
    <h1 class="admin-page-title">הזמנות</h1>
    <div class="admin-filters">
      <select bind:value={filterStatus} on:change={handleFilterChange} class="admin-select">
        <option value="">כל הסטטוסים</option>
        {#each Object.entries(STATUS_LABELS) as [val, label]}
          <option value={val}>{label}</option>
        {/each}
      </select>
      <button class="admin-btn admin-btn--ghost" on:click={loadOrders}>רענן</button>
    </div>
  </div>

  {#if loading}
    <p class="admin-hint">טוען…</p>
  {:else if error}
    <p class="admin-error">{error}</p>
  {:else if orders.length === 0}
    <p class="admin-hint">אין הזמנות להצגה.</p>
  {:else}
    <div class="admin-table-wrap">
      <table class="admin-table">
        <thead>
          <tr>
            <th>#הזמנה</th>
            <th>סטטוס</th>
            <th>לקוח</th>
            <th>עיר</th>
            <th>פריטים</th>
            <th>סה"כ</th>
            <th>מתנה</th>
            <th>ברכה</th>
            <th>תאריך</th>
          </tr>
        </thead>
        <tbody>
          {#each orders as o}
            <tr
              class="admin-row"
              role="link"
              tabindex="0"
              on:click={() => window.location.href = `/admin/orders/${o.id}`}
              on:keydown={(e) => e.key === 'Enter' && (window.location.href = `/admin/orders/${o.id}`)}
            >
              <td class="admin-cell admin-cell--num">#{o.order_number ?? '—'}</td>
              <td class="admin-cell">
                <span class="status-badge" style="background:{STATUS_COLORS[o.status]}22; color:{STATUS_COLORS[o.status]}; border-color:{STATUS_COLORS[o.status]}44;">
                  {STATUS_LABELS[o.status] ?? o.status}
                </span>
              </td>
              <td class="admin-cell">{o.shipping_first_name ?? ''} {o.shipping_last_name ?? ''}</td>
              <td class="admin-cell">{o.shipping_city ?? '—'}</td>
              <td class="admin-cell admin-cell--center">{o.item_count ?? 0}</td>
              <td class="admin-cell">₪{Number(o.total_amount || 0).toLocaleString('he-IL')}</td>
              <td class="admin-cell admin-cell--center">
                {#if o.has_gift_item}
                  <span class="extra-badge extra-badge--gift" title="מתנה — מגנט נוסף">🎁</span>
                {:else}
                  —
                {/if}
              </td>
              <td class="admin-cell admin-cell--center">
                {#if o.gift_message}
                  <span class="extra-badge extra-badge--greeting" title="ברכה — טקסט להדפסה">✉️</span>
                {:else}
                  —
                {/if}
              </td>
              <td class="admin-cell admin-cell--date">{formatDate(o.placed_at)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    <div class="admin-pagination">
      <button class="admin-btn" on:click={prevPage} disabled={page === 0}>הקודם</button>
      <span class="admin-hint">עמוד {page + 1}</span>
      <button class="admin-btn" on:click={nextPage} disabled={!hasMore}>הבא</button>
    </div>
  {/if}
</div>

<style>
  .admin-page { max-width: 1100px; margin: 0 auto; }

  .admin-page-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 20px;
    flex-wrap: wrap;
    gap: 12px;
  }

  .admin-page-title {
    font-size: 22px;
    font-weight: 800;
    color: #1e1e1e;
    margin: 0;
  }

  .admin-filters {
    display: flex;
    gap: 10px;
    align-items: center;
  }

  .admin-select {
    border: 1px solid #ccc;
    border-radius: 6px;
    padding: 6px 10px;
    font-size: 14px;
    background: #fff;
  }

  .admin-btn {
    background: #3f524f;
    color: #fff;
    border: none;
    border-radius: 6px;
    padding: 7px 16px;
    font-size: 14px;
    cursor: pointer;
    transition: opacity 0.15s;
  }

  .admin-btn:hover:not(:disabled) { opacity: 0.85; }
  .admin-btn:disabled { opacity: 0.4; cursor: default; }

  .admin-btn--ghost {
    background: transparent;
    color: #3f524f;
    border: 1px solid #3f524f;
  }

  .admin-table-wrap {
    overflow-x: auto;
    background: #fff;
    border-radius: 10px;
    box-shadow: 0 1px 4px rgba(0,0,0,0.08);
  }

  .admin-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 14px;
    text-align: right;
  }

  .admin-table th {
    background: #f2f0ec;
    padding: 10px 14px;
    font-weight: 700;
    color: #3f524f;
    border-bottom: 1px solid #e0ddd8;
    white-space: nowrap;
  }

  .admin-row { cursor: pointer; }
  .admin-row:hover { background: #f0ede9; }
  .admin-row:focus { outline: 2px solid #3f524f; outline-offset: -2px; background: #f0ede9; }

  .admin-cell {
    padding: 10px 14px;
    border-bottom: 1px solid #f0ede9;
    color: #1e1e1e;
    white-space: nowrap;
  }

  .admin-cell--num { font-weight: 700; color: #3f524f; }
  .admin-cell--center { text-align: center; }
  .admin-cell--date { color: #666; font-size: 13px; }

  .status-badge {
    display: inline-block;
    padding: 3px 10px;
    border-radius: 12px;
    font-size: 12px;
    font-weight: 700;
    border: 1px solid transparent;
  }

.admin-pagination {
    display: flex;
    align-items: center;
    gap: 14px;
    justify-content: center;
    margin-top: 20px;
  }

  .admin-hint {
    color: #888;
    font-size: 14px;
    text-align: center;
    padding: 24px 0;
    margin: 0;
  }

  .admin-error {
    color: #e53935;
    font-size: 14px;
    padding: 12px;
    background: #ffeaea;
    border-radius: 6px;
  }

  .extra-badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 11px;
    font-weight: 700;
    margin: 1px 2px;
    white-space: nowrap;
  }

  .extra-badge--gift {
    background: #fff3e0;
    color: #e65100;
    border: 1px solid #ffcc80;
  }

  .extra-badge--greeting {
    background: #e8f5e9;
    color: #2e7d32;
    border: 1px solid #a5d6a7;
  }
</style>
