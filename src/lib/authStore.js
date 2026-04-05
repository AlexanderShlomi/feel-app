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
export const initAuth = async () => {
    authLoading.set(true);
    
    // בדיקת Session קיים
    const { data: { session } } = await supabase.auth.getSession();
    user.set(session?.user ?? null);
    
    if (session?.user) {
        await fetchProfile(session.user.id);
    }

    // האזנה לשינויים (התחברות/התנתקות)
    supabase.auth.onAuthStateChange(async (_event, session) => {
        user.set(session?.user ?? null);
        if (session?.user) {
            await fetchProfile(session.user.id);
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

    authLoading.set(false);
};

async function fetchProfile(userId) {
    const { data } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
    profile.set(data ?? null);
}

/** רענון ידני אחרי עדכון פרופיל (למשל אחרי הרשמה ב-AuthModal) */
export async function refreshProfile(userId) {
    if (!userId) {
        profile.set(null);
        return;
    }
    await fetchProfile(userId);
}