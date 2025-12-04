// static/effects.worker.js

self.onmessage = async (event) => {
    const { magnetId, effectId, originalSrc } = event.data;

    try {
        // 1. טעינת התמונה מה-URL (עובד מעולה גם עם Blob URL)
        const response = await fetch(originalSrc);
        const blob = await response.blob();
        
        // 2. יצירת ImageBitmap לעיבוד מהיר
        const image = await createImageBitmap(blob);

        // 3. הגדרת קנבס
        const canvas = new OffscreenCanvas(image.width, image.height);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(image, 0, 0);

        // 4. החלת הפילטר
        applyEffect(ctx, effectId, image.width, image.height);

        // 5. המרה חזרה ל-Blob (ולא למחרוזת Base64!)
        // אנחנו משתמשים ב-JPEG איכותי כדי לחסוך מקום, או PNG אם צריך שקיפות
        const resultBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.95 });

        // 6. שליחת ה-Blob הבינארי חזרה ל-Main Thread
        self.postMessage({
            status: 'success',
            magnetId,
            effectId,
            blob: resultBlob // שינוי: שולחים אובייקט, לא טקסט
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

// מנוע הפילטרים (ללא שינוי מהותי, רק הוסר קוד מיותר)
function applyEffect(ctx, effectId, width, height) {
    if (effectId === 'original') return;

    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;

    for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];

        let newR = r, newG = g, newB = b;

        switch (effectId) {
            case 'silver':
                const grayS = (r * 0.299) + (g * 0.587) + (b * 0.114);
                newR = newG = newB = grayS * 1.1;
                break;
            case 'noir':
                const grayN = (r * 0.299) + (g * 0.587) + (b * 0.114);
                const val = grayN * 1.5 - 20; // יותר דרמטי
                newR = newG = newB = val;
                break;
            case 'vivid':
                const avg = (r + g + b) / 3;
                newR = avg + (r - avg) * 1.6;
                newG = avg + (g - avg) * 1.6;
                newB = avg + (b - avg) * 1.6;
                break;
            case 'dramatic':
                newR = (r * 0.393 + g * 0.769 + b * 0.189) * 1.2;
                newG = (r * 0.349 + g * 0.686 + b * 0.168) * 1.1;
                newB = (r * 0.272 + g * 0.534 + b * 0.131) * 1.0;
                break;
        }

        data[i] = Math.min(255, Math.max(0, newR));
        data[i + 1] = Math.min(255, Math.max(0, newG));
        data[i + 2] = Math.min(255, Math.max(0, newB));
    }
    
    ctx.putImageData(imageData, 0, 0);
}