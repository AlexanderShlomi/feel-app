// Admin layout — server side.
// The actual admin auth check is done client-side in +layout.svelte using
// the is_admin() RPC (security definer, checks admin_users).
// This file only passes the public supabase URL so the layout can initialize.

/** @type {import('@sveltejs/kit').LayoutServerLoad} */
export async function load() {
    // Nothing to do server-side — no session available without hooks.server.js.
    // The client-side +layout.svelte will guard the route.
    return {};
}
