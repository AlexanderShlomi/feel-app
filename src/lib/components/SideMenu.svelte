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
    <ul>
        <li><a href="/"><span>א</span> אודות</a></li>
        <li><a href="/"><span>מ</span> מדיניות פרטיות</a></li>
        <li><a href="/"><span>צ</span> צור קשר</a></li>
    </ul>
</div>

<style>
    /* ה-CSS כאן הוא "מקומי" (scoped) 
      הוא משפיע *רק* על הרכיב הזה
    */
    #side-menu {
        position: fixed;
        top: 0;
        right: -250px; /* מתחיל מוסתר מחוץ למסך */
        width: 250px;
        height: 100vh;
        background: var(--color-light-gray); /* White */
        z-index: 2000;
        transition: right 0.3s ease-in-out;
        padding: 20px;
        box-shadow: -5px 0 15px rgba(0,0,0,0.1);
        box-sizing: border-box; 
    }
    #side-menu.active {
        right: 0; /* מחליק פנימה */
    }
    
    #menu-backdrop {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0,0,0,0.5);
        z-index: 1999;
        animation: fadeIn 0.3s;
    }
    
    #side-menu ul { 
        list-style: none; 
        padding: 0; 
        margin: 60px 0 0 0; 
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