/**
 * consentStore.js — מקור האמת להסכמת עוגיות/מעקב (נפרד מהסכמת מדיניות הפרטיות
 * שמגנה על ההזמנה ב-privacyCheckoutConsent.js / privacyPolicyStore.js).
 *
 * מודל Opt-in: כל הקטגוריות הלא-הכרחיות חסומות כברירת מחדל עד אישור מפורש.
 * תלות חד-כיוונית: consentStore → analytics (analytics אינו מייבא מכאן → אין מעגל).
 */
import { writable } from 'svelte/store';
import { applyConsent, trackEvent } from '$lib/analytics.js';

export const CONSENT_VERSION = 1;
export const CONSENT_STORAGE_KEY = 'feel_cookie_consent_v1';
export const OPEN_COOKIE_SETTINGS_EVENT = 'feel-open-cookie-settings';

/** קטגוריות לא-הכרחיות. 'necessary' תמיד פעיל ולכן לא נשמר כאן. */
const DEFAULT_CATEGORIES = { analytics: false, ads: false, social: false };

/** @type {import('svelte/store').Writable<{decided:boolean, categories:{analytics:boolean,ads:boolean,social:boolean}}>} */
export const cookieConsent = writable({ decided: false, categories: { ...DEFAULT_CATEGORIES } });

function readStored() {
    if (typeof window === 'undefined') return null;
    try {
        const raw = window.localStorage.getItem(CONSENT_STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        // גרסה ישנה → נחשב כ"לא הוחלט" כדי לבקש הסכמה מחדש לאחר עדכון מדיניות
        if (!parsed || parsed.version !== CONSENT_VERSION || !parsed.categories) return null;
        return parsed;
    } catch {
        return null;
    }
}

function persist(categories) {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.setItem(
            CONSENT_STORAGE_KEY,
            JSON.stringify({ version: CONSENT_VERSION, ts: Date.now(), categories })
        );
    } catch {
        /* private mode / quota */
    }
}

function normalize(categories) {
    return {
        analytics: !!categories?.analytics,
        ads: !!categories?.ads,
        social: !!categories?.social
    };
}

/** האם המשתמש כבר הכריע (וגרסת ההסכמה עדכנית). */
export function hasDecision() {
    return !!readStored();
}

/** אתחול בעת onMount של ה-layout — מחיל הסכמה שמורה (או כלום אם אין). */
export function initConsent() {
    if (typeof window === 'undefined') return;
    const stored = readStored();
    if (stored) {
        const cats = normalize(stored.categories);
        cookieConsent.set({ decided: true, categories: cats });
        applyConsent(cats); // טעינה עצלה ב-idle
    } else {
        cookieConsent.set({ decided: false, categories: { ...DEFAULT_CATEGORIES } });
        // לא נטען כלום — Consent Mode נשאר denied (app.html)
    }
}

/** שמירת בחירה מפורשת (מהבאנר/מנהל ההעדפות) — נכנס לתוקף מיד. */
export function saveConsent(categories) {
    const cats = normalize(categories);
    persist(cats);
    cookieConsent.set({ decided: true, categories: cats });
    applyConsent(cats, { immediate: true });
    // Law E: מדידת ההחלטה עצמה (נשלח רק אם אושרה קטגוריה כלשהי — דחייה מלאה = אין מדידה, בכוונה)
    trackEvent('consent_updated', {
        analytics: cats.analytics,
        ads: cats.ads,
        social: cats.social
    });
}

export function acceptAll() {
    saveConsent({ analytics: true, ads: true, social: true });
}

export function rejectAll() {
    saveConsent({ analytics: false, ads: false, social: false });
}

/** פתיחת מנהל ההעדפות מכל מקום (תפריט / מדיניות עוגיות). */
export function openConsentManager() {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent(OPEN_COOKIE_SETTINGS_EVENT));
}
