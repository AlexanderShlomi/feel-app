/**
 * idle.js — תזמון עבודה לא-דחופה לזמן פנוי של הדפדפן (requestIdleCallback),
 * עם fallback ל-setTimeout בדפדפנים ללא תמיכה (Safari).
 *
 * מקור אחד לתבנית — במקום עותקים מקומיים ב-stores/analytics/CookieConsentBanner
 * שקבועי הזמן שלהם נטו להתפצל.
 */

/**
 * @param {() => void} fn העבודה לביצוע בזמן פנוי
 * @param {{ timeout?: number, fallbackDelay?: number }} [opts]
 *   timeout — מקסימום המתנה (ms) עד ש-requestIdleCallback ירוץ בכל מקרה (ברירת מחדל 2000).
 *   fallbackDelay — השהיה (ms) כשאין requestIdleCallback (ברירת מחדל: min(250, timeout)).
 * @returns {() => void} פונקציית ביטול (בטוחה לקריאה תמיד, למשל ב-onDestroy)
 */
export function scheduleIdle(fn, opts = {}) {
    if (typeof window === 'undefined') return () => {};
    const timeout = opts.timeout ?? 2000;
    if (typeof window.requestIdleCallback === 'function') {
        const id = window.requestIdleCallback(() => fn(), { timeout });
        return () => {
            try {
                window.cancelIdleCallback?.(id);
            } catch {
                /* ignore */
            }
        };
    }
    const id = setTimeout(fn, opts.fallbackDelay ?? Math.min(250, timeout));
    return () => clearTimeout(id);
}
