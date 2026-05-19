-- 1) feel_jsonb_strip_nul_bytes: string leaves used p_input #>> '{}' which *decodes*
--    JSON \u0000 into real U+0000 and assigns to type text → SQLSTATE 54000 before
--    replace() could run. Serialize with ::text (escaped, no raw NUL) then strip.
-- 2) order_items_configuration_guardrail_chk: CHECK used configuration::text directly;
--    same failure on rows/json with U+0000. Delegate to a helper that strips first.

create or replace function public.feel_jsonb_strip_nul_bytes(p_input jsonb)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  t text;
  acc jsonb;
  pair record;
  el record;
  v_ser text;
begin
  if p_input is null then
    return null;
  end if;

  t := jsonb_typeof(p_input);

  if t = 'string' then
    v_ser := p_input::text;
    v_ser := replace(v_ser, $json_esc_u0000$\u0000$json_esc_u0000$, '');
    v_ser := replace(v_ser, chr(0), '');
    return v_ser::jsonb;
  elsif t in ('number', 'boolean', 'null') then
    return p_input;
  elsif t = 'array' then
    acc := '[]'::jsonb;
    for el in select * from jsonb_array_elements(p_input)
    loop
      acc := acc || jsonb_build_array(public.feel_jsonb_strip_nul_bytes(el.value));
    end loop;
    return acc;
  elsif t = 'object' then
    acc := '{}'::jsonb;
    for pair in select * from jsonb_each(p_input)
    loop
      acc := acc || jsonb_build_object(
        replace(pair.key, chr(0), ''),
        public.feel_jsonb_strip_nul_bytes(pair.value)
      );
    end loop;
    return acc;
  end if;

  return p_input;
end;
$$;

revoke all on function public.feel_jsonb_strip_nul_bytes(jsonb) from public;
grant execute on function public.feel_jsonb_strip_nul_bytes(jsonb) to authenticated;

create or replace function public.feel_order_item_configuration_guardrail_ok(p_cfg jsonb)
returns boolean
language sql
immutable
parallel safe
set search_path = public
as $$
  select
    octet_length(public.feel_jsonb_strip_nul_bytes(coalesce(p_cfg, '{}'::jsonb))::text) <= 51200
    and position(
          'data:image'
          in lower(public.feel_jsonb_strip_nul_bytes(coalesce(p_cfg, '{}'::jsonb))::text)
    ) = 0;
$$;

comment on function public.feel_order_item_configuration_guardrail_ok(jsonb) is
  'Configuration guardrail: size + no data URLs. Strips NUL bytes before ::text so CHECK never hits 54000.';

alter table public.order_items
  drop constraint if exists order_items_configuration_guardrail_chk;

alter table public.order_items
  add constraint order_items_configuration_guardrail_chk
  check (public.feel_order_item_configuration_guardrail_ok(configuration))
  not valid;

do $$
declare
  v_violations bigint;
begin
  select count(*) into v_violations
  from public.order_items
  where not public.feel_order_item_configuration_guardrail_ok(configuration);

  if v_violations = 0 then
    alter table public.order_items validate constraint order_items_configuration_guardrail_chk;
  end if;
end $$;
