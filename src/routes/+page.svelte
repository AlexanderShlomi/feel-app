<svelte:head>
    <title>FEEL - דף הבית</title>
    <meta name="description" content="צור מגנטים אישיים" />
    
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Assistant:wght@400;600;700&display=swap" rel="stylesheet">
    
    <style>
        /* * התיקון הסופי (ללא :global)
         * סגנונות בתוך <svelte:head> הם גלובליים כברירת מחדל
        */

        /* 1. משחרר את הגלילה של כל הדף */
        body {
            overflow-y: auto !important;
            overflow-x: hidden !important;
        }
        
        /* 2. מבטל את נעילת הגובה ופריסת ה-Flex של העטיפה */
        .page-container {
            height: auto !important;
            display: block !important;
        }
    </style>
    
</svelte:head>

<script>
    import { scrollAnimation } from '$lib/actions/scrollAnimation.js';

    // --- קוד לניהול מצב (זהה לדף הבחירה) ---
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
            currentEffect: 'original', 
            splitImageCache: { 
                original: null,
                silver: null,
                noir: null,
                vivid: null,
                dramatic: null
            }
        });
    }
    // --- סוף קוד ניהול מצב ---
</script>

<div class="home-content">
    
    <div class="hero-container">
        
        <video class="hero-video" autoplay loop muted playsinline>
            <source src="/heroImag.mp4" type="video/mp4">
            הדפדפן שלך לא תומך בווידאו.
        </video>
        
        <div class="hero-text-overlay">
            <h1 class="hero-headline">לעצור את הזמן.
 להרגיש את הרגע.</h1>
            <p class="hero-subheadline">
                הפכו את הזיכרונות שלכם למתנות מרגשות.
 <br>
                חוויה שנוגעת בלב.
 </p>
        </div>
    </div>
    
    <a href="/select" id="home-shop-btn">בואו ניצור זיכרון</a>

    <section class="info-section">
        <h2 class="info-title fade-in-up" use:scrollAnimation>הופכים רגע לרגש, כך זה עובד</h2>
        <p class="info-description fade-in-up" use:scrollAnimation style="--delay: 100ms;">
            משלבים את הזכרונות הייחודים והכי יקרים שלכם עם מוצר סנטימינטאלי ונותנים לו גם נגיע טכנולוגית של בינה מלכותית מתקדמת, ליצירת חוויה אישית מדויקת.
 </p>

        <div class="info-cards-grid">
            
            <a 
                href="/uploader" 
                class="info-card fade-in-up" 
                use:scrollAnimation 
                style="--delay: 200ms;"
                on:click={() => setMode('multi')}
            >
                <h4>קולקציית תמונות אישית</h4>
                <p class="card-description">
                    בחרו את התמונות שמספרות את הסיפור שלכם. הממשק החכם שלנו מאפשר לכם לעצב כל תמונה בנפרד ולהפוך אות לסיפור על מגנט בגודל 5x5 ס"מ. תוכלו להוסיף אפקט שמתאים לרגע או למקד את הפריים בדיוק ברגע הנכון.
                    <br><br>
                    רוצים להוסיף ברכה? כתבו את הרעיון, וה-AI שלנו ישפר וילטש אותה למסר מדויק ומרגש.
                    <br><br>
                    תוכלו לבחור גם תמונה על חשבוננינו ואנחנו, בעזרת טכנולוגיה מתקדמת, נעניק לה טוויסט עיצובי מפתיע. מגע ייחודי שנוצר רק מהרגע שלכם.
                </p>
            </a>
            
            <a 
                href="/uploader" 
                class="info-card fade-in-up" 
                use:scrollAnimation 
                style="--delay: 300ms;"
                on:click={() => setMode('split')}
            >
                <h4>פסיפס זיכרונות מתמונה בודדת</h4>
                <p class="card-description">
                    בחרו תמונה אחת אייקונית – כזו שמכילה עולם שלם. אנחנו נהפוך אותה לפסיפס מרשים המורכב מחלקי 5x5 ס"מ. תוכלו להגדיר את הגודל הכולל, לבחור את כמות החלקים, ולמקם את התמונה כך שכל הפרטים החשובים יקבלו את הבמה.
                </p>
            </a>

        </div>
    </section>
    </div>