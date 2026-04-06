// static/effects.worker.js

self.onmessage = async (event) => {
    const { magnetId, effectId, originalSrc } = event.data;

    try {
        // 1. טעינת התמונה
        const response = await fetch(originalSrc);
        const blob = await response.blob();
        
        // 2. יצירת ImageBitmap לעיבוד מהיר
        const image = await createImageBitmap(blob);

        // 3. הגדרת קנבס ב-full-res (ללא פשרות על איכות).
        // כדי לשמור על ביצועים במובייל אנחנו נשענים על ctx.filter (GPU) במקום לולאות פיקסלים (CPU).
        const canvas = new OffscreenCanvas(image.width, image.height);
        const ctx = canvas.getContext('2d', { willReadFrequently: false });

        ctx.filter = getCanvasFilter(effectId);
        ctx.drawImage(image, 0, 0);
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