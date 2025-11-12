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
    currentEffect: 'original', // ✅ הוספנו את האפקט הפעיל
});

// --- פונקציות עזר לניהול המצב ---

// פונקציה שמוסיפה מגנטים חדשים לרשימה
export function addUploadedMagnets(files) {
    const size = getFullMagnetSize();
    Array.from(files).forEach(file => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const newMagnet = {
                id: crypto.randomUUID(), // ID ייחודי
                src: e.target.result,
                originalSrc: e.target.result,
                transform: { zoom: 1, x: 0, y: 0 },
                position: { x: -9999, y: -9999 },
                size: size
            };
            // 'update' היא הדרך הנכונה לעדכן "מחסן"
            magnets.update(currentList => [...currentList, newMagnet]);
        };
        reader.readAsDataURL(file);
    });
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