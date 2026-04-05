import { createClient } from '@supabase/supabase-js';
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public';

if (!PUBLIC_SUPABASE_URL || !PUBLIC_SUPABASE_ANON_KEY) {
    console.warn('Supabase environment variables are missing. Check PUBLIC_SUPABASE_URL and PUBLIC_SUPABASE_ANON_KEY.');
}

/** OAuth (Google וכו׳) משתמש ב-PKCE; ברירת המחדל implicit גורמת לכשל שקט כשיש ?code= בכתובת החזרה */
export const supabase = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, {
    auth: {
        flowType: 'pkce',
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true
    }
});

/** נתיב חזרה אחרי OAuth (נשמר לפני redirect לספק) */
export const OAUTH_RETURN_PATH_KEY = 'feel_oauth_return';

function getOAuthCallbackUrl() {
    if (typeof window === 'undefined') return undefined;
    return `${window.location.origin}/auth/callback`;
}

function rememberOAuthReturnPath() {
    if (typeof window === 'undefined') return;
    try {
        const path = `${window.location.pathname}${window.location.search || ''}`;
        if (path.startsWith('/auth/callback')) return;
        sessionStorage.setItem(OAUTH_RETURN_PATH_KEY, path);
    } catch {
        /* private mode / quota */
    }
}

/**
 * OAuth חייב לחזור ל-URL קבוע שמופיע ב-Supabase → Authentication → URL Configuration → Redirect URLs,
 * למשל: http://localhost:5173/auth/callback ו-https://your-domain.com/auth/callback
 * שימוש ב-window.location.href גרם לכשל כשהנתיב המלא לא היה ברשימה.
 */
export async function loginWithGoogle() {
    rememberOAuthReturnPath();
    return supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
            redirectTo: getOAuthCallbackUrl(),
            scopes: 'openid email profile'
        }
    });
}

export async function loginWithFacebook() {
    rememberOAuthReturnPath();
    return supabase.auth.signInWithOAuth({
        provider: 'facebook',
        options: {
            redirectTo: getOAuthCallbackUrl(),
            scopes: 'email public_profile'
        }
    });
}