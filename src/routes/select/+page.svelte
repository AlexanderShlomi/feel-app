<script>
    import { scrollAnimation } from '$lib/actions/scrollAnimation.js';
    import { resetSystem, PRODUCT_TYPES } from '$lib/stores.js';
    import { goto } from '$app/navigation';

    function handleSelectMagnets() {
        resetSystem(PRODUCT_TYPES.MAGNETS_PACK);
        goto('/uploader');
    }

    function handleSelectMosaic() {
        resetSystem(PRODUCT_TYPES.MOSAIC);
        goto('/uploader');
    }
</script>

<div class="selection-content">
    
    <div class="header-section fade-in-up" use:scrollAnimation>
        <h2>מה ניצור היום?</h2>
        <p class="subtitle">בחר את הסגנון שמתאים לזיכרונות שלך</p>
    </div>

    <div class="info-cards-grid selection-grid">
        
        <button 
            class="info-card selection-card fade-in-up" 
            use:scrollAnimation 
            style="--delay: 100ms;"
            on:click={handleSelectMagnets}
        >
            <h4>
                <svg class="card-icon" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
                    <path d="M487.938,162.108l-224-128a16,16,0,0,0-15.876,0l-224,128a16,16,0,0,0,.382,28l224,120a16,16,0,0,0,15.112,0l224-120a16,16,0,0,0,.382-28ZM256,277.849,65.039,175.548,256,66.428l190.961,109.12Z"/>
                    <path d="M263.711,394.02,480,275.061V238.539L256,361.74,32,238.539v36.522L248.289,394.02a16.005,16.005,0,0,0,15.422,0Z"/>
                    <path d="M32,362.667,248.471,478.118a16,16,0,0,0,15.058,0L480,362.667V326.4L256,445.867,32,326.4Z"/>
                </svg>
                <span>קולקציית תמונות</span>
            </h4>

            <div class="card-visual">
                <img src="/magnets-pack.png" alt="מגנטים בודדים" loading="eager" decoding="async" />
                
                <div class="hover-indicate">
                    <span>התחל לעצב</span>
                </div>
            </div>
        </button>

        <button 
            class="info-card selection-card fade-in-up" 
            use:scrollAnimation 
            style="--delay: 200ms;"
            on:click={handleSelectMosaic}
        >
            <h4>
                <svg class="card-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
                    <path d="M3 11h8V3H3v8zm2-6h4v4H5V5zM13 3v8h8V3h-8zm6 6h-4V5h4v4zM3 21h8v-8H3v8zm2-6h4v4H5v-4zM13 13v8h8v-8h-8zm6 6h-4v-4h4v4z"/>
                </svg>
                <span>תמונת פסיפס</span>
            </h4>

            <div class="card-visual">
                <img src="/mosaic-pack.png" alt="תמונת פסיפס" loading="eager" decoding="async" />

                <div class="hover-indicate">
                    <span>התחל לעצב</span>
                </div>
            </div>
        </button>

    </div>
</div>

<style>
    /* --- הגדרות כלליות לעמוד --- */
    .selection-content {
        min-height: calc(100dvh - 70px);
        min-height: calc(100dvh - 70px);
        display: flex;
        flex-direction: column;
        align-items: center;
        padding-top: 50px; /* רווח עליון זהה לדף הבית */
        padding-bottom: 60px;
        box-sizing: border-box;
        flex: 1; /* 🔥 ממלא את כל הגובה הזמין */
    }

    .header-section { 
        text-align: center; 
        margin-bottom: 50px; 
        padding: 0 20px;
    }
    
    /* כותרת ראשית - זהה במדויק ל-Info Title בדף הבית */
    .header-section h2 {
        font-family: 'Assistant', sans-serif;
        font-size: 2.5rem;
        color: var(--color-medium-blue-gray);
        margin: 0 0 15px 0;
        font-weight: 700;
        line-height: 1.2;
    }

    .subtitle {
        font-family: 'Assistant', sans-serif;
        font-size: 1.2rem;
        color: var(--color-dark-gray);
        margin: 0;
        line-height: 1.5;
    }

    /* --- הגדרות גריד --- */
    .selection-grid {
        max-width: 950px;
        grid-template-columns: 1fr 1fr;
        gap: 40px;
        padding: 0 20px;
        width: 100%;
        box-sizing: border-box;
    }

    /* --- תיקון ועיצוב הכרטיסייה --- */
    .selection-card {
        /* איפוס מלא של הגדרות כפתור דפדפן */
        appearance: none;
        -webkit-appearance: none;
        border: 1px solid rgba(0,0,0,0.05); /* מסגרת עדינה כמו בדף הבית */
        background: var(--color-light-gray);
        font-family: 'Assistant', sans-serif; /* חובה! */
        
        display: flex;
        flex-direction: column;
        padding: 30px;
        height: 450px; /* גובה קבוע */
        justify-content: flex-start;
        align-items: center;
        gap: 25px;
        
        border-radius: 24px; /* עיגול פינות */
        box-shadow: 0 4px 20px rgba(0,0,0,0.04);
        
        text-align: center;
        cursor: pointer;
        transition: transform 0.3s ease, box-shadow 0.3s ease, border-color 0.3s ease;
    }

    /* טיפול בכותרת בתוך הכרטיס */
    .selection-card h4 {
        font-family: 'Assistant', sans-serif;
        font-size: 1.5rem;
        font-weight: 700;
        color: var(--color-gold);
        margin: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 12px;
        width: 100%;
        transition: transform 0.3s ease;
    }

    /* --- עיצוב אזור התמונה --- */
    .card-visual {
        width: 100%;
        flex-grow: 1; /* ממלא את כל הגובה הנותר */
        border-radius: 16px;
        overflow: hidden;
        position: relative;
        background: #f5f5f5; /* רקע גיבוי */
    }

    .card-visual img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        transition: transform 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94);
    }

    /* אפקט Hover - שכבה כהה */
    .hover-indicate {
        position: absolute;
        top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(63, 82, 79, 0.85); /* צבע המותג בכהות */
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0;
        transition: opacity 0.3s ease;
    }

    /* כפתור דמה בתוך ה-Hover */
    .hover-indicate span {
        color: white;
        font-family: 'Assistant', sans-serif;
        font-weight: 700;
        font-size: 1.1rem;
        border: 2px solid white;
        padding: 12px 24px;
        border-radius: 50px;
        transform: translateY(15px);
        transition: transform 0.3s ease;
    }

    /* --- אינטראקציות --- */
    .selection-card:hover {
        transform: translateY(-8px);
        box-shadow: 0 15px 40px rgba(0,0,0,0.1);
        border-color: var(--color-gold);
    }

    .selection-card:hover h4 { 
        transform: translateY(-3px); 
        color: var(--color-medium-blue-gray); /* שינוי צבע כותרת בהובר */
    }

    .selection-card:hover .card-visual img { 
        transform: scale(1.08); 
    }
    
    .selection-card:hover .hover-indicate { 
        opacity: 1; 
    }
    
    .selection-card:hover .hover-indicate span { 
        transform: translateY(0); 
    }

    /* --- רספונסיביות למובייל --- */
    @media (max-width: 768px) {
        /* 🔥 תיקון פס שחור - רקע בהיר לכל הדף */
        :global(.page-container) {
            background-color: var(--color-canvas-bg) !important;
            min-height: 100dvh;
            min-height: 100dvh;
            height: auto;
        }
        
        .selection-content {
            padding-top: 20px;
            padding-bottom: 40px;
            min-height: calc(100dvh - 70px);
            min-height: calc(100dvh - 70px);
            height: auto;
            flex: 1;
        }

        .header-section {
            margin-bottom: 30px; /* הקטנת margin */
        }

        .header-section h2 {
            font-size: 1.75rem; /* הקטנת גודל כותרת */
            margin-bottom: 10px;
        }
        
        .subtitle {
            font-size: 1rem; /* הקטנת גודל תת-כותרת */
        }

        .selection-grid {
            grid-template-columns: 1fr;
            gap: 20px; /* הקטנת gap */
            padding: 0 16px; /* הקטנת padding */
        }
        
        .selection-card {
            height: auto; /* גובה אוטומטי */
            min-height: 260px; /* גובה מינימלי */
            max-height: 300px; /* גובה מקסימלי כדי למנוע גלילה */
            padding: 14px; /* הקטנת padding */
            gap: 14px; /* הקטנת gap פנימי */
        }
        
        .selection-card h4 {
            font-size: 1.25rem; /* הקטנת גודל כותרת כרטיס */
            gap: 8px;
        }
        
        .card-icon {
            width: 20px !important; /* הקטנת אייקון */
            height: 20px !important;
        }
    }
</style>