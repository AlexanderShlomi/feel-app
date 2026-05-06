// src/lib/actions/draggable.js
// Version: 1.1 (Decoupled Mobile/Desktop Logic)

export function draggable(node, params = {}) {
    let { 
        enabled = true, 
        containerBounds = null, 
        dragThreshold = 5, // שינוי: פרמטר חדש לשליטה ברגישות (נמוך לדסקטופ, גבוה למובייל)
        lockScroll = true, // שינוי: האם לחסום גלילה בזמן גרירה (בעיקר למובייל)
        onDragStart, 
        onDragMove, 
        onDragEnd,
        onPress 
    } = params;

    let isDragging = false;
    let suppressNextClick = false;
    let startX, startY;
    let initialLeft, initialTop;
    let dragFrame;
    // Safety timer: removes document suppressor if no click fires within 500ms after drag end.
    let suppressSafetyTimer = null;

    // Primary suppressor: fires when click lands on the dragged element or its children.
    function onClickCapture(event) {
        if (!enabled) return;
        if (!suppressNextClick) return;
        suppressNextClick = false;
        // Prevent accidental navigation/click handlers when the gesture was a drag.
        try { event.preventDefault(); } catch {}
        try { event.stopImmediatePropagation(); } catch {}
    }

    // Secondary suppressor: fires when the dragged element snapped away and the click
    // lands on a *different* element (e.g. another magnet tile at the drop position).
    // Registered on document in capture phase so it intercepts before any element handler.
    function suppressGlobalPostDragClick(event) {
        clearSuppressSafetyTimer();
        suppressNextClick = false;
        try { event.preventDefault(); } catch {}
        try { event.stopImmediatePropagation(); } catch {}
    }

    function clearSuppressSafetyTimer() {
        if (suppressSafetyTimer) {
            clearTimeout(suppressSafetyTimer);
            suppressSafetyTimer = null;
        }
    }

    function installGlobalClickSuppressor() {
        clearSuppressSafetyTimer();
        document.addEventListener('click', suppressGlobalPostDragClick, { capture: true, once: true });
        // Auto-remove if no click fires within 500 ms (e.g. user pressed Escape or focus moved).
        suppressSafetyTimer = setTimeout(() => {
            document.removeEventListener('click', suppressGlobalPostDragClick, true);
            suppressNextClick = false;
            suppressSafetyTimer = null;
        }, 500);
    }

    function removeGlobalClickSuppressor() {
        clearSuppressSafetyTimer();
        document.removeEventListener('click', suppressGlobalPostDragClick, true);
        suppressNextClick = false;
    }

    function getClientPos(event) {
        // תמיכה אחודה בטאץ' ובעכבר
        const source = event.touches ? event.touches[0] : event;
        return { x: source.clientX, y: source.clientY };
    }

    function handleStart(event) {
        if (!enabled) return;
        
        // מניעת הפעלה כפולה (אם יש גם עכבר וגם טאץ')
        if (event.type === 'mousedown' && event.button !== 0) return; // רק קליק שמאלי

        const pos = getClientPos(event);
        startX = pos.x;
        startY = pos.y;
        
        const rect = node.getBoundingClientRect();
        initialLeft = node.offsetLeft;
        initialTop = node.offsetTop;

        // הוספת האזנה לאירועים הגלובליים
        addGlobalListeners(event.type === 'touchstart');

        if (onDragStart) onDragStart({ x: startX, y: startY, element: node, event });
    }

    function handleMove(event) {
        const pos = getClientPos(event);
        const dx = pos.x - startX;
        const dy = pos.y - startY;

        // בדיקת סף רגישות (Threshold)
        if (!isDragging) {
            if (Math.hypot(dx, dy) > dragThreshold) {
                isDragging = true;
                suppressNextClick = true;
                node.classList.add('draggable-active');
            } else {
                // עדיין לא הגענו לסף הגרירה - לא עושים כלום
                return;
            }
        }

        // הגענו לכאן רק אם אנחנו במצב גרירה פעיל
        
        // חסימת גלילה (קריטי למובייל) - מופעל רק אם הוגדר בפרמטרים
        if (lockScroll && event.cancelable) {
            event.preventDefault();
        }

        if (dragFrame) cancelAnimationFrame(dragFrame);
        dragFrame = requestAnimationFrame(() => {
            let newLeft = initialLeft + dx;
            let newTop = initialTop + dy;

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
        removeGlobalListeners();
        
        if (dragFrame) cancelAnimationFrame(dragFrame);
        node.classList.remove('draggable-active');

        if (isDragging) {
            const finalLeft = parseFloat(node.style.left);
            const finalTop = parseFloat(node.style.top);
            if (onDragEnd) onDragEnd({ x: finalLeft, y: finalTop, element: node });

            // Dual-layer click suppression after drag:
            // 1. Element-level (onClickCapture): catches clicks that land on THIS element.
            // 2. Document-level (suppressGlobalPostDragClick): catches clicks that land on
            //    any OTHER element — this happens when the dragged tile snaps away from the
            //    cursor position and the click fires on a different magnet tile beneath.
            suppressNextClick = true;
            installGlobalClickSuppressor();
        } else {
            // טופל כלחיצה רגילה
            if (onPress) onPress(event);
        }
        
        isDragging = false;
        
        // ניקוי סטיילים זמניים (משאירים את המיקום לניהול ה-State החיצוני)
        node.style.left = ''; 
        node.style.top = '';
    }

    // ניהול מאזינים גלובליים בצורה מרוכזת
    function addGlobalListeners(isTouch) {
        if (isTouch) {
            // passive: false חובה כדי שנוכל לעשות preventDefault לגלילה
            window.addEventListener('touchmove', handleMove, { passive: false }); 
            window.addEventListener('touchend', handleEnd);
        } else {
            window.addEventListener('mousemove', handleMove);
            window.addEventListener('mouseup', handleEnd);
        }
    }

    function removeGlobalListeners() {
        window.removeEventListener('mousemove', handleMove);
        window.removeEventListener('mouseup', handleEnd);
        window.removeEventListener('touchmove', handleMove);
        window.removeEventListener('touchend', handleEnd);
    }

    // האזנה לאלמנט עצמו
    node.addEventListener('mousedown', handleStart);
    // passive: true כאן כדי לא לפגוע בביצועי גלילה לפני שהגרירה התחילה
    node.addEventListener('touchstart', handleStart, { passive: true });
    // Capture click early so nested click handlers (e.g. tile navigation) won't fire after a drag.
    node.addEventListener('click', onClickCapture, true);

    return {
        update(newParams) {
            enabled = newParams.enabled;
            containerBounds = newParams.containerBounds;
            dragThreshold = newParams.dragThreshold !== undefined ? newParams.dragThreshold : 5;
            lockScroll = newParams.lockScroll !== undefined ? newParams.lockScroll : true;
            onDragStart = newParams.onDragStart;
            onDragMove = newParams.onDragMove;
            onDragEnd = newParams.onDragEnd;
            onPress = newParams.onPress;
        },
        destroy() {
            node.removeEventListener('mousedown', handleStart);
            node.removeEventListener('touchstart', handleStart);
            node.removeEventListener('click', onClickCapture, true);
            removeGlobalListeners();
            removeGlobalClickSuppressor();
        }
    };
}