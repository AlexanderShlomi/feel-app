// Single source of truth for order-status presentation in the admin.
//
// These maps were previously duplicated verbatim in
// src/routes/admin/+page.svelte and src/routes/admin/orders/[orderId]/+page.svelte.
// Two copies means a status added in one place silently renders as a raw
// enum string in the other.
//
// NOTE (Law D): this module is PRESENTATION ONLY. The authoritative status
// machine lives in the Supabase RPCs; `admin_update_order_status` validates
// every transition server-side. Anything here is a UI affordance and must
// never be treated as permission to perform a transition.

/** @type {Record<string, string>} */
export const STATUS_LABELS = {
  pending:         'ממתין לתשלום',
  paid:            'שולם',
  processing:      'בעיבוד מקדים',
  ready_for_print: 'מוכן להדפסה',
  printed:         'הודפס',
  shipped:         'נשלח',
  delivered:       'נמסר',
  cancelled:       'בוטל'
};

/** @type {Record<string, string>} */
export const STATUS_COLORS = {
  pending:         '#f5a623',
  paid:            '#4CAF50',
  processing:      '#ff9800',
  ready_for_print: '#4CAF50',
  printed:         '#2196F3',
  shipped:         '#9C27B0',
  delivered:       '#3f524f',
  cancelled:       '#e53935'
};

/**
 * Transitions offered as buttons on the order detail screen.
 *
 * Forward movement through pending -> paid -> processing -> ready_for_print is
 * driven by payment confirmation and the "שחרר להדפסה" action, not from here;
 * this map covers the manual moves plus cancellation.
 *
 * `paid` was missing entirely, so an order sitting in the most common
 * post-payment state showed zero available actions and could not even be
 * cancelled from the UI.
 *
 * @type {Record<string, string[]>}
 */
export const TRANSITIONS = {
  pending:         ['cancelled'],
  paid:            ['cancelled'],
  processing:      ['cancelled'],
  ready_for_print: ['cancelled'],
  printed:         ['shipped', 'cancelled'],
  shipped:         ['delivered', 'cancelled'],
  delivered:       [],
  cancelled:       []
};

/** @type {Record<string, string>} */
export const TRANSITION_LABELS = {
  ready_for_print: 'שחרר להדפסה',
  shipped:         'סמן כנשלח',
  delivered:       'סמן כנמסר',
  cancelled:       'בטל הזמנה'
};

/** Label for a status, falling back to the raw value for unknown enums. */
export function statusLabel(status) {
  return STATUS_LABELS[status] ?? status ?? '—';
}

/** Colour for a status, falling back to a neutral grey. */
export function statusColor(status) {
  return STATUS_COLORS[status] ?? '#757575';
}
