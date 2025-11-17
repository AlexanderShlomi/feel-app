// src/lib/actions/scrollAnimation.js

/**
 * אקשן של Svelte שמוסיף קלאס 'visible'
 * כשהאלמנט נכנס למסך
 */
export function scrollAnimation(node) {
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                node.classList.add('visible');
                // (אופציונלי: הפסק להאזין אחרי שהאנימציה קרתה)
                // observer.unobserve(node);
            }
        });
    }, {
        threshold: 0.1 // הפעל כשרק 10% מהאלמנט נראה
    });

    observer.observe(node);

    return {
        destroy() {
            observer.unobserve(node);
        }
    };
}