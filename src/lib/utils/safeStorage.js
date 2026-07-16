/**
 * safeStorage.js — גישה בטוחה ל-localStorage/sessionStorage.
 *
 * SSR (אין window), מצב פרטי (Safari זורק ב-setItem) ו-quota מלא — כולם
 * מוחזרים כ-null/false בשקט במקום להפיל את האפליקציה. מקור אחד לתבנית
 * ה-try/catch שהייתה משוכפלת ב-consentStore / privacyCheckoutConsent / analytics.
 */

/** @param {{ session?: boolean }} [opts] */
function getStore(opts) {
    if (typeof window === 'undefined') return null;
    try {
        return opts?.session ? window.sessionStorage : window.localStorage;
    } catch {
        return null;
    }
}

/**
 * @param {string} key
 * @param {{ session?: boolean }} [opts] session=true → sessionStorage
 * @returns {string | null}
 */
export function storageGet(key, opts) {
    const store = getStore(opts);
    if (!store) return null;
    try {
        return store.getItem(key);
    } catch {
        return null;
    }
}

/**
 * @param {string} key
 * @param {string} value
 * @param {{ session?: boolean }} [opts]
 * @returns {boolean} האם הכתיבה הצליחה
 */
export function storageSet(key, value, opts) {
    const store = getStore(opts);
    if (!store) return false;
    try {
        store.setItem(key, value);
        return true;
    } catch {
        return false;
    }
}

/**
 * @param {string} key
 * @param {{ session?: boolean }} [opts]
 */
export function storageRemove(key, opts) {
    const store = getStore(opts);
    if (!store) return;
    try {
        store.removeItem(key);
    } catch {
        /* ignore */
    }
}

/**
 * קריאת JSON שמור; מחזיר null אם המפתח חסר או שהתוכן אינו JSON תקין.
 * @param {string} key
 * @param {{ session?: boolean }} [opts]
 * @returns {unknown}
 */
export function storageGetJSON(key, opts) {
    const raw = storageGet(key, opts);
    if (raw == null) return null;
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

/**
 * @param {string} key
 * @param {unknown} value
 * @param {{ session?: boolean }} [opts]
 * @returns {boolean} האם הכתיבה הצליחה
 */
export function storageSetJSON(key, value, opts) {
    try {
        return storageSet(key, JSON.stringify(value), opts);
    } catch {
        return false;
    }
}
