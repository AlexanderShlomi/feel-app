-- feel_sanitize_text used replace(p_input, chr(0), ''). On Postgres, using chr(0) as the
-- search pattern can raise SQLSTATE 54000 ("null character not permitted") even when p_input
-- is NUL-free. Use an E-string NUL literal for the pattern instead.
--
-- Same control-char stripping as v3; only the NUL removal mechanism changes.

create or replace function public.feel_sanitize_text(p_input text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v_clean text;
begin
  if p_input is null then
    return null;
  end if;

  -- Drop NULL bytes (Postgres TEXT cannot store U+0000). Avoid chr(0) in replace(...) — 54000.
  v_clean := replace(p_input, E'\000', '');

  v_clean := regexp_replace(v_clean, '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]', '', 'g');

  v_clean := nullif(btrim(v_clean), '');
  return v_clean;
end;
$$;

revoke all on function public.feel_sanitize_text(text) from public;
grant execute on function public.feel_sanitize_text(text) to authenticated;
