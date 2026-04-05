import { normalizeIsraelMobileToE164 } from './contact.js';

/** @param {string} raw */
export function maskIsraelMobileInput(raw) {
    const d = String(raw || '').replace(/\D/g, '').slice(0, 10);
    if (d.length <= 3) return d;
    if (d.length <= 6) return `${d.slice(0, 3)}-${d.slice(3)}`;
    return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
}

/** @param {string} raw */
export function maskBirthdayDdMmYyyy(raw) {
    const d = String(raw || '').replace(/\D/g, '').slice(0, 8);
    if (d.length <= 2) return d;
    if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
    return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
}

/**
 * מטען פרופיל (E.164 או מקומי) לפורמט תצוגה עם מקפים.
 * @param {string} stored
 */
export function normalizeDigitsToIsraelMobile(stored) {
    const e164 = stored?.startsWith('+') ? stored : normalizeIsraelMobileToE164(stored || '');
    if (!e164) return typeof stored === 'string' ? stored : '';
    const digits = e164.replace(/\D/g, '');
    const local = '0' + digits.slice(3);
    return maskIsraelMobileInput(local);
}
