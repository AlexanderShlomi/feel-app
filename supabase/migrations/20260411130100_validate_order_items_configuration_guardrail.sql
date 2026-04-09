-- Validate the guardrail constraint if possible.
-- Rationale: older environments might contain legacy oversized/base64 configurations.
-- We only VALIDATE when there are no violating rows, otherwise we keep it NOT VALID
-- (still protects new writes).

do $$
declare
  v_violations bigint;
begin
  select count(*)
    into v_violations
  from public.order_items
  where octet_length(configuration::text) > 51200
     or position('data:image' in lower(configuration::text)) > 0;

  if v_violations = 0 then
    alter table public.order_items
      validate constraint order_items_configuration_guardrail_chk;
  end if;
end $$;

