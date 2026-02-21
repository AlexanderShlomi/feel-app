// src/lib/utils/storage.js

import { setItem, getItem, removeItem } from './idb.js';

const WORKSPACE_KEY = 'feel_app_workspace';

// המרה לקובץ טקסט לשמירה
export const fileToBase64 = (blob) => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
};

// המרה חזרה לתמונה לתצוגה
export const base64ToBlobUrl = async (base64Data) => {
    if (!base64Data) return null;
    try {
        const res = await fetch(base64Data);
        const blob = await res.blob();
        return URL.createObjectURL(blob);
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
                return { ...m, originalSrc: null, src: null, processed: {} };
            }

            // במגנטים רגילים: שומרים את התמונה
            let base64Src = null;
            if (m.originalSrc && m.originalSrc.startsWith('blob:')) {
                const blob = await fetch(m.originalSrc).then(r => r.blob());
                base64Src = await fileToBase64(blob);
            } else {
                base64Src = m.originalSrc || m.src;
            }

            return { ...m, originalSrc: base64Src, src: base64Src, processed: {} };
        }));

        // הכנת ההגדרות (כולל תמונת פסיפס ראשית)
        const serializedSettings = { ...settings };
        
        if (settings.splitImageSrc && settings.splitImageSrc.startsWith('blob:')) {
            const blob = await fetch(settings.splitImageSrc).then(r => r.blob());
            serializedSettings.splitImageSrc = await fileToBase64(blob);
        }
        
        if (settings.giftImage && settings.giftImage.startsWith('blob:')) {
             const blob = await fetch(settings.giftImage).then(r => r.blob());
             serializedSettings.giftImage = await fileToBase64(blob);
        }
        
        serializedSettings.splitImageCache = {}; 

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
                    originalSrc: hydratedSettings.splitImageSrc,
                    processed: {}
                };
            }

            // אם זה מגנט רגיל - משחזרים את התמונה שלו
            let objectUrl = m.originalSrc;
            if (m.originalSrc && m.originalSrc.startsWith('data:')) {
                objectUrl = await base64ToBlobUrl(m.originalSrc);
            }
            return { ...m, originalSrc: objectUrl, src: objectUrl, processed: {} };
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