<script>
    import { onMount } from 'svelte';
    import { goto } from '$app/navigation';
    import { supabase, OAUTH_RETURN_PATH_KEY } from '$lib/supabase';

    onMount(async () => {
        let {
            data: { session }
        } = await supabase.auth.getSession();

        if (!session && typeof window !== 'undefined') {
            const code = new URLSearchParams(window.location.search).get('code');
            if (code) {
                const { error } = await supabase.auth.exchangeCodeForSession(code);
                if (error) console.error('OAuth code exchange:', error);
                ({
                    data: { session }
                } = await supabase.auth.getSession());
            }
        }

        let target = '/';
        try {
            const saved = sessionStorage.getItem(OAUTH_RETURN_PATH_KEY);
            if (saved && !saved.startsWith('/auth/callback')) target = saved;
        } catch {
            /* ignore */
        }
        try {
            sessionStorage.removeItem(OAUTH_RETURN_PATH_KEY);
        } catch {
            /* ignore */
        }

        await goto(target, { replaceState: true, invalidateAll: true });
    });
</script>

<p class="oauth-callback-msg" dir="rtl">משלימים התחברות…</p>

<style>
    .oauth-callback-msg {
        padding: 3rem 1.5rem;
        text-align: center;
        font-weight: 600;
        color: var(--color-medium-blue-gray, #475160);
    }
</style>
