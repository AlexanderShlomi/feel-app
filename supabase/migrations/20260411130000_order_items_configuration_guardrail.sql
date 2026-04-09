-- Guardrail: prevent huge / embedded-image configuration payloads (stabilization sprint)
-- Policy: configuration must be <= 50KB (UTF-8 bytes) and must not contain 'data:image'

alter table public.order_items
  drop constraint if exists order_items_configuration_guardrail_chk;

alter table public.order_items
  add constraint order_items_configuration_guardrail_chk
  check (
    octet_length(configuration::text) <= 51200
    and position('data:image' in lower(configuration::text)) = 0
  )
  not valid;

