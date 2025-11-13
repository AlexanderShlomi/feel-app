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
                id: crypto.randomUUID(), // ID ייחודי
                transform: { zoom: 1, x: 0, y: 0 },
                position: { x: -9999, y: -9999 }, // מיקום התחלתי מחוץ למסך
                size: size,
                
                // --- ליבת הארכיטקטורה החדשה ---
                originalSrc: originalSrc, // המקור, תמיד נשמר
                
                // מטמון (Cache) של גרסאות מעובדות
                processed: {
                    original: originalSrc, // הגרסה המוצגת הראשונית
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
    // המר את כל הקבצים למגנטים (באופן א-סינכרוני)
    const newMagnetsPromises = Array.from(files).map(createMagnetFromFile);
    
    // חכה שכל ה-FileReaders יסיימו
    const newMagnets = await Promise.all(newMagnetsPromises);

    // עדכן את ה-store פעם אחת בלבד עם כל המגנטים החדשים
    magnets.update(currentList => [...currentList, ...newMagnets]);
    
    // הפונקציה מסיימת רק עכשיו, וה-await בעורך ישתחרר
}

/**
 * ✅ ארכיטקטורה חדשה: פונקציה שמעדכנת גרסה מעובדת ספציפית במטמון
 */
export function updateMagnetProcessedSrc(magnetId, effectId, newSrc) {
    magnets.update(currentList => 
        currentList.map(m => {
            if (m.id === magnetId) {
                // ודא שאובייקט 'processed' קיים
                const processed = m.processed || { original: m.originalSrc };
                return {
                    ...m,
                    processed: {
                        ...processed,
                        [effectId]: newSrc // עדכון הגרסה המעובדת
                    }
                };
            }
            return m;
        })
    );
}


// פונקציה שמוצאת מגנט ספציפי לעריכה
export function getMagnetById(id) {
    const currentMagnets = get(magnets);
    // ודא שהרשימה קיימת לפני החיפוש
    return currentMagnets ? currentMagnets.find(m => m.id === id) : null;
}

// פונקציה ששומרת נתוני עריכה בחזרה למגנט
export function updateMagnetTransform(id, newTransform) {
    magnets.update(currentList => 
        currentList.map(m => 
            m.id === id ? { ...m, transform: newTransform } : m
        )
    );
}