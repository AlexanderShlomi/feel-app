<svelte:head>
    <title>FEEL - בחירת מוצר</title>
</svelte:head>

<script>
    import { resetSystem } from '$lib/stores.js';

    function setMode(mode) {
        resetSystem(mode);
    }
</script>

<div class="selection-content">
    <h2>מה תרצה ליצור?</h2>
    
    <div class="product-selector">
        
        <a 
            href="/uploader" 
            class="product-select-btn" 
            id="select-multi-btn"
            on:click={() => setMode('multi')}
        >
             <div class="product-info">
                <h3>מגנטים בודדים</h3>
            </div>
            <img src="/mag.png" alt="מגנטים בודדים">
        </a>

        <a 
            href="/uploader" 
            class="product-select-btn" 
             id="select-split-btn"
            on:click={() => setMode('split')}
        >
            <div class="product-info">
                <h3>תמונת פסיפס</h3>
            </div>
            <img src="/pazel.png" alt="תמונת פסיפס">
        </a>

    </div>
</div>