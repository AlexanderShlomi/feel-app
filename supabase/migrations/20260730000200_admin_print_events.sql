-- =============================================================================
-- Admin print telemetry (Law E) — durable operational event log
-- =============================================================================
-- WHY A TABLE AND NOT THE ANALYTICS WRAPPER
-- `trackEvent` is gated on ANALYTICS_CONFIGURED && anyConsent(). Both are the
-- right gates for CUSTOMER events and the wrong ones here:
--   * these are staff/operational events, not marketing — there is no data
--     subject whose consent is being sought;
--   * they must be reliable. The single most valuable signal is "how often does
--     a batch get blocked because an original never uploaded", and an
--     ad-blocker on the admin's browser silently zeroing that metric would make
--     it worse than useless — it would read as "the problem went away".
-- The client still mirrors these to GA4 when analytics happen to be configured;
-- this table is the source of truth.
--
-- NO PII: counts, reason codes and enum-ish strings only. Deliberately no order
-- numbers, customer names or storage paths.
-- =============================================================================

create table if not exists public.admin_print_events (
  id         uuid primary key,
  event_name text not null,
  payload    jsonb not null default '{}'::jsonb,
  admin_id   uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

comment on table public.admin_print_events is
  'Operational telemetry for the admin print workflow. Non-PII: counts and reason codes only. Written exclusively through admin_log_print_event().';

comment on column public.admin_print_events.id is
  'Client-provided UUID. Makes the write idempotent under retry (Law: idempotent state-mutating RPCs).';

create index if not exists admin_print_events_created_idx
  on public.admin_print_events (created_at desc);

create index if not exists admin_print_events_name_created_idx
  on public.admin_print_events (event_name, created_at desc);

-- RLS on with NO policies: the table is unreachable from the client except
-- through the security-definer RPC below, which validates admin membership.
alter table public.admin_print_events enable row level security;

-- ── RPC: admin_log_print_event ───────────────────────────────────────────────

create or replace function public.admin_log_print_event(
  p_event_id   uuid,
  p_event_name text,
  p_payload    jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := auth.uid();
begin
  if v_admin is null then
    raise exception 'not_authenticated';
  end if;
  if not exists (select 1 from public.admin_users where user_id = v_admin) then
    raise exception 'not_admin';
  end if;

  if p_event_id is null then
    raise exception 'missing_event_id';
  end if;

  -- Allowlist rather than free text: an open sink invites unbounded cardinality
  -- and turns a telemetry table into a place to stash arbitrary strings.
  if p_event_name is null or p_event_name not in (
    'print_batch_sent',
    'print_blocked_by_issues',
    'print_override_used',
    'print_mark_partial',
    'print_urls_expired'
  ) then
    raise exception 'unknown_event_name';
  end if;

  if p_payload is not null and jsonb_typeof(p_payload) <> 'object' then
    raise exception 'invalid_payload';
  end if;

  -- Bound the payload: telemetry must never become a blob store.
  if length(coalesce(p_payload, '{}'::jsonb)::text) > 2000 then
    raise exception 'payload_too_large';
  end if;

  insert into public.admin_print_events (id, event_name, payload, admin_id)
  values (p_event_id, p_event_name, coalesce(p_payload, '{}'::jsonb), v_admin)
  on conflict (id) do nothing;
end;
$$;

revoke all on function public.admin_log_print_event(uuid, text, jsonb) from public;
grant execute on function public.admin_log_print_event(uuid, text, jsonb) to authenticated;
