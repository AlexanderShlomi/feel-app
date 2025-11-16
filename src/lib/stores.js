import { writable, get } from 'svelte/store';

// --- קבועים גלובליים ---
export const BASE_MAGNET_SIZE = 100;
export const CSS_MAGNET_PADDING = 0; // v45: אין פדינג
export const MULTI_MARGIN_PERCENT = 0.25;
export const SPLIT_MARGIN_PERCENT = 0.05;
export const MIN_GRID_BASE = 3;

// --- חישובים נגזרים ---
export function getFullMagnetSize() {
    const scale = get(editorSettings).currentDisplayScale;
    return (BASE_MAGNET_SIZE * scale) + (CSS_MAGNET_PADDING * 2);
}

export function getMargin() {
    return getFullMagnetSize() * MULTI_MARGIN_PERCENT;
}

// --- "מחסן הנתונים" הראשי שלנו ---

// 1. מחזיק את רשימת כל המגנטים שעל המסך
export const magnets = writable([]);

// 2. מחזיק את ההגדרות הכלליות של העורך
export const editorSettings = writable({
    currentMode: 'multi', // 'multi' או 'split'
    currentDisplayScale: 1.0, 
    surfaceMinHeight: '100%',
    isSurfaceDark: false,
    splitImageSrc: null,
    splitImageRatio: 1, 
    gridBaseSize: 3,
    currentEffect: 'original', 
    
    splitImageCache: {
        original: null,
        silver: null,
        noir: null,
        vivid: null,
        dramatic: null
    }
});

// --- פונקציות עזר לניהול המצב ---

/**
 * ✅ ארכיטקטורה חדשה: הפונקציה הזו הופרדה כדי להחזיר Promise
 * היא קוראת קובץ בודד ומחזירה מגנט מוכן עם מטמון
 */
function createMagnetFromFile(file) {
    const size = getFullMagnetSize();
    
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const originalSrc = e.target.result;
            const newMagnet = {
                id: crypto.randomUUID(), 
                transform: { zoom: 1, x: 0, y: 0 },
                position: { x: -9999, y: -9999 }, 
                size: size,
                originalSrc: originalSrc, 
                
                // --- 🔥 הוספנו "זיכרון" אפקט אישי ---
                activeEffectId: 'original', 

                processed: {
                    original: originalSrc, 
                    silver: null,
                    noir: null,
                    vivid: null,
                    dramatic: null
                }
            };
            resolve(newMagnet);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

/**
 * ✅ ארכיטקטורה חדשה: הפונקציה הראשית היא עכשיו async
 * היא מחכה שכל הקבצים ייקראו לפני שהיא מוסיפה אותם ל-store
 */
export async function addUploadedMagnets(files) {
    const newMagnetsPromises = Array.from(files).map(createMagnetFromFile);
    const newMagnets = await Promise.all(newMagnetsPromises);
    magnets.update(currentList => [...currentList, ...newMagnets]);
}

/**
 * ✅ ארכיטקטורה חדשה: פונקציה שמעדכנת גרסה מעובדת ספציפית במטמון
 */
export function updateMagnetProcessedSrc(magnetId, effectId, newSrc) {
    magnets.update(currentList => 
        currentList.map(m => {
            if (m.id === magnetId) {
                const processed = m.processed || { original: m.originalSrc };
                return {
                    ...m,
                    processed: {
                        ...processed,
                        [effectId]: newSrc 
                    }
                };
            }
            return m;
        })
    );
}

/**
 * ✅ ארכיטקט
 * ורה חדשה: פונקציה לעדכון מטמון הפסיפס
 */
export function updateSplitImageCache(effectId, newSrc) {
    editorSettings.update(s => {
        const newCache = { ...s.splitImageCache, [effectId]: newSrc };
        return { ...s, splitImageCache: newCache };
    });
}

export function getMagnetById(id) {
    const currentMagnets = get(magnets);
    return currentMagnets ? currentMagnets.find(m => m.id === id) : null;
}

export function updateMagnetTransform(id, newTransform) {
    magnets.update(currentList => 
        currentList.map(m => 
            m.id === id ? { ...m, transform: newTransform } : m
        )
    );
}

// --- 🔥 פונקציות חדשות לניהול אפקטים ---

/**
 * מעדכן את האפקט הפעיל של מגנט בודד
 */
export function updateMagnetActiveEffect(magnetId, effectId) {
     magnets.update(currentList => 
        currentList.map(m => 
            m.id === magnetId ? { ...m, activeEffectId: effectId } : m
        )
    );
}

/**
 * "משדר" אפקט גלובלי לכל המגנטים (דורס בחירות אישיות)
 */
export function updateAllMagnetsActiveEffect(effectId) {
    magnets.update(currentList => 
        currentList.map(m => ({ ...m, activeEffectId: effectId }))
    );
}