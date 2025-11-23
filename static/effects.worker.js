// This is effects.worker.js

/**
 * הפונקציה הראשית של ה-Worker.
 * היא מאזינה להודעות מהממשק הראשי.
 */
self.onmessage = async (event) => {
    const { magnetId, effectId, originalSrc } = event.data;

    try {
        // ✅ --- תיקון: טעינת תמונה ב-Worker ---
        // 1. הורד את התמונה כ-Blob
        const response = await fetch(originalSrc);
        const blob = await response.blob();
        
        // 2. צור ממנה ImageBitmap (הדרך של Worker לראות תמונה)
        const image = await createImageBitmap(blob);
        // ------------------------------------

        // 3. צור קנבס זמני בזיכרון
        const canvas = new OffscreenCanvas(image.width, image.height);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(image, 0, 0);

        // 4. החל את הפילטר האיכותי 
        applyEffect(ctx, effectId, image.width, image.height);

        // 5. המר את התוצאה חזרה לקובץ תמונה
        const resultBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
        const newSrc = await blobToDataURL(resultBlob);

        // 6. שלח את התוצאה חזרה לממשק הראשי
        self.postMessage({
            status: 'success',
            magnetId,
            effectId,
            newSrc
        });

    } catch (error) {
        console.error('Worker error:', error);
        self.postMessage({
            status: 'error',
            magnetId,
            effectId,
            error: error.message
        });
    }
};

/**
 * פונקציה שממירה Blob חזרה ל-DataURL
 */
function blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

/**
 * "מנוע" הפילטרים.
 */
function applyEffect(ctx, effectId, width, height) {
    // קבל את כל הפיקסלים של התמונה
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data; // מערך הפיקסלים [R,G,B,A, R,G,B,A, ...]

    // עבור על כל פיקסל
    for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];

        let newR = r, newG = g, newB = b;

        switch (effectId) {
            case 'silver': {
                const gray = (r * 0.299) + (g * 0.587) + (b * 0.114);
                newR = gray * 1.1; // קצת יותר בהיר
                newG = gray * 1.1;
                newB = gray * 1.1;
                break;
            }
            case 'noir': {
                const gray = (r * 0.299) + (g * 0.587) + (b * 0.114);
                newR = gray * 1.5 - 10; // ניגודיות גבוהה
                newG = gray * 1.5 - 10;
                newB = gray * 1.5 - 10;
                break;
            }
            case 'vivid': {
                // זהו אלגוריתם פשוט ל-Saturate/Contrast
                const avg = (r + g + b) / 3;
                newR = avg + (r - avg) * 1.8; // הגברת רוויה
                newG = avg + (g - avg) * 1.8;
                newB = avg + (b - avg) * 1.8;
                break;
            }
            case 'dramatic': {
                // אלגוריתם פשוט ל-Sepia + Contrast
                newR = (r * 0.393 + g * 0.769 + b * 0.189) * 1.3;
                newG = (r * 0.349 + g * 0.686 + b * 0.168) * 1.2;
                newB = (r * 0.272 + g * 0.534 + b * 0.131) * 1.1;
                break;
            }
            case 'original':
            default:
                // אל תעשה כלום
                break;
        }

        // החזר את הפיקסלים המעובדים למערך
        data[i] = Math.min(255, Math.max(0, newR));
        data[i + 1] = Math.min(255, Math.max(0, newG));
        data[i + 2] = Math.min(255, Math.max(0, newB));
    }
    
    // צייר את הפיקסלים החדשים בחזרה לקנבס
    ctx.putImageData(imageData, 0, 0);
}