-- Superseded function body: 20260508000200_harder_jsonb_strip_and_scrub_rpc.sql
-- replaces this with a plpgsql scrub + create_complete_order fixes. Keep this file so
-- chained applies stay ordered; the next migration is the source of truth.

-- Recursive feel_jsonb_strip_nul_bytes still merges with jsonb_build_object / concat,
-- where PostgreSQL can raise SQLSTATE 54000 ("null character not permitted") on assignment.
-- Strip NUL escapes and stray chr(0) from canonical jsonb::text, then parse back once.

create or replace function public.feel_jsonb_strip_nul_bytes(p_input jsonb)
returns jsonb
language sql
immutable
parallel safe
set search_path = public
as $$
  select case
    when p_input is null then null::jsonb
    else replace(
           replace(coalesce(p_input::text, ''), $esc$\u0000$esc$, ''),
           chr(0),
           ''
         )::jsonb
  end;
$$;

revoke all on function public.feel_jsonb_strip_nul_bytes(jsonb) from public;
grant execute on function public.feel_jsonb_strip_nul_bytes(jsonb) to authenticated;
