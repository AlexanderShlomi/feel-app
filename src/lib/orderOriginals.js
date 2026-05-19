// Order originals upload — stores the full-resolution source images in the
// private `order-originals` Storage bucket.
//
// Design mirrors orderThumbnails.js:
//   * Fire-and-forget: never throws, never blocks checkout success.
//   * Errors are logged to the console but silently swallowed.
//   * Safe to retry: Storage upsert=true, RPC uses jsonb || merge.
//
// Storage paths:
//   magnets_pack: {userId}/{orderId}/{itemId}/{magnetId}.{ext}
//   mosaic:       {userId}/{orderId}/{itemId}/source.{ext}
//
// Full resolution, no resizing — originals are used for physical printing.

const BUCKET = 'order-originals';

/**
 * Resolves a srcUrl (blob:, data:, or http/https) to a Blob.
 * Returns null on any failure — we never want to throw here.
 *
 * @param {string | null | undefined} src
 * @returns {Promise<Blob | null>}
 */
async function blobFromSrc(src) {
    if (!src || typeof src !== 'string') return null;
    const t = src.trim();
    if (!t) return null;
    try {
        if (t.startsWith('data:') || t.startsWith('blob:')) {
            const res = await fetch(t);
            if (!res.ok) return null;
            return res.blob();
        }
        if (t.startsWith('http://') || t.startsWith('https://')) {
            const res = await fetch(t, { mode: 'cors' });
            if (!res.ok) return null;
            return res.blob();
        }
    } catch {
        /* ignore */
    }
    return null;
}

/**
 * Derives a file extension from a Blob's MIME type (defaults to .jpg).
 * @param {Blob} blob
 * @returns {string}
 */
function extFromBlob(blob) {
    const mime = blob?.type ?? '';
    if (mime.includes('png')) return 'png';
    if (mime.includes('webp')) return 'webp';
    if (mime.includes('gif')) return 'gif';
    return 'jpg';
}

/**
 * Upload original images for a single cart item to Storage.
 * Returns a paths map { [magnetId | 'source']: storageObjectPath } or null on failure.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} userId
 * @param {string} orderId
 * @param {string} itemId
 * @param {object} cartItem  — single item from cart (cartSnapshot[i])
 * @returns {Promise<Record<string, string> | null>}
 */
async function uploadItemOriginals(supabase, userId, orderId, itemId, cartItem) {
    const paths = /** @type {Record<string, string>} */ ({});
    const type = cartItem?.type;
    const itemData = cartItem?.data;

    if (type === 'magnets_pack') {
        const magnets = itemData?.magnets;
        if (!Array.isArray(magnets) || magnets.length === 0) return null;

        const tasks = magnets
            .filter((m) => m && !m.hidden)
            .map(async (m) => {
                const src = m.srcUrl ?? m.originalSrc ?? m.src ?? null;
                const blob = await blobFromSrc(src);
                if (!blob || blob.size === 0) return;
                const ext = extFromBlob(blob);
                const path = `${userId}/${orderId}/${itemId}/${m.id}.${ext}`;
                const { error } = await supabase.storage
                    .from(BUCKET)
                    .upload(path, blob, { contentType: blob.type || 'image/jpeg', upsert: true });
                if (error) {
                    console.warn('Order original upload (magnet) failed:', error.message || error);
                    return;
                }
                paths[m.id] = path;
            });

        await Promise.all(tasks);
        return Object.keys(paths).length > 0 ? paths : null;
    }

    if (type === 'mosaic') {
        const src = itemData?.settings?.splitImageSrc ?? itemData?.splitImageSrc ?? itemData?.src ?? null;
        const blob = await blobFromSrc(src);
        if (!blob || blob.size === 0) return null;
        const ext = extFromBlob(blob);
        const path = `${userId}/${orderId}/${itemId}/source.${ext}`;
        const { error } = await supabase.storage
            .from(BUCKET)
            .upload(path, blob, { contentType: blob.type || 'image/jpeg', upsert: true });
        if (error) {
            console.warn('Order original upload (mosaic) failed:', error.message || error);
            return null;
        }
        paths['source'] = path;
        return Object.keys(paths).length > 0 ? paths : null;
    }

    // gift and unknown types have no source image to store
    return null;
}

/**
 * Upload all original images to Storage and patch order_items.
 *
 * Guarantees:
 *   - Never throws. Internal failures are logged via console.warn and
 *     swallowed, so callers can safely `await` it without try/catch.
 *   - Returns a Promise that resolves once every upload + the patch RPC are
 *     done. The checkout flow awaits this (bounded by a timeout) before
 *     clearing the cart and navigating, so printing-critical originals are
 *     persisted before the tab can be closed.
 *
 * Must be called after createCompleteOrderResilient returns (item_ids are
 * known). Runs concurrently with thumbnails — they are independent.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} userId
 * @param {string} orderId
 * @param {Array<object>} cartSnapshot  — snapshot of cart items at checkout time
 * @param {string[]} itemRowIds         — parallel array of order_items.id (from RPC)
 * @returns {Promise<{ uploaded: number; total: number }>}
 */
export function uploadOrderOriginalsInBackground(
    supabase,
    userId,
    orderId,
    cartSnapshot,
    itemRowIds
) {
    if (!userId || !orderId) return Promise.resolve({ uploaded: 0, total: 0 });
    if (!Array.isArray(itemRowIds) || itemRowIds.length === 0) {
        return Promise.resolve({ uploaded: 0, total: 0 });
    }
    if (!Array.isArray(cartSnapshot) || cartSnapshot.length === 0) {
        return Promise.resolve({ uploaded: 0, total: 0 });
    }

    return (async () => {
        try {
            const len = Math.min(cartSnapshot.length, itemRowIds.length);

            // Upload all items in parallel
            const uploadResults = await Promise.all(
                Array.from({ length: len }, (_, i) =>
                    uploadItemOriginals(
                        supabase,
                        userId,
                        orderId,
                        itemRowIds[i],
                        cartSnapshot[i]
                    )
                )
            );

            // Collect items that have at least one uploaded file
            const ids = /** @type {string[]} */ ([]);
            const pathsArr = /** @type {object[]} */ ([]);
            for (let i = 0; i < len; i++) {
                const p = uploadResults[i];
                if (p && Object.keys(p).length > 0) {
                    ids.push(itemRowIds[i]);
                    pathsArr.push(p);
                }
            }
            if (ids.length === 0) return { uploaded: 0, total: len };

            const { error } = await supabase.rpc('patch_order_item_original_paths', {
                p_item_ids: ids,
                p_paths_arr: pathsArr
            });
            if (error) console.warn('patch_order_item_original_paths:', error);
            return { uploaded: ids.length, total: len };
        } catch (e) {
            console.warn('Order originals backfill:', e);
            return { uploaded: 0, total: itemRowIds.length };
        }
    })();
}
