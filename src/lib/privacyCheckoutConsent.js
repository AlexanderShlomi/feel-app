/**
 * אורחים (ללא התחברות): אישור לפני מעבר ל-checkout נשמר ב-localStorage.
 * משתמש מחובר: האמת נמצאת ב-profiles (גרסה + תאריך חתימה) מול טבלת privacy_policies ב-Supabase.
 */
export const CHECKOUT_PRIVACY_STORAGE_KEY = 'feel_checkout_privacy_accepted_v1';

export function hasCheckoutPrivacyConsent() {
    if (typeof window === 'undefined') return false;
    try {
        return window.localStorage.getItem(CHECKOUT_PRIVACY_STORAGE_KEY) === '1';
    } catch {
        return false;
    }
}

export function setCheckoutPrivacyConsent() {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.setItem(CHECKOUT_PRIVACY_STORAGE_KEY, '1');
    } catch {
        /* ignore */
    }
}

export function clearCheckoutPrivacyConsent() {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.removeItem(CHECKOUT_PRIVACY_STORAGE_KEY);
    } catch {
        /* ignore */
    }
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
