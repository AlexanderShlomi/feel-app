// src/lib/utils/storage.js

import { setItem, getItem, removeItem } from './idb.js';

const WORKSPACE_KEY = 'feel_app_workspace';

// Cache blob: URL -> base64 to avoid re-encoding large images on every autosave.
// This is an in-memory optimization (cleared on reload). Keep it bounded to prevent unbounded growth.
const BLOB_URL_BASE64_CACHE_MAX = 80;
const blobUrlToBase64Cache = new Map();
function cacheGet(key) {
    if (!key) return null;
    const v = blobUrlToBase64Cache.get(key);
    if (v) {
        // refresh LRU order
        blobUrlToBase64Cache.delete(key);
        blobUrlToBase64Cache.set(key, v);
    }
    return v || null;
}
function cacheSet(key, value) {
    if (!key || !value) return;
    if (blobUrlToBase64Cache.has(key)) blobUrlToBase64Cache.delete(key);
    blobUrlToBase64Cache.set(key, value);
    if (blobUrlToBase64Cache.size > BLOB_URL_BASE64_CACHE_MAX) {
        const firstKey = blobUrlToBase64Cache.keys().next().value;
        if (firstKey) blobUrlToBase64Cache.delete(firstKey);
    }
}

// המרה לקובץ טקסט לשמירה — uses FileReader so it never touches the
// network stack (avoids Chrome extensions intercepting fetch(blob:...)).
export const fileToBase64 = (blob) => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
};

/**
 * Read a blob: URL into a Blob using XMLHttpRequest.
 * XHR bypasses Chrome's Fetch network stack, so extensions that intercept
 * fetch() cannot stall it. Falls back gracefully on failure.
 */
function fetchBlobSafe(blobUrl) {
    return new Promise((resolve) => {
        try {
            const xhr = new XMLHttpRequest();
            xhr.open('GET', blobUrl, true);
            xhr.responseType = 'blob';
            xhr.onload = () => resolve(xhr.response || null);
            xhr.onerror = () => resolve(null);
            xhr.ontimeout = () => resolve(null);
            xhr.timeout = 10000; // 10s hard cap
            xhr.send();
        } catch {
            resolve(null);
        }
    });
}

/**
 * Convert a data: URL to a Blob without using fetch().
 * fetch('data:...') can fail in Chrome (extension interference, strict
 * CSP, or large payloads). atob + Uint8Array is universal.
 */
function dataUrlToBlob(dataUrl) {
    try {
        const comma = dataUrl.indexOf(',');
        if (comma === -1) return null;
        const meta = dataUrl.slice(0, comma);
        const b64  = dataUrl.slice(comma + 1);
        const mime = (meta.match(/:(.*?);/) || [])[1] || 'application/octet-stream';
        const binary = atob(b64);
        const len = binary.length;
        const buf = new Uint8Array(len);
        for (let i = 0; i < len; i++) buf[i] = binary.charCodeAt(i);
        return new Blob([buf], { type: mime });
    } catch {
        return null;
    }
}

// Stable blob: URLs for repeated hydration (IndexedDB → workspace) — same data: URL must not create new object URLs each time.
// No LRU eviction: revoking a cached URL while a magnet still references it would break thumbnails. Cleared in resetSystem only.
const dataUrlToBlobUrlCache = new Map();

function dataUrlCacheGet(key) {
    if (!key) return null;
    return dataUrlToBlobUrlCache.get(key) || null;
}

function dataUrlCacheSet(key, url) {
    if (!key || !url) return;
    dataUrlToBlobUrlCache.set(key, url);
}

/** Call after blob: URLs from this cache were revoked elsewhere (e.g. resetSystem). */
export function clearDataUrlBlobUrlCache() {
    dataUrlToBlobUrlCache.clear();
}

// המרה חזרה לתמונה לתצוגה
// Uses atob-based conversion instead of fetch() so it never touches the
// network stack — fetch('data:...') can fail in Chrome (extension
// interception or CSP), while atob works universally.
export const base64ToBlobUrl = async (base64Data) => {
    if (!base64Data) return null;
    if (typeof base64Data === 'string' && base64Data.startsWith('blob:')) return base64Data;
    const hit = dataUrlCacheGet(base64Data);
    if (hit) return hit;
    try {
        const blob = dataUrlToBlob(base64Data);
        if (!blob) throw new Error('dataUrlToBlob returned null');
        const url = URL.createObjectURL(blob);
        dataUrlCacheSet(base64Data, url);
        return url;
    } catch (e) {
        console.error('Failed to convert base64 to blob', e);
        return null;
    }
};

// --- שמירת Workspace (טיוטה) ל-IndexedDB ---
export const saveStateToStorage = async (magnets, settings, editingId) => {
    try {
        // הכנת המגנטים
        const serializedMagnets = await Promise.all(magnets.map(async (m) => {
            // בפסיפס: לא שומרים את התמונה בתוך המגנט (חוסך מקום)
            if (m.isSplitPart) {
                const { originalBlob: _b, ...splitRest } = m;
                return { ...splitRest, originalSrc: null, src: null };
            }

            // במגנטים רגילים: שומרים את התמונה
            let base64Src = null;
            if (m.originalSrc && m.originalSrc.startsWith('blob:')) {
                base64Src = cacheGet(m.originalSrc);
                if (!base64Src) {
                    // Prefer the raw Blob/File stored at upload time — avoids
                    // fetch(blob:...) which Chrome extensions can intercept and
                    // stall (causing ERR_TIMED_OUT on what looks like a 200 OK).
                    const blobSource = m.originalBlob instanceof Blob
                        ? m.originalBlob
                        : await fetchBlobSafe(m.originalSrc);
                    if (blobSource) {
                        base64Src = await fileToBase64(blobSource);
                        cacheSet(m.originalSrc, base64Src);
                    }
                }
            } else {
                base64Src = m.originalSrc || m.src;
            }

            // Strip the in-memory originalBlob before persisting (Blob objects
            // aren't serializable across IndexedDB round-trips in all browsers).
            const { originalBlob: _blob, ...rest } = m;
            return { ...rest, originalSrc: base64Src, src: base64Src };
        }));

        // הכנת ההגדרות (כולל תמונת פסיפס ראשית)
        const serializedSettings = { ...settings };
        // splitImageCache הוסר מהמודל — אם הגיע מ-storage ישן, נסיר אותו לפני שמירה.
        delete serializedSettings.splitImageCache;
        
        if (settings.splitImageSrc && settings.splitImageSrc.startsWith('blob:')) {
            const cached = cacheGet(settings.splitImageSrc);
            if (cached) {
                serializedSettings.splitImageSrc = cached;
            } else {
                const blob = await fetchBlobSafe(settings.splitImageSrc);
                if (blob) {
                    const b64 = await fileToBase64(blob);
                    cacheSet(settings.splitImageSrc, b64);
                    serializedSettings.splitImageSrc = b64;
                }
            }
        }

        if (settings.giftImage && settings.giftImage.startsWith('blob:')) {
             const cached = cacheGet(settings.giftImage);
             if (cached) {
                serializedSettings.giftImage = cached;
             } else {
                const blob = await fetchBlobSafe(settings.giftImage);
                if (blob) {
                    const b64 = await fileToBase64(blob);
                    cacheSet(settings.giftImage, b64);
                    serializedSettings.giftImage = b64;
                }
             }
        }

        const workspaceData = {
            magnets: serializedMagnets,
            settings: serializedSettings,
            editingItemId: editingId,
            timestamp: Date.now()
        };

        // שימוש ב-setItem של idb.js
        await setItem(WORKSPACE_KEY, workspaceData);
        return true;

    } catch (e) {
        console.error('Failed to save Workspace to DB:', e);
        return false;
    }
};

// --- טעינת Workspace מ-IndexedDB ---
export const loadStateFromStorage = async () => {
    try {
        const data = await getItem(WORKSPACE_KEY);
        if (!data) return null;

        const hydratedSettings = { ...data.settings };
        // ניקוי שדה ישן מ-storage שמור (אם המשתמש לא ניקה את ה-IndexedDB).
        delete hydratedSettings.splitImageCache;

        // שחזור תמונות הגדרות
        if (hydratedSettings.splitImageSrc && hydratedSettings.splitImageSrc.startsWith('data:')) {
            hydratedSettings.splitImageSrc = await base64ToBlobUrl(hydratedSettings.splitImageSrc);
        }
        if (hydratedSettings.giftImage && hydratedSettings.giftImage.startsWith('data:')) {
            hydratedSettings.giftImage = await base64ToBlobUrl(hydratedSettings.giftImage);
        }

        // שחזור מגנטים
        const hydratedMagnets = await Promise.all(data.magnets.map(async (m) => {
            // אם זה פסיפס - משתמשים בתמונה מההגדרות
            if (m.isSplitPart) {
                return {
                    ...m,
                    src: hydratedSettings.splitImageSrc,
                    originalSrc: hydratedSettings.splitImageSrc
                };
            }

            // אם זה מגנט רגיל - משחזרים את התמונה שלו
            let objectUrl = m.originalSrc;
            if (m.originalSrc && m.originalSrc.startsWith('data:')) {
                objectUrl = await base64ToBlobUrl(m.originalSrc);
            }
            // הסרת שדה processed שאולי שרד ב-storage ישן (worker pipeline הוסר).
            const { processed: _legacyProcessed, processedOrder: _legacyOrder, ...rest } = m;
            return { ...rest, originalSrc: objectUrl, src: objectUrl };
        }));

        return {
            magnets: hydratedMagnets,
            settings: hydratedSettings,
            editingItemId: data.editingItemId
        };

    } catch (e) {
        console.error('Failed to load from DB:', e);
        return null;
    }
};

export const clearStorage = async () => {
    await removeItem(WORKSPACE_KEY);
};