// static/effects.worker.js

self.onmessage = async (event) => {
    const { magnetId, effectId, originalSrc } = event.data;

    try {
        // iOS Safari often lacks OffscreenCanvas support inside Workers.
        // In that case we report "unsupported" so UI can fall back to CSS filters (no blank states).
        if (typeof self.OffscreenCanvas === 'undefined' || typeof self.createImageBitmap === 'undefined') {
            self.postMessage({ status: 'unsupported', magnetId, effectId });
            return;
        }

        // 1. טעינת התמונה
        const response = await fetch(originalSrc);
        const blob = await response.blob();
        
        // 2. יצירת ImageBitmap לעיבוד מהיר
        // NOTE: Respect EXIF orientation to keep preview/effects consistent with <img> rendering.
        let image;
        try {
            image = await createImageBitmap(blob, { imageOrientation: 'from-image' });
        } catch {
            image = await createImageBitmap(blob);
        }

        // 3. קנבס: כדי לשמור על ביצועים במובייל, עושים downscale מתון לתצוגה/Preview.
        // איכות המקור נשמרת ב-originalSrc; המגנט משתמש בזה לחיתוך/תצוגה, וה-preview מספיק חד.
        const MAX_DIM = 2200;
        const scale = Math.min(1, MAX_DIM / Math.max(image.width, image.height));
        const outW = Math.max(1, Math.round(image.width * scale));
        const outH = Math.max(1, Math.round(image.height * scale));

        const canvas = new OffscreenCanvas(outW, outH);
        const ctx = canvas.getContext('2d', { willReadFrequently: false });

        ctx.filter = getCanvasFilter(effectId);
        ctx.drawImage(image, 0, 0, outW, outH);
        ctx.filter = 'none';

        // 5. המרה חזרה ל-Blob
        const resultBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.95 });

        // שחרור משאבים
        try { image.close(); } catch {}

        // 6. שליחה חזרה
        self.postMessage({
            status: 'success',
            magnetId,
            effectId,
            blob: resultBlob
        });

    } catch (error) {
        console.error('Worker error:', error);
        // שיפור אבחון מהקליינט (לפחות סוג השגיאה)
        self.postMessage({
            status: 'error',
            magnetId,
            effectId,
            error: error.message
        });
    }
};

function getCanvasFilter(effectId) {
    // Note: These are GPU-accelerated approximations of the former SVG filters.
    // We prefer responsiveness + full-res output over CPU pixel loops (which crash on iOS).
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