<script>
    export let isOpen = false;

    function closeMenu() {
        isOpen = false;
    }
</script>

{#if isOpen}
    <div class="menu-backdrop active" on:click={closeMenu} />
{/if}

<div id="side-menu" class:active={isOpen}>
    <div class="menu-header">
        <div class="header-right"></div>
        <div class="header-center">
            <a href="/" class="logo">
                <img src="/Logo.svg" alt="FEEL Logo" class="logo-img">
            </a>
        </div>
        <div class="header-left">
            <button class="close-menu-btn header-icon-btn" on:click={closeMenu}>
                &times; </button>
        </div>
    </div>
    
    <ul>
        <li><a href="/"><span>א</span> אודות</a></li>
        <li><a href="/"><span>מ</span> מדיניות פרטיות</a></li>
        <li><a href="/"><span>צ</span> צור קשר</a></li>
    </ul>
</div>

<style>
    #side-menu {
        position: fixed;
        top: 0;
        right: -300px; 
        width: 300px; 
        height: 100vh;
        background: var(--color-light-gray); /* White */
        z-index: 2000;
        transition: right 0.3s ease-in-out;
        box-shadow: -5px 0 15px rgba(0,0,0,0.1);
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        overflow: hidden; /* מניעת גלילה מיותרת */
    }
    #side-menu.active {
        right: 0;
    }

    /* --- 🔥 עיצוב חדש לכותרת התפריט --- */
    .menu-header {
        display: grid;
        grid-template-columns: 1fr 1fr 1fr;
        align-items: center;
        padding: 10px 30px; /* התאמה לכותרת הראשית */
        border-bottom: 1px solid var(--color-canvas-bg); 
        background-color: var(--color-dark-blue); 
        height: 70px; /* גובה זהה לכותרת הראשית */
        box-sizing: border-box;
    }

    .menu-header .logo {
        display: flex;
        align-items: center; 
        text-decoration: none; 
        height: 50px; /* 🔥 גובה לוגו 50px */
    }
    
    .menu-header .logo .logo-img {
        height: 50px; /* 🔥 גובה לוגו 50px */
        width: auto;
    }

    /* 🔥 שימוש חוזר בעיצוב הכפתור מהקובץ הראשי */
    .close-menu-btn {
        background: none;
        border: none;
        color: var(--color-gold);
        cursor: pointer;
        padding: 5px;
        line-height: 1;
        font-size: 30px; /* גופן גדול יותר ל-X */
    }
    .close-menu-btn:hover {
        color: white;
    }
    /* --- סוף עיצוב חדש --- */

    
    .menu-backdrop { 
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0,0,0,0.5);
        z-index: 1999;
        animation: fadeIn 0.3s;
    }

    @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
    }
    
    #side-menu ul { 
        list-style: none;
        padding: 0; 
        margin: 20px;
        flex: 1;
        overflow-y: auto; /* גלילה רק בתוך התפריט אם צריך */
        overflow-x: hidden;
    }
    #side-menu li a {
        display: flex;
        align-items: center;
        padding: 15px 10px;
        text-decoration: none;
        color: var(--color-medium-blue-gray); /* Ink */
        font-size: 18px;
        font-weight: 600;
        border-radius: 8px;
    }
    #side-menu li a:hover { 
        background-color: var(--color-canvas-bg); /* Sand */
    }
    #side-menu li a span { 
        margin-left: 10px;
        font-style: italic;
        color: var(--color-pink);
    }
</style>