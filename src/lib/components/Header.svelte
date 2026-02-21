<script>
    import { createEventDispatcher } from 'svelte';
    import CartCounter from '$lib/components/CartCounter.svelte';

    const dispatch = createEventDispatcher();
    function toggleMenu() {
        dispatch('toggleMenu');
    }
</script>

<header class="app-header">
    <div class="header-right">
        <button class="hamburger-btn header-icon-btn" on:click={toggleMenu}>
            &#9776;
        </button>
    </div>
    
    <div class="header-center">
        <a href="/" class="logo">
            <img src="/Logo.svg" alt="FEEL Logo" class="logo-img">
        </a>
    </div>

    <div class="header-left">
        <CartCounter />
    </div>
</header>

<style>
    .app-header { 
        display: grid; 
        /* חלוקה ל-3 חלקים שווים בדיוק כמו בתפריט הצד */
        grid-template-columns: 1fr 1fr 1fr; 
        align-items: center; 
        
        /* 🔥 יישור קריטי: פדינג זהה לתפריט הצדדי (SideMenu) */
        padding: 10px 30px; 
        
        background: var(--color-dark-blue); 
        box-shadow: 0 2px 5px rgba(0,0,0,0.2); 
        z-index: 100; 
        
        /* גובה קבוע וחישוב נכון למניעת גלישה */
        height: 70px; 
        box-sizing: border-box;
        
        /* 🔥 Header קבוע במוביל ודסקטופ */
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        width: 100%;
    }
    
    .header-right { 
        justify-self: start; 
        display: flex; 
        align-items: center; 
    } 
    
    .header-center { 
        justify-self: center; 
        display: flex; 
        justify-content: center; 
        align-items: center;
        height: 100%;
    } 
    
    .header-left { 
        justify-self: end; 
        display: flex; 
        align-items: center; 
        gap: 10px; 
    } 
    
    .app-header .logo { 
        display: flex; 
        align-items: center; 
        cursor: pointer; 
        text-decoration: none; 
        
        /* גובה הלוגו מותאם לגובה הנותר (70px - 20px padding = 50px) */
        height: 50px; 
    }
    
    .app-header .logo .logo-img { 
        height: 100%; 
        width: auto; 
    }
    
    .header-icon-btn { 
        border: none; 
        background: none; 
        color: var(--color-gold); 
        font-size: 26px; 
        cursor: pointer; 
        padding: 5px; 
        line-height: 1; 
        display: flex;
        align-items: center;
    }
    
    .header-icon-btn:hover {
        color: white;
    }
</style>