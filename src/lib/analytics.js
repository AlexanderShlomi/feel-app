/**
 * analytics.js — עטיפת מדידה מרכזית (Law E).
 *
 * מודול עלה (leaf): אינו מייבא דבר מ-$lib (פרט ל-env), כדי למנוע תלות מעגלית עם stores.js.
 * אף רכיב לא קורא ישירות ל-gtag/fbq/ttq — הכול עובר דרך הפונקציות כאן.
 *
 * מדידה כבויה כברירת מחדל (Google Consent Mode v2, default=denied — מוגדר ב-app.html).
 * סקריפטים נטענים בעצלות (requestIdleCallback) ורק עבור קטגוריות שהמשתמש אישר.
 * אפס PII — רק סוג מוצר, כמות, ערך, מטבע, ו-transaction_id = מספר הזמנה.
 */
import { env } from '$env/dynamic/public';
import { scheduleIdle } from '$lib/utils/idle.js';

const GA4_ID = env.PUBLIC_GA4_MEASUREMENT_ID || '';
const META_PIXEL_ID = env.PUBLIC_META_PIXEL_ID || '';
const TIKTOK_PIXEL_ID = env.PUBLIC_TIKTOK_PIXEL_ID || '';
const GOOGLE_ADS_ID = env.PUBLIC_GOOGLE_ADS_ID || '';
const GTM_ID = env.PUBLIC_GTM_CONTAINER_ID || '';

const isBrowser = typeof window !== 'undefined';

/** האם מדידה מוגדרת בכלל. בלי אף מזהה — כל המודול הופך ל-no-op (אפס עלות). */
const ANALYTICS_CONFIGURED = !!(GA4_ID || GOOGLE_ADS_ID || GTM_ID || META_PIXEL_ID || TIKTOK_PIXEL_ID);

/** מצב הסכמה נוכחי. כל המדידה נגזרת מכאן. */
let consentState = { analytics: false, ads: false, social: false };

const anyConsent = () => consentState.analytics || consentState.ads || consentState.social;

/**
 * שער מרכזי לכל אירוע: בלי מזהים מוגדרים או בלי שום הסכמה — לא דוחפים כלום
 * ל-dataLayer (מונע גדילת זיכרון אינסופית כשאין צרכן, ומכבד Opt-in).
 */
const canTrack = () => isBrowser && ANALYTICS_CONFIGURED && anyConsent();

/** מה כבר נטען — מונע הזרקה כפולה. */
const loaded = {
    googleTag: false,
    gtagJs: false,
    ga4cfg: false,
    adscfg: false,
    gtm: false,
    meta: false,
    tiktok: false
};

/** אירועי פיקסל שנורו לפני שהספריות נטענו — מנוקזים לאחר טעינה. */
let pixelBuffer = [];
const MAX_BUFFER = 50;

/** gtag הקנוני — דוחף ל-dataLayer (אותו dataLayer שמוגדר ב-app.html). */
function gtag() {
    if (!isBrowser) return;
    window.dataLayer = window.dataLayer || [];
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer.push(arguments);
}

function injectScript(src, attrs = {}) {
    return new Promise((resolve, reject) => {
        if (!isBrowser) return reject(new Error('no window'));
        const s = document.createElement('script');
        s.src = src;
        s.async = true;
        for (const [k, v] of Object.entries(attrs)) s.setAttribute(k, v);
        s.onload = () => resolve();
        s.onerror = () => reject(new Error('failed to load ' + src));
        document.head.appendChild(s);
    });
}

/* ─────────────────────────── Consent Mode v2 ─────────────────────────── */

function pushConsentUpdate(c) {
    gtag('consent', 'update', {
        analytics_storage: c.analytics ? 'granted' : 'denied',
        ad_storage: c.ads ? 'granted' : 'denied',
        ad_user_data: c.ads ? 'granted' : 'denied',
        ad_personalization: c.ads ? 'granted' : 'denied',
        personalization_storage: c.social ? 'granted' : 'denied'
    });
}

/* ───────────────────────────── Loaders ──────────────────────────────── */

/**
 * Google tag (GA4 + Google Ads) — פקודות ה-config בלבד (זולות, ללא רשת).
 * חייבות להידחף ל-dataLayer לפני כל אירוע: gtag.js מעבד את התור לפי הסדר,
 * ואירוע שנדחף לפני config של יעד כלשהו נזרק. לכן זה רץ סינכרונית ב-applyConsent,
 * בעוד שהזרקת הסקריפט עצמה נדחית ל-idle.
 */
function configureGoogleTag(c) {
    const wantGA = !!GA4_ID && c.analytics;
    const wantAds = !!GOOGLE_ADS_ID && c.ads;
    if (!wantGA && !wantAds) return;
    if (!loaded.gtagJs) {
        loaded.gtagJs = true;
        gtag('js', new Date());
    }
    if (wantGA && !loaded.ga4cfg) {
        loaded.ga4cfg = true;
        // send_page_view=false: צפיות עמוד נשלחות ידנית דרך trackPageView (ניווט SPA)
        gtag('config', GA4_ID, { send_page_view: false });
    }
    if (wantAds && !loaded.adscfg) {
        loaded.adscfg = true;
        gtag('config', GOOGLE_ADS_ID);
    }
}

/** הזרקת ספריית gtag.js — החלק הכבד, נטען ב-idle. */
function loadGoogleTag(c) {
    const wantGA = !!GA4_ID && c.analytics;
    const wantAds = !!GOOGLE_ADS_ID && c.ads;
    if (!wantGA && !wantAds) return;
    if (loaded.googleTag) return;
    loaded.googleTag = true;
    injectScript(`https://www.googletagmanager.com/gtag/js?id=${GA4_ID || GOOGLE_ADS_ID}`).catch(() => {
        loaded.googleTag = false;
    });
}

/** Google Tag Manager — מיכל יחיד שמנהל את כל התגיות (עדיין כפוף ל-Consent Mode). */
function loadGTM(c) {
    if (loaded.gtm) return;
    if (!c.analytics && !c.ads && !c.social) return;
    loaded.gtm = true;
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ 'gtm.start': Date.now(), event: 'gtm.js' });
    injectScript(`https://www.googletagmanager.com/gtm.js?id=${GTM_ID}`).catch(() => {
        loaded.gtm = false;
    });
}

/** Meta (Facebook/Instagram) Pixel — קטגוריית Ads או Social. */
function loadMeta(c) {
    if (loaded.meta || !META_PIXEL_ID) return;
    if (!c.ads && !c.social) return;
    loaded.meta = true;
    /* official Meta Pixel bootstrap */
    /* eslint-disable */
    !(function (f, b, e, v, n, t, s) {
        if (f.fbq) return;
        n = f.fbq = function () {
            n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
        };
        if (!f._fbq) f._fbq = n;
        n.push = n;
        n.loaded = !0;
        n.version = '2.0';
        n.queue = [];
        t = b.createElement(e);
        t.async = !0;
        t.src = v;
        s = b.getElementsByTagName(e)[0];
        s.parentNode.insertBefore(t, s);
    })(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
    /* eslint-enable */
    window.fbq('init', META_PIXEL_ID);
    window.fbq('track', 'PageView');
}

/** TikTok Pixel — קטגוריית Ads או Social. */
function loadTikTok(c) {
    if (loaded.tiktok || !TIKTOK_PIXEL_ID) return;
    if (!c.ads && !c.social) return;
    loaded.tiktok = true;
    /* official TikTok Pixel bootstrap */
    /* eslint-disable */
    !(function (w, d, t) {
        w.TiktokAnalyticsObject = t;
        var ttq = (w[t] = w[t] || []);
        ttq.methods = ['page','track','identify','instances','debug','on','off','once','ready','alias','group','enableCookie','disableCookie'];
        ttq.setAndDefer = function (e, n) {
            e[n] = function () {
                e.push([n].concat(Array.prototype.slice.call(arguments, 0)));
            };
        };
        for (var i = 0; i < ttq.methods.length; i++) ttq.setAndDefer(ttq, ttq.methods[i]);
        ttq.instance = function (e) {
            for (var n = ttq._i[e] || [], i = 0; i < ttq.methods.length; i++) ttq.setAndDefer(n, ttq.methods[i]);
            return n;
        };
        ttq.load = function (e, n) {
            var r = 'https://analytics.tiktok.com/i18n/pixel/events.js';
            ttq._i = ttq._i || {};
            ttq._i[e] = [];
            ttq._i[e]._u = r;
            ttq._t = ttq._t || {};
            ttq._t[e] = +new Date();
            ttq._o = ttq._o || {};
            ttq._o[e] = n || {};
            var o = d.createElement('script');
            o.type = 'text/javascript';
            o.async = !0;
            o.src = r + '?sdkid=' + e + '&lib=' + t;
            var a = d.getElementsByTagName('script')[0];
            a.parentNode.insertBefore(o, a);
        };
        ttq.load(TIKTOK_PIXEL_ID);
        ttq.page();
    })(window, document, 'ttq');
    /* eslint-enable */
}

/* ──────────────────────── Public consent entry ──────────────────────── */

/**
 * מחיל מצב הסכמה: מעדכן Consent Mode, וטוען בעצלות את הסקריפטים לקטגוריות שאושרו.
 * @param {{analytics?:boolean, ads?:boolean, social?:boolean}} categories
 * @param {{immediate?:boolean}} [opts] immediate=true לפעולה יזומה (אישור בבאנר) — טוען מיד ולא ב-idle.
 */
export function applyConsent(categories, opts = {}) {
    if (!isBrowser) return;
    consentState = {
        analytics: !!categories.analytics,
        ads: !!categories.ads,
        social: !!categories.social
    };
    pushConsentUpdate(consentState);
    if (!ANALYTICS_CONFIGURED) return;

    // פקודות config נדחפות מיד (זולות, ללא רשת) כדי שאירועים שנורים לפני טעינת
    // הסקריפט ישויכו ליעדים ולא יזרקו; רק הזרקת הסקריפטים נדחית ל-idle.
    if (!GTM_ID) configureGoogleTag(consentState);

    const run = () => {
        try {
            if (GTM_ID) {
                loadGTM(consentState);
            } else {
                loadGoogleTag(consentState);
                loadMeta(consentState);
                loadTikTok(consentState);
            }
        } catch (e) {
            // כשל בפלטפורמה אחת לעולם לא שובר את האחרות / את האפליקציה
            console.warn('[analytics] load error', e);
        }
        flushPixelBuffer();
    };

    if (opts.immediate) run();
    else scheduleIdle(run, { timeout: 3000, fallbackDelay: 1200 });
}

/* ───────────────────────────── Tracking ─────────────────────────────── */

const pixelsConsented = () => consentState.ads || consentState.social;

function firePixel(platform, payload) {
    try {
        if (platform === 'meta' && typeof window.fbq === 'function') {
            window.fbq('track', payload.event, payload.params || {});
        } else if (platform === 'tiktok' && window.ttq && typeof window.ttq.track === 'function') {
            window.ttq.track(payload.event, payload.params || {});
        }
    } catch (e) {
        console.warn('[analytics] pixel error', e);
    }
}

function sendOrBuffer(platform, payload) {
    // במצב GTM כל התגיות (כולל פיקסלים) מנוהלות ע"י המיכל דרך ה-dataLayer —
    // ירי ישיר היה גורם לספירה כפולה, וה-buffer לעולם לא היה מתרוקן (הפיקסלים לא נטענים ישירות).
    if (GTM_ID) return;
    if (!pixelsConsented()) return; // אין מדידת פיקסלים ללא הסכמה
    const ready = platform === 'meta' ? loaded.meta : loaded.tiktok;
    if (ready) firePixel(platform, payload);
    else if (pixelBuffer.length < MAX_BUFFER) pixelBuffer.push({ platform, payload });
}

function flushPixelBuffer() {
    if (!pixelBuffer.length) return;
    const pending = pixelBuffer;
    pixelBuffer = [];
    for (const item of pending) sendOrBuffer(item.platform, item.payload);
}

/** מפת שמות אירוע GA4 → אירועי פיקסל סטנדרטיים. */
const PIXEL_EVENT_MAP = {
    select_item: { meta: 'ViewContent', tiktok: 'ViewContent' },
    view_item: { meta: 'ViewContent', tiktok: 'ViewContent' },
    add_to_cart: { meta: 'AddToCart', tiktok: 'AddToCart' },
    begin_checkout: { meta: 'InitiateCheckout', tiktok: 'InitiateCheckout' },
    add_shipping_info: { meta: 'AddPaymentInfo', tiktok: 'AddToCart' },
    purchase: { meta: 'Purchase', tiktok: 'CompletePayment' }
};

function pixelParams(params = {}) {
    const out = {};
    if (params.value != null) out.value = params.value;
    if (params.currency) out.currency = params.currency;
    if (params.transaction_id) out.content_id = String(params.transaction_id);
    if (params.product_type) out.content_type = String(params.product_type);
    return out;
}

/** שיגור אירוע ממופה לשני הפיקסלים — נקודת יציאה אחת ל-Meta ול-TikTok. */
function dispatchPixels(name, pp) {
    const map = PIXEL_EVENT_MAP[name];
    if (!map) return;
    if (map.meta) sendOrBuffer('meta', { event: map.meta, params: pp });
    if (map.tiktok) sendOrBuffer('tiktok', { event: map.tiktok, params: pp });
}

/**
 * אירוע גנרי. נשלח ל-GA4 (דרך dataLayer, בטוח גם לפני טעינת gtag.js) ולפיקסלים אם מאושר.
 * @param {string} name שם אירוע GA4 (snake_case)
 * @param {Record<string, any>} [params] מטא-דאטה ללא PII
 * @returns {boolean} האם האירוע נדחף בפועל (יש הגדרה + הסכמה)
 */
export function trackEvent(name, params = {}) {
    if (!canTrack() || !name) return false;
    gtag('event', name, params);
    dispatchPixels(name, pixelParams(params));
    return true;
}

/**
 * אירוע מסחר אלקטרוני. params: { value, currency, items, transaction_id, product_type, ... }
 * @returns {boolean} האם האירוע נדחף בפועל (יש הגדרה + הסכמה)
 */
export function trackEcommerce(name, ecom = {}) {
    if (!canTrack() || !name) return false;
    // GA4 e-commerce — דורש ecommerce object נקי
    gtag('event', name, {
        currency: ecom.currency || 'ILS',
        value: ecom.value,
        transaction_id: ecom.transaction_id,
        items: ecom.items || []
    });
    const pp = pixelParams({ ...ecom, currency: ecom.currency || 'ILS' });
    if (ecom.items?.length) {
        pp.contents = ecom.items.map((it) => ({
            id: String(it.item_id ?? ''),
            quantity: it.quantity ?? 1,
            item_price: it.price
        }));
    }
    dispatchPixels(name, pp);
    return true;
}

/**
 * אירוע מסחר חד-פעמי: יורה רק אם המפתח טרם ננעל, ונועל את המפתח רק אחרי
 * שהאירוע נדחף בפועל — כך הסכמה מאוחרת או כשל טעינה לא "שורפים" את האירוע.
 * @param {string} dedupKey מפתח ייחודי לאירוע (למשל מזהה הזמנה)
 * @param {string} name שם אירוע GA4
 * @param {Record<string, any>} [ecom]
 * @param {{persistent?: boolean}} [opts] persistent=true → localStorage (חוצה סשנים, למשל purchase)
 * @returns {boolean} האם האירוע נשלח כעת
 */
export function trackEcommerceOnce(dedupKey, name, ecom = {}, opts = {}) {
    if (!isBrowser) return false;
    const key = `feel_tracked_${dedupKey}`;
    let storage;
    try {
        storage = opts.persistent ? window.localStorage : window.sessionStorage;
        if (storage.getItem(key)) return false;
    } catch {
        storage = null; /* private mode — נירה בלי נעילה */
    }
    if (!trackEcommerce(name, ecom)) return false;
    try {
        if (storage) storage.setItem(key, '1');
    } catch {
        /* quota/private mode */
    }
    return true;
}

/** צפיית עמוד — נקראת מ-afterNavigate ב-layout. */
export function trackPageView(path) {
    if (!canTrack()) return;
    gtag('event', 'page_view', {
        page_path: path,
        page_location: window.location.href,
        page_title: typeof document !== 'undefined' ? document.title : undefined
    });
    if (pixelsConsented()) {
        try {
            if (loaded.meta && typeof window.fbq === 'function') window.fbq('track', 'PageView');
            if (loaded.tiktok && window.ttq && typeof window.ttq.page === 'function') window.ttq.page();
        } catch {
            /* ignore */
        }
    }
}

/** תכונות משתמש לא-מזהות (לדוגמה has_account). */
export function setUserProperties(props = {}) {
    if (!isBrowser || !GA4_ID) return;
    gtag('set', 'user_properties', props);
}
