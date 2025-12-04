// src/lib/utils/grid.js

import { get } from 'svelte/store';

/**
 * מחשב את המיקום הקרוב ביותר (סלוט) ברשת עבור נקודה נתונה (פיקסלים).
 */
export function findBestTargetSlot(pixelX, pixelY, margin, gridStep, numCols, occupiedSlotsFn) {
    // occupiedSlotsFn: פונקציה שמחזירה Set של סלוטים תפוסים ("col,row")
    // כדי לא לנחות על עצמנו או על אחרים אם אסור (כרגע מותר להחליף מקומות, אז נבדוק את הלוגיקה בהמשך)
    
    // הערכה גסה של השורה והעמודה
    const approxCol = Math.round((pixelX - margin) / gridStep);
    const approxRow = Math.round((pixelY - margin) / gridStep);
    
    // חיפוש הסלוט הפנוי/המתאים ביותר בסביבה הקרובה
    // כרגע הפונקציה מחזירה את הסלוט הקרוב ביותר מתמטית, הטיפול בהתנגשות ייעשה בחוץ
    let bestCol = Math.max(0, Math.min(approxCol, numCols - 1));
    let bestRow = Math.max(0, approxRow);

    return { col: bestCol, row: bestRow };
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