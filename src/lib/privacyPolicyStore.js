import { writable } from 'svelte/store';
import { supabase } from './supabase';

/** @typedef {{ version: string; body: string; updated_at: string }} PrivacyPolicyRow */

/** @type {import('svelte/store').Writable<PrivacyPolicyRow | null>} */
export const currentPrivacyPolicy = writable(null);

export const privacyPolicyLoading = writable(false);

/**
 * המדיניות הנוכחית = השורה עם updated_at המאוחר ביותר (מסונכרן עם current_privacy_policy_version ב-DB).
 */
export async function fetchCurrentPrivacyPolicy() {
    privacyPolicyLoading.set(true);
    try {
        const { data: rows, error } = await supabase
            .from('privacy_policies')
            .select('version, body, updated_at')
            .order('updated_at', { ascending: false })
            .limit(1);

        if (error) {
            console.error('fetchCurrentPrivacyPolicy:', error.message || error);
            currentPrivacyPolicy.set(null);
            return { error };
        }
        const row = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
        currentPrivacyPolicy.set(row);
        return { data: row, error: null };
    } finally {
        privacyPolicyLoading.set(false);
    }
}

/**
 * @param {Record<string, unknown> | null} profile
 * @param {PrivacyPolicyRow | null} policy
 */
export function privacyNeedsReaccept(profile, policy) {
    if (!policy?.version) return true;
    return (profile?.privacy_policy_version_accepted ?? null) !== policy.version;
}

/** רישום אישור מול השרת (גרסה עדכנית בלבד) + מומלץ לקרוא refreshProfile אחרי */
export async function recordPrivacyConsent() {
    const { error } = await supabase.rpc('record_privacy_consent');
    return error ?? null;
}
