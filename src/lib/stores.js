// src/lib/stores.js
import { writable, get, derived } from 'svelte/store';

export const EXTRA_MAGNET_PRICE = 10;
export const BASE_MAGNET_SIZE = 150; 
export const SCALE_MIN = 1.35;    
export const SCALE_MAX = 2.16;    
export const SCALE_DEFAULT = 1.44; 
export const SPLIT_MAGNET_SIZE = BASE_MAGNET_SIZE * 1.15;
export const MULTI_MARGIN_PERCENT = 0.1; 
export const SPLIT_MARGIN_PERCENT = 0.015; 
export const MIN_GRID_BASE = 3; 
export const PACKAGES = [
    { count: 9, price: 119, name: 'FEEL Moments' },
    { count: 12, price: 139, name: 'FEEL Story' },
    { count: 15, price: 159, name: 'FEEL Collection', recommended: true },
    { count: 24, price: 239, name: 'FEEL Gallery' },
    { count: 30, price: 289, name: 'FEEL Life' }
];

const checkIsMobile = () => {
    if (typeof window !== 'undefined') {
        return window.innerWidth <= 768;
    }
    return false;
};

export const isMobile = writable(false);

if (typeof window !== 'undefined') {
    isMobile.set(checkIsMobile());
    window.addEventListener('resize', () => {
        isMobile.set(checkIsMobile());
    });
}

// SVG Filters Returned Here
export function getFilterStyle(effectId) {
    switch (effectId) {
        case 'silver': return 'filter: url(#filter-silver);';
        case 'noir': return 'filter: url(#filter-noir);';
        case 'vivid': return 'filter: url(#filter-vivid);';
        case 'dramatic': return 'filter: url(#filter-dramatic);';
        case 'original': default: return 'filter: none;';
    }
}

export const magnets = writable([]);
export const visibleMagnets = derived(magnets, ($magnets) => 
    $magnets.filter(m => !m.hidden)
);

export const editorSettings = writable({
    currentMode: 'multi', 
    currentDisplayScale: SCALE_DEFAULT, 
    isSurfaceDark: false,
    currentEffect: 'original',
    surfaceMinHeight: '100%',
    splitImageSrc: null,
    splitImageRatio: 1,
    gridBaseSize: 3,
    splitTransform: { zoom: 1, x: 0, y: 0, xPct: 0, yPct: 0 },
    splitImageCache: {},
    giftImage: null // 🔥 שדה חדש חובה! 🔥
});

function revokeMagnetUrls(magnetList) {
    magnetList.forEach(m => {
        if (m.originalSrc && m.originalSrc.startsWith('blob:')) URL.revokeObjectURL(m.originalSrc);
        if (m.processed) {
            Object.values(m.processed).forEach(url => {
                if (url && url.startsWith('blob:')) URL.revokeObjectURL(url);
            });
        }
    });
}

export function resetSystem(mode) {
    revokeMagnetUrls(get(magnets));
    magnets.set([]);
    
    const currentSettings = get(editorSettings);
    if (currentSettings.splitImageSrc && currentSettings.splitImageSrc.startsWith('blob:')) {
        URL.revokeObjectURL(currentSettings.splitImageSrc);
    }
    
    editorSettings.set({
        currentMode: mode,
        currentDisplayScale: 1.0,
        surfaceMinHeight: '100%',
        isSurfaceDark: false,
        splitImageSrc: null,
        splitImageRatio: 1,
        gridBaseSize: 3,
        currentEffect: 'original', 
        currentLayoutMode: 'centered', 
        splitTransform: { zoom: 1, x: 0, y: 0, xPct: 0, yPct: 0 },
        splitImageCache: { original: null, silver: null, noir: null, vivid: null, dramatic: null },
        giftImage: null // איפוס גם למתנה אם צריך
    });
}

export function getFullMagnetSize() {
    const scale = get(editorSettings).currentDisplayScale || SCALE_DEFAULT;
    return BASE_MAGNET_SIZE * scale;
}

export function getMargin() {
    return getFullMagnetSize() * MULTI_MARGIN_PERCENT; 
}

function createMagnetFromFile(file) {
    const size = getFullMagnetSize();
    const objectUrl = URL.createObjectURL(file);
    
    return {
        id: crypto.randomUUID(), 
        transform: { zoom: 1, x: 0, y: 0 },
        position: { x: 0, y: 0 }, 
        size: size,
        originalSrc: objectUrl, 
        src: objectUrl, 
        activeEffectId: 'original', 
        isSplitPart: false,
        hidden: false, 
        processed: {} 
    };
}

export async function addUploadedMagnets(files) {
    const newMagnets = Array.from(files).map(createMagnetFromFile);
    magnets.update(currentList => [...currentList, ...newMagnets]);
}

export function updateMagnetProcessedSrc(magnetId, effectId, newSrc) {
    magnets.update(currentList => 
        currentList.map(m => {
            if (m.id === magnetId) {
                const processed = m.processed || { original: m.originalSrc };
                if (processed[effectId] && processed[effectId].startsWith('blob:')) {
                    URL.revokeObjectURL(processed[effectId]);
                }
                return { ...m, processed: { ...processed, [effectId]: newSrc } };
            }
            return m;
        })
    );
}

export function updateMagnetTransform(id, newTransform) {
    magnets.update(currentList => 
        currentList.map(m => m.id === id ? { ...m, transform: newTransform } : m)
    );
}

export function updateMagnetActiveEffect(magnetId, effectId) {
     magnets.update(currentList => 
        currentList.map(m => m.id === magnetId ? { ...m, activeEffectId: effectId } : m)
    );
}