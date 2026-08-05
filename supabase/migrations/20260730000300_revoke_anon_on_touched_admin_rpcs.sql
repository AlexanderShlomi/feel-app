-- =============================================================================
-- Revoke `anon` EXECUTE on the admin RPCs touched by this change
-- =============================================================================
-- FINDING
-- Supabase ships a `pg_default_acl` entry that grants EXECUTE to `anon`,
-- `authenticated` and `service_role` on every function created in `public`.
-- That is a DEFAULT ACL grant, which is NOT the same thing as a grant to
-- PUBLIC — so the `revoke all on function ... from public` that every migration
-- in this repo performs never removed it.
--
-- Net effect: every `admin_*` RPC in this project is invocable unauthenticated
-- via /rest/v1/rpc/<name>. Nothing leaks, because each one raises
-- `not_authenticated` before touching a row (Law D: the authority check lives
-- inside the security-definer function, not in the grant). But the surface is
-- needless, and the Supabase linter flags it — see lint 0028.
--
-- SCOPE
-- Deliberately limited to the three functions this change created or replaced.
-- The same revoke is warranted for the other ~20 admin_* RPCs; that is a
-- separate, reviewable change rather than a silent sweep bundled into a print
-- workflow migration.
--
-- NOTE: new functions will keep inheriting the default ACL. Fixing it at the
-- source means altering the default privileges for the `postgres` role, which
-- affects every future function in the project — again, a decision that
-- deserves its own change.
-- =============================================================================

revoke execute on function public.admin_log_print_event(uuid, text, jsonb) from anon;

revoke execute on function public.admin_update_production_job(
  uuid, boolean, boolean, text, text, jsonb, text, boolean
) from anon;

revoke execute on function public.admin_get_print_originals(uuid[]) from anon;
