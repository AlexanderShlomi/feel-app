// src/lib/actions/draggable.js

export function draggable(node, params = {}) {
    let { 
        enabled = true, 
        containerBounds = null, // פונקציה שמחזירה גבולות: { minX, maxX, minY, maxY }
        onDragStart, 
        onDragMove, 
        onDragEnd 
    } = params;

    let isDragging = false;
    let startX, startY;
    let initialLeft, initialTop;
    let dragFrame;

    function getClientPos(event) {
        const source = event.touches ? event.touches[0] : event;
        return { x: source.clientX, y: source.clientY };
    }

    function handleStart(event) {
        if (!enabled) return;
        // במובייל, אנחנו רוצים למנוע גלילה רק אם התחלנו לגרור
        // אבל לא בהכרח בנגיעה הראשונה (כדי לא לחסום גלילה רגילה אם המשתמש רק רצה לגלול)
        
        const pos = getClientPos(event);
        startX = pos.x;
        startY = pos.y;
        
        const rect = node.getBoundingClientRect();
        // חישוב המיקום ההתחלתי של האלמנט ביחס ל-Parent הקרוב שממוצב (OffsetParent)
        initialLeft = node.offsetLeft;
        initialTop = node.offsetTop;

        window.addEventListener('mousemove', handleMove);
        window.addEventListener('mouseup', handleEnd);
        window.addEventListener('touchmove', handleMove, { passive: false }); // passive: false חשוב למניעת גלילה
        window.addEventListener('touchend', handleEnd);
        
        if (onDragStart) onDragStart({ x: startX, y: startY, element: node, event });
    }

    function handleMove(event) {
        const pos = getClientPos(event);
        const dx = pos.x - startX;
        const dy = pos.y - startY;

        // סף רגישות (Threshold) - לא מתחילים לגרור על פיקסל אחד
        if (!isDragging && Math.hypot(dx, dy) > 5) {
            isDragging = true;
            node.classList.add('draggable-active');
            // כאן אנחנו חוסמים את הגלילה של הדפדפן
            if (event.cancelable) event.preventDefault();
        }

        if (!isDragging) return;
        if (event.cancelable) event.preventDefault();

        if (dragFrame) cancelAnimationFrame(dragFrame);
        dragFrame = requestAnimationFrame(() => {
            let newLeft = initialLeft + dx;
            let newTop = initialTop + dy;

            // בדיקת גבולות (אם הוגדרו)
            if (containerBounds) {
                const bounds = containerBounds();
                if (bounds) {
                    newLeft = Math.max(bounds.minX, Math.min(newLeft, bounds.maxX));
                    newTop = Math.max(bounds.minY, Math.min(newTop, bounds.maxY));
                }
            }

            node.style.left = `${newLeft}px`;
            node.style.top = `${newTop}px`;
            
            if (onDragMove) onDragMove({ x: newLeft, y: newTop, dx, dy });
        });
    }

    function handleEnd(event) {
        window.removeEventListener('mousemove', handleMove);
        window.removeEventListener('mouseup', handleEnd);
        window.removeEventListener('touchmove', handleMove);
        window.removeEventListener('touchend', handleEnd);

        if (dragFrame) cancelAnimationFrame(dragFrame);
        node.classList.remove('draggable-active');

        if (isDragging) {
            // אם גררנו, צריך לעדכן את המיקום הסופי
            // אנחנו לא משנים את ה-DOM כאן אלא משדרים החוצה את המיקום הסופי
            // כדי שהלוגיקה העסקית (Grid) תחליט איפה להנחית את האלמנט
            const finalLeft = parseFloat(node.style.left);
            const finalTop = parseFloat(node.style.top);
            
            if (onDragEnd) onDragEnd({ x: finalLeft, y: finalTop, element: node });
        } else {
            // אם זו הייתה רק לחיצה ללא גרירה
            if (params.onPress) params.onPress(event);
        }
        
        isDragging = false;
        // איפוס סטייל זמני (המיקום האמיתי ייקבע ע"י ה-Store שיקבל את onDragEnd)
        node.style.left = ''; 
        node.style.top = '';
    }

    node.addEventListener('mousedown', handleStart);
    node.addEventListener('touchstart', handleStart, { passive: true });

    return {
        update(newParams) {
            enabled = newParams.enabled;
            containerBounds = newParams.containerBounds;
            onDragStart = newParams.onDragStart;
            onDragMove = newParams.onDragMove;
            onDragEnd = newParams.onDragEnd;
        },
        destroy() {
            node.removeEventListener('mousedown', handleStart);
            node.removeEventListener('touchstart', handleStart);
            window.removeEventListener('mousemove', handleMove);
            window.removeEventListener('mouseup', handleEnd);
            window.removeEventListener('touchmove', handleMove);
            window.removeEventListener('touchend', handleEnd);
        }
    };
}