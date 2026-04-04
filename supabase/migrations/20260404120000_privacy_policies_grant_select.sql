-- RLS מאפשר שורות; בלי GRANT PostgREST לא מחזיר שורות ל-anon/authenticated (403 / שגיאת הרשאות).
grant select on table public.privacy_policies to anon, authenticated;
