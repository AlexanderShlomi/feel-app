import { createClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/public';

/** dynamic: מאפשר בנייה ב-Vercel גם לפני שמילאו env; בפרודקשן חובה להגדיר את שני המשתנים ב-Vercel */
const supabaseUrl = env.PUBLIC_SUPABASE_URL ?? '';
const supabaseAnonKey = env.PUBLIC_SUPABASE_ANON_KEY ?? '';

if (!supabaseUrl || !supabaseAnonKey) {
    console.warn('Supabase environment variables are missing. Check PUBLIC_SUPABASE_URL and PUBLIC_SUPABASE_ANON_KEY.');
}

/** OAuth (Google וכו׳) משתמש ב-PKCE; ברירת המחדל implicit גורמת לכשל שקט כשיש ?code= בכתובת החזרה */
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
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