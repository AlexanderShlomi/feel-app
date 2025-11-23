<script>
    import { magnets } from '$lib/stores.js';
    import { page } from '$app/stores';

    // מאזין לשינויים במערך המגנטים וסופר אותם
    $: count = $magnets.length;

    // --- לוגיקה להצגה/הסתרה אוטומטית ---
    let isVisible = false;
    $: {
        const routeId = $page.route.id;
        // הצג רק בעמוד העורך הראשי או בעמוד העריכה
        if (routeId === '/uploader' || routeId === '/uploader/edit/[magnetId]') {
            isVisible = true;
        } else {
            isVisible = false;
        }
    }
</script>

{#if isVisible && count > 0}
    <a href="/" class="cart-counter-btn">
        <div class="cart-icon">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
                <path d="M7 18c-1.1 0-1.99.9-1.99 2S5.9 22 7 22s2-.9 2-2-.9-2-2-2zM1 2v2h2l3.6 7.59L3.62 15H19v-2H7l1.1-2h8.31l3.9-7H5.21L4.27 2H1zm16 16c-1.1 0-1.99.9-1.99 2s.89 2 1.99 2 2-.9 2-2-.9-2-2-2z"/>
            </svg>
        </div>
        <span>{count}</span>
    </a>
{/if}

<style>
    .cart-counter-btn {
        position: fixed;
        /* מיקום זהה לזה של Mixtiles (ימין עליון, שזה שמאל ב-RTL) */
        top: 20px;
        left: 30px; 
        z-index: 101; /* מעל ה-Header */
        
        /* שימוש בצבעי המותג שלנו */
        background-color: var(--color-pink); 
        color: white;
        
        padding: 10px 15px;
        border-radius: 25px;
        display: flex;
        align-items: center;
        gap: 8px;
        font-weight: 700;
        font-size: 16px;
        text-decoration: none;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        transition: transform 0.2s ease-out, opacity 0.3s;
    }

    .cart-counter-btn:hover {
        transform: scale(1.05);
    }

    .cart-icon {
        width: 20px;
        height: 20px;
    }

    .cart-icon svg {
        width: 100%;
        height: 100%;
    }
</style>