<svelte:head>
    <title>FEEL - בחירת מוצר</title>
</svelte:head>

<script>
    import { magnets, editorSettings } from '$lib/stores.js';

    function setMode(mode) {
        // איפוס המגנטים הקיימים
        magnets.set([]);
        
        // איפוס ההגדרות
        editorSettings.set({
            currentMode: mode,
            currentDisplayScale: 1.0,
            surfaceMinHeight: '100%',
            isSurfaceDark: false,
            splitImageSrc: null,
            splitImageRatio: 1,
            gridBaseSize: 3,
            
            // --- 🔥 התיקון כאן ---
            // מאפסים את האפקט חזרה ל"מקורי"
            currentEffect: 'original', 
            
            currentLayoutMode: 'centered', 
            splitImageCache: { 
                original: null,
                silver: null,
                noir: null,
                vivid: null,
                dramatic: null
            }
        });
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