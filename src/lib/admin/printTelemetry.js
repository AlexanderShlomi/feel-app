// Operational telemetry for the admin print workflow (Law E).
//
// Two sinks, deliberately:
//   1. `admin_print_events` in Postgres — the source of truth. Admin events are
//      staff/operational, not marketing, so they are not consent-gated, and
//      they must survive an ad-blocker: the headline metric here is "how often
//      is a batch blocked because an original never uploaded", and a blocked
//      beacon would report that as zero, i.e. as "the problem went away".
//   2. `trackEvent` — mirrored to GA4 when analytics happen to be configured
//      and consented, so the print funnel sits next to everything else. It
//      no-ops silently otherwise.
//
// NO PII in any payload: counts, reason codes, booleans. Never order numbers,
// customer names or storage paths.

import { supabase } from '$lib/supabase.js';
import { trackEvent } from '$lib/analytics.js';

/**
 * Event names. Must stay in sync with the allowlist in
 * supabase/migrations/20260730000200_admin_print_events.sql — the RPC rejects
 * anything else rather than accepting unbounded cardinality.
 */
export const PRINT_EVENTS = {
  BATCH_SENT: 'print_batch_sent',
  BLOCKED_BY_ISSUES: 'print_blocked_by_issues',
  OVERRIDE_USED: 'print_override_used',
  MARK_PARTIAL: 'print_mark_partial',
  URLS_EXPIRED: 'print_urls_expired'
};

/** Best-effort UUID; crypto.randomUUID is unavailable on insecure origins. */
function eventId() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch {
    /* fall through */
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}-${Math.random()
    .toString(16)
    .slice(2)}`;
}

/**
 * Record one print-workflow event.
 *
 * Fire-and-forget by contract: telemetry must never delay, block or break the
 * print flow. Every failure path is swallowed — a logging outage is not an
 * operational incident, but a print that failed *because of logging* would be.
 *
 * @param {string} name  one of PRINT_EVENTS
 * @param {Record<string, any>} [payload]  non-PII counts / reason codes
 * @returns {void}
 */
export function trackPrintEvent(name, payload = {}) {
  if (!name) return;

  // GA4 mirror. Prefixed so admin traffic is trivially separable from customer
  // events in reporting. Returns false (no-op) when unconfigured or unconsented.
  try {
    trackEvent(name, { ...payload, surface: 'admin_print' });
  } catch {
    /* analytics must never surface into the print flow */
  }

  try {
    // Not awaited: the caller is mid-flow. `.catch` rather than try/catch alone
    // because the rejection happens after this frame.
    supabase
      .rpc('admin_log_print_event', {
        p_event_id: eventId(),
        p_event_name: name,
        p_payload: payload ?? {}
      })
      .then(({ error }) => {
        if (error) console.warn('print telemetry:', error.message);
      })
      .catch(() => {});
  } catch {
    /* offline / client unavailable */
  }
}

/**
 * Summarise tile issues into a reason histogram.
 * Counts only — the per-tile detail stays on screen and out of the log.
 *
 * @param {Array<{reason: string}>} issues
 * @returns {Record<string, number>}
 */
export function summariseIssueReasons(issues) {
  /** @type {Record<string, number>} */
  const byReason = {};
  for (const issue of issues || []) {
    if (!issue?.reason) continue;
    byReason[issue.reason] = (byReason[issue.reason] || 0) + 1;
  }
  return byReason;
}
