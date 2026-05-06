// src/lib/utils/grid.js

import { get } from 'svelte/store';

/**
 * מחשב את המיקום הקרוב ביותר (סלוט) ברשת עבור נקודה נתונה (פיקסלים).
 * הפונקציה מחזירה תמיד את הסלוט הקרוב ביותר מתמטית — הטיפול בהתנגשות (Reflow / Push)
 * נעשה בקריאה הקוראת (`onMagnetDragEnd`) באמצעות `isSlotOccupied` + `reflowWithDraggedMagnet`.
 */
export function findBestTargetSlot(pixelX, pixelY, margin, gridStep, numCols) {
    const approxCol = Math.round((pixelX - margin) / gridStep);
    const approxRow = Math.round((pixelY - margin) / gridStep);

    let bestCol = Math.max(0, Math.min(approxCol, numCols - 1));
    let bestRow = Math.max(0, approxRow);

    return { col: bestCol, row: bestRow };
}

/**
 * עזר פנימי: ממיר מיקום פיקסלים לסלוט (col, row) לפי מערכת הצירים של הגריד.
 */
function pixelsToSlot(position, margin, gridStep) {
    const col = Math.round((position.x - margin) / gridStep);
    const row = Math.round((position.y - margin) / gridStep);
    return { col: Math.max(0, col), row: Math.max(0, row) };
}

/**
 * בודק האם הסלוט (col, row) תפוס ע"י מגנט אחר — מתעלם מה-`excludeId` (זה שנגרר כרגע).
 */
export function isSlotOccupied(magnets, col, row, margin, gridStep, excludeId = null) {
    for (const m of magnets) {
        if (excludeId && m.id === excludeId) continue;
        if (!m.position) continue;
        const slot = pixelsToSlot(m.position, margin, gridStep);
        if (slot.col === col && slot.row === row) return true;
    }
    return false;
}

/**
 * מסדר מחדש רשימת מגנטים לפי סדר קריאה (שמאל לימין, למעלה למטה).
 * מחזיר רשימה חדשה עם מיקומים מעודכנים.
 */
export function reflowMagnets(magnets, surfaceWidth, magnetSize, margin) {
    const gridStep = magnetSize + margin;
    const cols = Math.floor((surfaceWidth - margin) / gridStep);
    const numCols = Math.max(1, cols);

    // ממיינים את המגנטים הקיימים לפי המיקום הנוכחי שלהם
    // (כדי לשמור על הסדר היחסי שהמשתמש יצר)
    const sorted = [...magnets].sort((a, b) => {
        // סובלנות של חצי שורה כדי לא "לקפוץ" בגלל פיקסל
        const rowA = Math.round(a.position.y / gridStep);
        const rowB = Math.round(b.position.y / gridStep);
        if (rowA !== rowB) return rowA - rowB;
        return a.position.x - b.position.x;
    });

    // מסדרים מחדש ללא חורים
    return sorted.map((magnet, index) => {
        const row = Math.floor(index / numCols);
        const col = index % numCols;
        return {
            ...magnet,
            position: {
                x: margin + (col * gridStep),
                y: margin + (row * gridStep)
            }
        };
    });
}

/**
 * Reflow על התנגשות: כשמגנט נשמט לסלוט תפוס, אנחנו ממקמים אותו ב"אינדקס reading-order"
 * המבוקש (row × cols + col), דוחפים את שאר המגנטים קדימה ב-1, וממקמים את כולם
 * רציף משמאל-לימין, מלמעלה-למטה — בלי חורים ובלי חפיפות.
 *
 * @param {Array} magnets - רשימת המגנטים הנוכחית
 * @param {string} draggedId - מזהה המגנט שנגרר
 * @param {number} targetCol - עמודת היעד שנבחרה ע"י findBestTargetSlot
 * @param {number} targetRow - שורת היעד שנבחרה ע"י findBestTargetSlot
 * @param {number} surfaceWidth - רוחב המשטח לחישוב מספר עמודות
 * @param {number} magnetSize - גודל מגנט סופי (FullSize)
 * @param {number} margin - מרווח בין מגנטים
 * @returns {Array} מערך מגנטים חדש עם מיקומים מעודכנים
 */
export function reflowWithDraggedMagnet(magnets, draggedId, targetCol, targetRow, surfaceWidth, magnetSize, margin) {
    const gridStep = magnetSize + margin;
    const cols = Math.floor((surfaceWidth - margin) / gridStep);
    const numCols = Math.max(1, cols);

    const dragged = magnets.find(m => m.id === draggedId);
    if (!dragged) return magnets;

    const others = magnets.filter(m => m.id !== draggedId);

    // ממיינים את שאר המגנטים לפי המיקום הנוכחי שלהם (reading order: שורה ואז עמודה)
    others.sort((a, b) => {
        const slotA = pixelsToSlot(a.position || { x: 0, y: 0 }, margin, gridStep);
        const slotB = pixelsToSlot(b.position || { x: 0, y: 0 }, margin, gridStep);
        if (slotA.row !== slotB.row) return slotA.row - slotB.row;
        return slotA.col - slotB.col;
    });

    // מחשבים את האינדקס בסדר הקריאה לתוך הסלוט המבוקש
    const clampedCol = Math.max(0, Math.min(targetCol, numCols - 1));
    const clampedRow = Math.max(0, targetRow);
    const targetIndex = clampedRow * numCols + clampedCol;

    // אם המשתמש שמט מעבר לסוף הרשימה, פשוט מצרפים בסוף
    const insertIndex = Math.min(targetIndex, others.length);

    // משלבים את המגנט הנגרר ב-targetIndex; שאר המגנטים נדחפים אוטומטית קדימה ב-1
    const finalOrder = [
        ...others.slice(0, insertIndex),
        dragged,
        ...others.slice(insertIndex)
    ];

    // ממקמים מחדש רציף — בלי חורים ובלי חפיפות (משמאל-לימין, מלמעלה-למטה)
    return finalOrder.map((magnet, index) => {
        const row = Math.floor(index / numCols);
        const col = index % numCols;
        return {
            ...magnet,
            position: {
                x: margin + (col * gridStep),
                y: margin + (row * gridStep)
            }
        };
    });
}

/**
 * ממלא "חורים" עבור מגנטים חדשים שאין להם מיקום.
 */
export function placeNewMagnets(currentMagnets, surfaceWidth, magnetSize, margin) {
    const gridStep = magnetSize + margin;
    const cols = Math.floor((surfaceWidth - margin) / gridStep);
    const numCols = Math.max(1, cols);

    // מיפוי הסלוטים התפוסים
    const occupied = new Set();
    currentMagnets.forEach(m => {
        if (m.position && m.position.x > 0) {
            const c = Math.round((m.position.x - margin) / gridStep);
            const r = Math.round((m.position.y - margin) / gridStep);
            occupied.add(`${c},${r}`);
        }
    });

    return currentMagnets.map(magnet => {
        // אם למגנט כבר יש מיקום תקין, דלג עליו
        if (magnet.position && magnet.position.x > 0) return magnet;

        // חפש את הסלוט הפנוי הראשון
        let col = 0, row = 0;
        while (occupied.has(`${col},${row}`)) {
            col++;
            if (col >= numCols) {
                col = 0;
                row++;
            }
        }
        occupied.add(`${col},${row}`);

        return {
            ...magnet,
            position: {
                x: margin + (col * gridStep),
                y: margin + (row * gridStep)
            }
        };
    });
}