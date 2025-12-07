// static/effects.worker.js

self.onmessage = async (event) => {
    const { magnetId, effectId, originalSrc } = event.data;

    try {
        // 1. טעינת התמונה
        const response = await fetch(originalSrc);
        const blob = await response.blob();
        
        // 2. יצירת ImageBitmap לעיבוד מהיר
        const image = await createImageBitmap(blob);

        // 3. הגדרת קנבס
        const canvas = new OffscreenCanvas(image.width, image.height);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(image, 0, 0);

        // 4. החלת הפילטר (הפונקציה המעודכנת למטה)
        applyEffect(ctx, effectId, image.width, image.height);

        // 5. המרה חזרה ל-Blob
        const resultBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.95 });

        // 6. שליחה חזרה
        self.postMessage({
            status: 'success',
            magnetId,
            effectId,
            blob: resultBlob
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

// --- מנוע פילטרים מכויל ל-SVG ---
function applyEffect(ctx, effectId, width, height) {
    if (effectId === 'original') return;

    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;

    for (let i = 0; i < data.length; i += 4) {
        // המרה לטווח 0-1 לחישובים מדויקים
        const r = data[i] / 255;
        const g = data[i + 1] / 255;
        const b = data[i + 2] / 255;

        let newR = r, newG = g, newB = b;

        switch (effectId) {
            case 'silver':
                // תואם ל: feColorMatrix type="saturate" values="0" + Linear slope 1.1
                const grayS = (r * 0.2126) + (g * 0.7152) + (b * 0.0722);
                newR = newG = newB = grayS * 1.1;
                break;

            case 'noir':
                // תואם ל: Saturation 0 + Slope 1.5 + Intercept -0.1
                const grayN = (r * 0.2126) + (g * 0.7152) + (b * 0.0722);
                const val = (grayN * 1.5) - 0.1; 
                newR = newG = newB = val;
                break;

            case 'vivid':
                // תואם ל: Matrix values + Gamma
                // חיקוי מטריצת הצבעים מה-SVG
                newR = (r * 1.4) - 0.1;
                newG = (g * 1.4) - 0.1;
                newB = (b * 1.4) - 0.1;
                
                // חיקוי גמא (קירוב ל-exponent 1.1)
                newR = Math.pow(Math.max(0, newR), 1.1) * 1.2;
                newG = Math.pow(Math.max(0, newG), 1.1) * 1.2;
                newB = Math.pow(Math.max(0, newB), 1.1) * 1.2;
                break;

            case 'dramatic':
                // תואם ל: Saturation 1.2 -> Contrast 1.3/-0.05 -> Tint Matrix
                
                // 1. Saturation
                const lum = (r * 0.2126) + (g * 0.7152) + (b * 0.0722);
                let dr = lum + (r - lum) * 1.2;
                let dg = lum + (g - lum) * 1.2;
                let db = lum + (b - lum) * 1.2;

                // 2. Contrast
                dr = (dr * 1.3) - 0.05;
                dg = (dg * 1.3) - 0.05;
                db = (db * 1.3) - 0.05;

                // 3. Tint Matrix
                newR = (dr * 0.8) + (dg * 0.1) + (db * 0.1);
                newG = (dr * 0.1) + (dg * 0.8) + (db * 0.1);
                newB = (dr * 0.1) + (dg * 0.1) + (db * 0.8);
                break;
        }

        // חזרה לטווח 0-255 עם גבולות
        data[i] = Math.min(255, Math.max(0, newR * 255));
        data[i + 1] = Math.min(255, Math.max(0, newG * 255));
        data[i + 2] = Math.min(255, Math.max(0, newB * 255));
    }
    
    ctx.putImageData(imageData, 0, 0);
}