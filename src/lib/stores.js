// src/lib/stores.js

import { writable, get, derived } from 'svelte/store';
import { goto } from '$app/navigation';
import { saveStateToStorage, loadStateFromStorage, clearStorage, fileToBase64, base64ToBlobUrl } from '$lib/utils/storage.js';
import { setItem, getItem } from '$lib/utils/idb.js'; 

// 🔥 Store לניהול הטעינה הגלובלית
export const isGlobalLoading = writable(false);

// קבועים ומחירים
export const EXTRA_MAGNET_PRICE = 10;
export const BASE_MAGNET_SIZE = 150; 
export const SCALE_MIN = 1.35;      
export const SCALE_MAX = 2.16;        
export const SCALE_DEFAULT = 1.44; 
export const SPLIT_MAGNET_SIZE = BASE_MAGNET_SIZE * 1.15;
export const MULTI_MARGIN_PERCENT = 0.1; 
export const SPLIT_MARGIN_PERCENT = 0.015; 
export const MIN_GRID_BASE = 3; 

export const PRODUCT_TYPES = {
    MAGNETS_PACK: 'magnets_pack',
    MOSAIC: 'mosaic',
    GIFT: 'gift' 
};

export const PACKAGES = [
    { count: 9, price: 119, name: 'FEEL Moments' },
    { count: 12, price: 139, name: 'FEEL Story' },
    { count: 15, price: 159, name: 'FEEL Collection', recommended: true },
    { count: 24, price: 239, name: 'FEEL Gallery' },
    { count: 30, price: 289, name: 'FEEL Life' }
];

// IsMobile ו-Filters
const checkIsMobile = () => typeof window !== 'undefined' ? window.innerWidth <= 768 : false;
export const isMobile = writable(false);
if (typeof window !== 'undefined') {
    isMobile.set(checkIsMobile());
    window.addEventListener('resize', () => isMobile.set(checkIsMobile()));
}

export function getFilterStyle(effectId) {
    const f = getCssFilter(effectId);
    // iOS Safari still benefits from explicit -webkit-filter.
    return `filter: ${f}; -webkit-filter: ${f};`;
}

export function getCssFilter(effectId) {
    // Mobile-first: CSS filters are GPU-accelerated and significantly more reliable
    // than SVG filter URLs under transforms (especially iOS Safari).
    switch (effectId) {
        case 'silver':
            return 'grayscale(1) contrast(1.08) brightness(1.05)';
        case 'noir':
            return 'grayscale(1) contrast(1.35) brightness(0.95)';
        case 'vivid':
            return 'saturate(1.35) contrast(1.12) brightness(1.03)';
        case 'dramatic':
            return 'saturate(1.18) contrast(1.22) brightness(0.98)';
        case 'original':
        default:
            return 'none';
    }
}

// Workspace Stores
export const magnets = writable([]); 
export const editingItemId = writable(null);

export const editorSettings = writable({
    currentProductType: PRODUCT_TYPES.MAGNETS_PACK,
    currentDisplayScale: SCALE_DEFAULT, 
    isSurfaceDark: false,
    currentEffect: 'original',
    surfaceMinHeight: '100%',
    splitImageSrc: null,
    splitImageRatio: 1,
    gridBaseSize: 3,
    splitTransform: { zoom: 1, x: 0, y: 0, xPct: 0, yPct: 0 },
    splitImageCache: {},
    giftImage: null 
});

// Cart Store
export const cart = writable([]);
const CART_DB_KEY = 'feel_cart_db_v1';

if (typeof window !== 'undefined') {
    localStorage.removeItem('feel_cart');
    localStorage.removeItem('feel_cart_v2');
    localStorage.removeItem('feel_cart_v3');
    
    getItem(CART_DB_KEY).then(savedCart => {
        if (savedCart && Array.isArray(savedCart)) {
            cart.set(savedCart);
        }
    });
    
    cart.subscribe(async (val) => {
        try {
            await setItem(CART_DB_KEY, val);
        } catch (e) {
            console.error('DB Save Error:', e);
        }
    });
}

export const cartTotal = derived(cart, ($cart) => $cart.reduce((total, item) => total + item.price, 0));
export const cartCount = derived(cart, ($cart) => $cart.length);

// Auto Save + Init
let saveTimeout;
function triggerAutoSave() {
    if (typeof window === 'undefined') return;
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(async () => {
        const currentMagnets = get(magnets);
        if (currentMagnets.length > 0 || get(editorSettings).splitImageSrc) {
            await saveStateToStorage(currentMagnets, get(editorSettings), get(editingItemId));
        }
    }, 1000);
}
magnets.subscribe(() => triggerAutoSave());
editorSettings.subscribe(() => triggerAutoSave());

export async function initApp() {
    if (typeof window === 'undefined') return;
    if (window.location.pathname.includes('/uploader')) {
        const state = await loadStateFromStorage();
        if (state) {
            const unsub1 = magnets.subscribe(()=>{});
            const unsub2 = editorSettings.subscribe(()=>{});
            magnets.set(state.magnets);
            editorSettings.set(state.settings);
            if (state.editingItemId) editingItemId.set(state.editingItemId);
            unsub1(); unsub2();
        }
    }
}

export function calculatePrice(type, count) {
    if (type === PRODUCT_TYPES.MAGNETS_PACK) {
        if (count < 9) return 0;
        const reversed = [...PACKAGES].reverse();
        const base = reversed.find(p => count >= p.count) || PACKAGES[0];
        return base.price + ((count - base.count) * EXTRA_MAGNET_PRICE);
    } 
    else if (type === PRODUCT_TYPES.MOSAIC) {
        return PACKAGES[0].price + (Math.max(0, count - 9) * EXTRA_MAGNET_PRICE);
    }
    return 0;
}

// 🔥 פונקציית שמירה מעודכנת - אוכפת מתנה אחת בלבד
export async function saveWorkspaceToCart() {
    const currentMagnets = get(magnets);
    const settings = get(editorSettings);
    const editId = get(editingItemId);
    const type = settings.currentProductType;
    const count = currentMagnets.filter(m => !m.hidden).length;
    
    // בדיקת תקינות (רק אם זה לא מתנה בודדת)
    if (type !== PRODUCT_TYPES.GIFT && !editId && type === PRODUCT_TYPES.MAGNETS_PACK && count < 9) return false;

    isGlobalLoading.set(true);

    try {
        const serializeImg = async (src) => {
            if (src && src.startsWith('blob:')) {
                try {
                    const blob = await fetch(src).then(r => r.blob());
                    return await fileToBase64(blob);
                } catch (e) { return src; }
            }
            return src;
        };

        const serializeMagnets = async (list) => { 
             return Promise.all(list.map(async (m) => {
                if (type === PRODUCT_TYPES.MOSAIC) return { ...m, originalSrc: null, src: null, processed: {} };
                let safeSrc = m.originalSrc || m.src;
                if (safeSrc && safeSrc.startsWith('blob:')) {
                    try { const blob = await fetch(safeSrc).then(r => r.blob()); safeSrc = await fileToBase64(blob); } catch (e) {}
                }
                return { ...m, originalSrc: safeSrc, src: safeSrc, processed: {} };
            }));
        };

        // 1. שמירת המוצר הראשי (אם זה לא מצב עריכת מתנה בלבד)
        if (type !== PRODUCT_TYPES.GIFT) {
            const price = calculatePrice(type, count);
            const magnetsForCart = await serializeMagnets(currentMagnets);
            const settingsForCart = JSON.parse(JSON.stringify(settings));
            
            if (settingsForCart.splitImageSrc) {
                settingsForCart.splitImageSrc = await serializeImg(settings.splitImageSrc);
            }

            const mainItem = {
                id: editId || crypto.randomUUID(),
                type: type,
                timestamp: Date.now(),
                count: count,
                price: price,
                data: { magnets: magnetsForCart, settings: settingsForCart },
                previewImage: type === PRODUCT_TYPES.MOSAIC ? settingsForCart.splitImageSrc : magnetsForCart[0]?.src,
                title: type === PRODUCT_TYPES.MOSAIC ? 'פסיפס זכרונות' : 'מגנטים בודדים',
                subtitle: type === PRODUCT_TYPES.MOSAIC ? `${settings.gridBaseSize}x${Math.round(count/settings.gridBaseSize)} חלקים` : `${count} תמונות`
            };

            cart.update(items => {
                if (editId) return items.map(i => i.id === editId ? mainItem : i);
                return [...items, mainItem];
            });
        }

        // 2. שמירת המתנה (Singleton Logic)
        if (settings.giftImage) {
            const safeGiftImage = await serializeImg(settings.giftImage);
            
            // אם אנחנו במצב עריכה של מתנה ספציפית, נשמור עליה. אחרת ניצור חדשה.
            const isEditingGift = (type === PRODUCT_TYPES.GIFT && editId);
            const giftId = isEditingGift ? editId : crypto.randomUUID();

            const giftItem = {
                id: giftId,
                type: PRODUCT_TYPES.GIFT,
                timestamp: Date.now(),
                count: 1,
                price: 0,
                previewImage: safeGiftImage,
                title: 'מתנה: תמונה מעוצבת',
                subtitle: 'מגנט בגודל 5x5 מתנה',
                data: { settings: { ...settings, giftImage: safeGiftImage, currentProductType: PRODUCT_TYPES.GIFT } }
            };

            cart.update(items => {
                // 🔥 שלב קריטי: הסרת כל מתנה אחרת שקיימת בסל
                // אנחנו משאירים רק פריטים שהם לא מתנה, או את המתנה שאנחנו עורכים כרגע
                const cleanItems = items.filter(i => i.type !== PRODUCT_TYPES.GIFT || i.id === giftId);
                
                // הוספה או עדכון
                const existingIndex = cleanItems.findIndex(i => i.id === giftId);
                if (existingIndex >= 0) {
                    cleanItems[existingIndex] = giftItem;
                    return cleanItems;
                }
                return [...cleanItems, giftItem];
            });
        }

        resetSystem(PRODUCT_TYPES.MAGNETS_PACK);
        await clearStorage(); 
        goto('/select');
        return true;

    } catch (e) {
        console.error("Save error:", e);
        return false;
    } finally {
        isGlobalLoading.set(false);
    }
}

// 🔥 פונקציית עריכה מעודכנת

export async function editCartItem(itemId) {
    const cartItems = get(cart);
    const item = cartItems.find(i => i.id === itemId);
    if (!item) return;

    // 1. הפעלת מסך טעינה גלובלי
    isGlobalLoading.set(true);

    // 🔥 תיקון קריטי: איפוס מיידי של התצוגה למניעת "הבהוב" של המוצר הקודם
    magnets.set([]); 
    editorSettings.update(s => ({ 
        ...s, 
        splitImageSrc: null, // ניקוי רקע פסיפס אם היה
        splitImageCache: {},
        currentProductType: item.type // עדכון ראשוני של הסוג כדי שה-UI יתכונן
    }));

    try {
        const hydrateMagnetsPack = async (list) => { 
            return Promise.all(list.map(async (m) => {
                let validSrc = m.originalSrc;
                if (validSrc && validSrc.startsWith('data:')) validSrc = await base64ToBlobUrl(validSrc);
                return { ...m, originalSrc: validSrc, src: validSrc, processed: {} };
            }));
        };

        if (item.type === PRODUCT_TYPES.GIFT) {
            // לוגיקה למתנה
            // (כאן כבר יש לנו resetSystem בתוך הלוגיקה המקורית, אבל הניקוי למעלה מכסה גם את זה)
            resetSystem(PRODUCT_TYPES.GIFT);
            let giftImg = item.data.settings.giftImage;
            if (giftImg && giftImg.startsWith('data:')) giftImg = await base64ToBlobUrl(giftImg);
            
            editorSettings.update(s => ({ 
                ...s, 
                giftImage: giftImg,
                currentProductType: PRODUCT_TYPES.GIFT 
            }));
        } else {
            // לוגיקה רגילה לפסיפס/מגנטים
            const hydratedSettings = JSON.parse(JSON.stringify(item.data.settings));
            
            if (hydratedSettings.splitImageSrc?.startsWith('data:')) {
                hydratedSettings.splitImageSrc = await base64ToBlobUrl(hydratedSettings.splitImageSrc);
            }

            // שחזור מתנה ברקע (אם קיימת בסל)
            const existingGiftInCart = cartItems.find(i => i.type === PRODUCT_TYPES.GIFT);
            if (existingGiftInCart) {
                 let gImg = existingGiftInCart.data.settings.giftImage;
                 if (gImg?.startsWith('data:')) gImg = await base64ToBlobUrl(gImg);
                 hydratedSettings.giftImage = gImg;
            }

            // עדכון ההגדרות החדשות
            editorSettings.set(hydratedSettings);
            
            let recoveredMagnets;
            if (item.type === PRODUCT_TYPES.MOSAIC) {
                recoveredMagnets = item.data.magnets.map(m => ({
                    ...m, src: hydratedSettings.splitImageSrc, originalSrc: hydratedSettings.splitImageSrc, processed: {}
                }));
            } else {
                recoveredMagnets = await hydrateMagnetsPack(item.data.magnets);
            }
            
            // עדכון המגנטים החדשים
            magnets.set(recoveredMagnets);
        }
        
        editingItemId.set(itemId);
        
        // שמירה ל-Storage כדי ש-onMount בעמוד הבא יקרא את זה תקין (גיבוי)
        await saveStateToStorage(get(magnets), get(editorSettings), itemId);
        
        // מעבר עמוד
        await goto('/uploader');

    } catch(e) {
        console.error("Error editing item", e);
    } finally {
        // כיבוי מסך טעינה רק בסוף התהליך
        isGlobalLoading.set(false);
    }
}

export function removeCartItem(itemId) {
    cart.update(items => items.filter(i => i.id !== itemId));
    if (get(editingItemId) === itemId) {
        editingItemId.set(null);
        resetSystem(PRODUCT_TYPES.MAGNETS_PACK);
        clearStorage();
    }
}

export function resetSystem(targetType = PRODUCT_TYPES.MAGNETS_PACK) {
    const currentList = get(magnets);
    if (currentList.length > 0) currentList.forEach(m => {
        if (m.originalSrc?.startsWith('blob:')) URL.revokeObjectURL(m.originalSrc);
        if (m.src?.startsWith('blob:')) URL.revokeObjectURL(m.src);
        if (m.processed) {
            Object.values(m.processed).forEach(v => {
                if (typeof v === 'string' && v.startsWith('blob:')) URL.revokeObjectURL(v);
            });
        }
    });
    magnets.set([]);
    editingItemId.set(null);
    const s = get(editorSettings);
    if (s.splitImageSrc?.startsWith('blob:')) URL.revokeObjectURL(s.splitImageSrc);
    if (s.splitImageCache) {
        Object.values(s.splitImageCache).forEach(v => {
            if (typeof v === 'string' && v.startsWith('blob:')) URL.revokeObjectURL(v);
        });
    }
    
    editorSettings.set({
        currentProductType: targetType, currentDisplayScale: SCALE_DEFAULT, surfaceMinHeight: '100%', isSurfaceDark: false,
        splitImageSrc: null, splitImageRatio: 1, gridBaseSize: 3, currentEffect: 'original',
        splitTransform: { zoom: 1, x: 0, y: 0, xPct: 0, yPct: 0 }, splitImageCache: {}, giftImage: null
    });
    clearStorage();
}

export function getFullMagnetSize() { return BASE_MAGNET_SIZE * (get(editorSettings).currentDisplayScale || SCALE_DEFAULT); }
export function getMargin() { return getFullMagnetSize() * MULTI_MARGIN_PERCENT; }
export function addUploadedMagnets(files) {
    const newMags = Array.from(files).map(f => ({
        id: crypto.randomUUID(), transform: {zoom:1,x:0,y:0}, position:{x:0,y:0}, size: getFullMagnetSize(),
        originalSrc: URL.createObjectURL(f), src: URL.createObjectURL(f), activeEffectId:'original', isSplitPart:false, hidden:false, processed:{}
    }));
    magnets.update(l => [...l, ...newMags]);
}
export function updateMagnetProcessedSrc(id, eff, src) {
    magnets.update(l => l.map(m => {
        if (m.id !== id) return m;
        const prev = m.processed?.[eff];
        if (prev && prev !== src && typeof prev === 'string' && prev.startsWith('blob:')) {
            try { URL.revokeObjectURL(prev); } catch {}
        }
        return { ...m, processed: { ...m.processed, [eff]: src } };
    }));
}
export function updateMagnetTransform(id, tr) { magnets.update(l => l.map(m => m.id===id ? {...m, transform:tr} : m)); }
export function updateMagnetActiveEffect(id, eff) { magnets.update(l => l.map(m => m.id===id ? {...m, activeEffectId:eff} : m)); }