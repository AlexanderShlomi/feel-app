import { get, writable } from 'svelte/store';
import { supabase } from './supabase';
import {
    clearCheckoutPrivacyConsent,
    setCheckoutPrivacyConsent
} from './privacyCheckoutConsent.js';
import { currentPrivacyPolicy, privacyNeedsReaccept } from './privacyPolicyStore.js';

export const user = writable(null);
export const profile = writable(null);
export const authLoading = writable(true);

// פונקציה לניטור מצב החיבור
// חשוב: לא חוסמים את authLoading=false על fetchProfile — הפרופיל נטען ברקע.
// כך דפי-משתמש (כמו /orders) יכולים להתחיל את ה-fetch שלהם במקביל לטעינת הפרופיל.
export const initAuth = async () => {
    authLoading.set(true);

    try {
        const { data: { session } } = await supabase.auth.getSession();
        user.set(session?.user ?? null);

        if (session?.user) {
            // ברקע — לא ממתינים. כך לא חוסמים פתיחת דפים שתלויים רק ב-user.
            void fetchProfile(session.user.id);
        }
    } catch (e) {
        console.warn('initAuth getSession failed:', e);
    } finally {
        authLoading.set(false);
    }

    supabase.auth.onAuthStateChange((_event, session) => {
        user.set(session?.user ?? null);
        if (session?.user) {
            void fetchProfile(session.user.id);
        } else {
            const snapProfile = get(profile);
            const snapPolicy = get(currentPrivacyPolicy);
            clearCheckoutPrivacyConsent();
            if (snapProfile && !privacyNeedsReaccept(snapProfile, snapPolicy)) {
                setCheckoutPrivacyConsent();
            }
            profile.set(null);
        }
        authLoading.set(false);
    });
};

async function fetchProfile(userId) {
    try {
        const { data } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
        profile.set(data ?? null);
    } catch (e) {
        console.warn('fetchProfile failed:', e);
    }
}

/** רענון ידני אחרי עדכון פרופיל (למשל אחרי הרשמה ב-AuthModal) */
export async function refreshProfile(userId) {
    if (!userId) {
        profile.set(null);
        return;
    }
    await fetchProfile(userId);
}