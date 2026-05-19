-- =============================================================================
-- my_orders_dashboard — מעבר ל-SECURITY DEFINER עם קשיחות מלאה
-- =============================================================================
-- מטרה: לחסוך חיוב RLS חוזר על public.order_items (אגב N=25 הזמנות זה N תתי-בדיקות),
-- ע"י ביצוע סינון מפורש לפי auth.uid() בקוד הפונקציה עצמה. הרווח הצפוי על חיבורים
-- חמים: ~10–50ms בשאילתות עם הרבה שורות פריט.
--
-- שיקולי בטיחות (לפני שמרצים):
--   1. SECURITY DEFINER → הפונקציה רצה בהרשאות של ה-OWNER (postgres ב-Supabase),
--      ולכן עוקפת RLS. אנחנו חייבים לסנן בעצמנו לפי auth.uid().
--   2. WHERE c.uid IS NOT NULL — אם אין JWT (אנונימי), הפונקציה לא תחזיר כלום.
--   3. SET search_path = public, pg_temp — מונע התקפת search_path injection.
--   4. REVOKE מ-public/anon, GRANT רק ל-authenticated.
--   5. תאימות חזרה מלאה: אותה חתימת קלט/פלט בדיוק כמו 20260409130000.
--
-- Rollback: אם משהו בעייתי, מחזירים את 20260409130000 ע"י הרצה חוזרת שלה.
-- =============================================================================

-- במקום DROP+CREATE, משתמשים ב-CREATE OR REPLACE (פחות disruptive).
-- חשוב: אם החתימה השתנתה אי-פעם בעבר, יש להריץ DROP מקדים — בענן הענן הזה
-- החתימה (integer, integer) קיימת ב-20260408120000 ובהמשך ב-20260409130000,
-- ולכן CREATE OR REPLACE בלבד מספיק.

create or replace function public.my_orders_dashboard(
  p_max_orders integer default 25,
  p_offset integer default 0
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with caller as (
    -- מבודדים את auth.uid() לפעם אחת בלבד; חוסך הערכה חוזרת בכל שורה.
    select auth.uid() as uid
  ),
  params as (
    select
      least(greatest(coalesce(p_max_orders, 25), 1), 50)::int as lim_n,
      greatest(coalesce(p_offset, 0), 0)::int as lim_off
  ),
  recent as (
    -- סינון מפורש לפי הקורא. אם אין JWT — uid הוא NULL וההשוואה נכשלת,
    -- אבל אנחנו גם מוסיפים בדיקה מפורשת ל-`is not null` כהגנה ברורה.
    select o.*
    from public.orders o, params p, caller c
    where c.uid is not null
      and o.user_id = c.uid
    order by o.placed_at desc nulls last
    limit (select lim_n from params)
    offset (select lim_off from params)
  ),
  items_agg as (
    -- שני סינוני בטיחות:
    --   1. order_id IN (recent) — מצמצם ל-N הזמנות שכבר ידוע ששייכות לקורא.
    --   2. EXISTS על orders + caller — שכבת הגנה שנייה (depth-in-defense),
    --      למקרה שמישהו עתידי יערוך את recent אך ישכח את הסינון.
    select
      i.order_id,
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', i.id,
            'order_id', i.order_id,
            'title', i.title,
            'subtitle', i.subtitle,
            'thumbnail_url', i.thumbnail_url,
            'quantity', i.quantity,
            'line_total', i.line_total,
            'unit_price', i.unit_price,
            'created_at', i.created_at
          )
          order by i.created_at asc nulls last
        ),
        '[]'::jsonb
      ) as items_json
    from public.order_items i
    where i.order_id in (select id from recent)
      and exists (
        select 1
        from public.orders o, caller c
        where o.id = i.order_id
          and c.uid is not null
          and o.user_id = c.uid
      )
    group by i.order_id
  ),
  with_items as (
    select
      r.*,
      coalesce(a.items_json, '[]'::jsonb) as items_json
    from recent r
    left join items_agg a on a.order_id = r.id
  )
  select coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'order', to_jsonb(wi) - 'items_json',
          'order_items', wi.items_json
        )
        order by wi.placed_at desc nulls last
      )
      from with_items wi
    ),
    '[]'::jsonb
  );
$$;

comment on function public.my_orders_dashboard(integer, integer) is
  'הזמנות + שורות לדף ההזמנות. SECURITY DEFINER עם סינון מפורש לפי auth.uid() (חוסך RLS על order_items).';

-- הרשאות מצומצמות: רק משתמשים מחוברים. anon/public לא יכולים להריץ.
revoke all on function public.my_orders_dashboard(integer, integer) from public;
revoke all on function public.my_orders_dashboard(integer, integer) from anon;
grant execute on function public.my_orders_dashboard(integer, integer) to authenticated;

-- ANALYZE כדי שהמתכנן ידע לבחור את ה-Index Scan החדש לאחר השינוי.
analyze public.orders;
analyze public.order_items;
