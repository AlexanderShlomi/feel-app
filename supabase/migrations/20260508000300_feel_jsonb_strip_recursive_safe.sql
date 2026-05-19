-- feel_jsonb_strip_nul_bytes: recursive strip per JSON leaf — NOT a global ::text replace on the
-- whole value. Blind replace breaks valid JSON when a string contains a literal backslash before
-- "u0000" (serialized as \\u0000): removing \u0000 leaves "\d" / "\b" style garbage (22P02).
-- Also: never use replace(..., chr(0), ...) as the *search* pattern — constructing NUL for text ops
-- can raise 54000.
--
-- String leaves: prefer p_input #>> '{}' (decoded string, no JSON quotes). Strip the six-char
-- sequence \ u 0 0 0 0 from *content*, then to_jsonb — avoids breaking "\\u0000" in serialized ::text.
-- Fallback: serialized form with a short placeholder so we never remove the second half of "\\u0000".

create or replace function public.feel_jsonb_strip_nul_bytes(p_input jsonb)
returns jsonb
language plpgsql
stable
parallel safe
set search_path = public
as $$
declare
  t text;
  acc jsonb;
  pair record;
  elem jsonb;
  v_ser text;
  v_key text;
  v_inner text;
begin
  if p_input is null then
    return null;
  end if;

  t := jsonb_typeof(p_input);

  if t = 'string' then
    begin
      v_inner := p_input #>> '{}';
      v_inner := replace(coalesce(v_inner, ''), chr(92) || 'u0000', '');
      return to_jsonb(v_inner);
    exception
      when others then
        v_ser := p_input::text;
        v_ser := replace(v_ser, chr(92) || chr(92) || 'u0000', '__FEEL_KEEP_LIT_U0000__');
        v_ser := replace(v_ser, chr(92) || 'u0000', '');
        v_ser := replace(v_ser, '__FEEL_KEEP_LIT_U0000__', chr(92) || chr(92) || 'u0000');
        return v_ser::jsonb;
    end;
  elsif t in ('number', 'boolean', 'null') then
    return p_input;
  elsif t = 'array' then
    acc := '[]'::jsonb;
    for elem in
      select e.value
      from jsonb_array_elements(p_input) with ordinality as e(value, ord)
      order by ord
    loop
      acc := acc || jsonb_build_array(public.feel_jsonb_strip_nul_bytes(elem));
    end loop;
    return acc;
  elsif t = 'object' then
    acc := '{}'::jsonb;
    for pair in select * from jsonb_each(p_input)
    loop
      v_key := replace(pair.key, chr(92) || 'u0000', '');
      acc := acc
        || jsonb_build_object(
          v_key,
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
