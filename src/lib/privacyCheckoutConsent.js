/**
 * אורחים (ללא התחברות): אישור לפני מעבר ל-checkout נשמר ב-localStorage.
 * משתמש מחובר: האמת נמצאת ב-profiles (גרסה + תאריך חתימה) מול טבלת privacy_policies ב-Supabase.
 */
import { storageGet, storageSet, storageRemove } from '$lib/utils/safeStorage.js';

export const CHECKOUT_PRIVACY_STORAGE_KEY = 'feel_checkout_privacy_accepted_v1';

export function hasCheckoutPrivacyConsent() {
    return storageGet(CHECKOUT_PRIVACY_STORAGE_KEY) === '1';
}

export function setCheckoutPrivacyConsent() {
    storageSet(CHECKOUT_PRIVACY_STORAGE_KEY, '1');
}

export function clearCheckoutPrivacyConsent() {
    storageRemove(CHECKOUT_PRIVACY_STORAGE_KEY);
}

export const OPEN_PRIVACY_EVENT = 'feel-open-privacy';

export function requestOpenPrivacyPolicy() {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent(OPEN_PRIVACY_EVENT));
}

export const OPEN_COOKIE_POLICY_EVENT = 'feel-open-cookie-policy';

export function requestOpenCookiePolicy() {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent(OPEN_COOKIE_POLICY_EVENT));
}
