const BUCKET = 'order-thumbnails';
const MAX_EDGE = 420;
const JPEG_QUALITY = 0.82;

/**
 * @param {string} src
 * @returns {Promise<Blob | null>}
 */
async function blobFromPreviewSource(src) {
    if (!src || typeof src !== 'string') return null;
    const t = src.trim();
    if (!t) return null;

    if (t.startsWith('data:')) {
        const res = await fetch(t);
        return res.blob();
    }
    if (t.startsWith('blob:')) {
        try {
            const res = await fetch(t);
            return res.blob();
        } catch {
            return null;
        }
    }
    if (t.startsWith('http://') || t.startsWith('https://')) {
        try {
            const res = await fetch(t, { mode: 'cors' });
            if (!res.ok) return null;
            return res.blob();
        } catch {
            return null;
        }
    }
    return null;
}

/**
 * @param {Blob} blob
 * @returns {Promise<Blob | null>}
 */
function jpegThumbnailBlob(blob) {
    return new Promise((resolve) => {
        if (typeof document === 'undefined') {
            resolve(blob.type.startsWith('image/') ? blob : null);
            return;
        }

        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            URL.revokeObjectURL(url);
            let { width, height } = img;
            if (width < 1 || height < 1) {
                resolve(null);
                return;
            }
            const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
            const w = Math.max(1, Math.round(width * scale));
            const h = Math.max(1, Math.round(height * scale));
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                resolve(null);
                return;
            }
            ctx.drawImage(img, 0, 0, w, h);
            canvas.toBlob(
                (out) => resolve(out),
                'image/jpeg',
                JPEG_QUALITY
            );
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            resolve(null);
        };
        img.src = url;
    });
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} userId
 * @param {string} orderId
 * @param {Array<{ previewImage?: string | null }>} cartItems
 * @returns {Promise<(string | null)[]>}
 */
export async function uploadOrderItemThumbnails(supabase, userId, orderId, cartItems) {
    if (!userId || !orderId || !Array.isArray(cartItems) || cartItems.length === 0) {
        return [];
    }

    const out = /** @type {(string | null)[]} */ ([]);

    for (let i = 0; i < cartItems.length; i++) {
        const item = cartItems[i];
        const raw = item?.previewImage;
        let publicUrl = null;

        try {
            const rawBlob = await blobFromPreviewSource(typeof raw === 'string' ? raw : '');
            if (rawBlob && rawBlob.size > 0) {
                const thumb = await jpegThumbnailBlob(rawBlob);
                const uploadBlob = thumb && thumb.size > 0 ? thumb : rawBlob;
                const path = `${userId}/${orderId}/${i}.jpg`;
                const { error } = await supabase.storage.from(BUCKET).upload(path, uploadBlob, {
                    contentType: 'image/jpeg',
                    upsert: true
                });
                if (!error) {
                    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
                    publicUrl = data?.publicUrl ?? null;
                }
            }
        } catch {
            publicUrl = null;
        }

        out.push(publicUrl);
    }

    return out;
}
