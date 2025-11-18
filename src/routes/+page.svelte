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
    import { onMount, onDestroy, tick } from 'svelte'; 

    // --- קוד לניהול מצב (כרטיסיות עליונות) ---
    import { magnets, editorSettings } from '$lib/stores.js';
    
    function setMode(mode) {
        magnets.set([]);
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

    // --- 🔥 קוד קרוסלה ---
    let scrollContainerEl;
    const scrollStep = 300; // רוחב כרטיסייה (280) + רווח (20)

    let isAtStart = true;
    let isAtEnd = false;

    // פונקציה שבודקת אם הגענו לקצה
    function checkScroll() {
        if (!scrollContainerEl) return;
        const { scrollLeft, scrollWidth, clientWidth } = scrollContainerEl;
        isAtStart = scrollLeft < 10; 
        isAtEnd = (scrollWidth - scrollLeft - clientWidth) < 10;
    }

    onMount(async () => {
        await tick(); // מחכה שה-DOM יתעדכן ו-scrollContainerEl יקבל ערך
        checkScroll(); // בדוק במצב התחלתי
        if (scrollContainerEl) {
            scrollContainerEl.addEventListener('scroll', checkScroll);
        }
    });

    onDestroy(() => {
        if (scrollContainerEl) {
            scrollContainerEl.removeEventListener('scroll', checkScroll);
        }
    });

    // פונקציית הגלילה החדשה עם לוגיקת לולאה (Loop)
    function scrollCommunity(direction) {
        console.log('כפתור נלחץ. אלמנט הגלילה הוא:', scrollContainerEl); 
        if (!scrollContainerEl) return;
        
        checkScroll(); 

        if (direction === 1) { // כפתור "הבא" (ימינה)
            if (isAtEnd) {
                scrollContainerEl.scrollTo({ left: 0, behavior: 'smooth' });
            } else {
                scrollContainerEl.scrollBy({ left: scrollStep, behavior: 'smooth' });
            }
        } else { // כפתור "הקודם" (שמאלה)
            if (isAtStart) {
                scrollContainerEl.scrollTo({ left: scrollContainerEl.scrollWidth, behavior: 'smooth' });
            } else {
                scrollContainerEl.scrollBy({ left: -scrollStep, behavior: 'smooth' });
            }
        }
    }
    // --- 🔥 סוף קוד קרוסלה ---

    // --- קוד להפעלת וידאו בריחוף ---
    function handleVideoPlay(event) {
        const video = event.currentTarget.querySelector('.community-video');
        if (video) {
            video.play();
        }
    }
    function handleVideoPause(event) {
        const video = event.currentTarget.querySelector('.community-video');
        if (video) {
            video.pause();
        }
    }
    // --- סוף קוד וידאו ---
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
                <h4>
                    <svg class="card-icon" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
                        <path d="M487.938,162.108l-224-128a16,16,0,0,0-15.876,0l-224,128a16,16,0,0,0,.382,28l224,120a16,16,0,0,0,15.112,0l224-120a16,16,0,0,0,.382-28ZM256,277.849,65.039,175.548,256,66.428l190.961,109.12Z"/>
                        <path d="M263.711,394.02,480,275.061V238.539L256,361.74,32,238.539v36.522L248.289,394.02a16.005,16.005,0,0,0,15.422,0Z"/>
                        <path d="M32,362.667,248.471,478.118a16,16,0,0,0,15.058,0L480,362.667V326.4L256,445.867,32,326.4Z"/>
                    </svg>
                    <span>קולקציית תמונות</span>
                </h4>
                <p class="card-description">
                    בחרו את התמונות שמספרות את הסיפור שלכם. הממשק החכם שלנו מאפשר לכם לעצב כל תמונה בנפרד ולהפוך אות לסיפור על מגנט בגודל 5x5 ס"מ. תוכלו להוסיף אפקט שמתאים לרגע או למקד את הפריים בדיוק ברגע הנכון.
                </p>
            </a>
            
            <a 
                href="/uploader" 
                class="info-card fade-in-up" 
                use:scrollAnimation 
                style="--delay: 300ms;"
                on:click={() => setMode('split')}
            >
                <h4>
                    <svg class="card-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
                        <path d="M3 11h8V3H3v8zm2-6h4v4H5V5zM13 3v8h8V3h-8zm6 6h-4V5h4v4zM3 21h8v-8H3v8zm2-6h4v4H5v-4zM13 13v8h8v-8h-8zm6 6h-4v-4h4v4z"/>
                    </svg>
                    <span>פסיפס זכרונות מתמונה</span>
                </h4>
                <p class="card-description">
                    בחרו תמונה אחת אייקונית – כזו שמכילה עולם שלם. אנחנו נהפוך אותה לפסיפס מרשים המורכב מחלקי 5x5 ס"מ. תוכלו להגדיר את הגודל הכולל, לבחור את כמות החלקים, ולמקם את התמונה כך שכל הפרטים החשובים יקבלו את הבמה.
                </p>
            </a>

            <div 
                class="info-card fade-in-up" 
                use:scrollAnimation 
                style="--delay: 400ms;"
            >
                <h4>
                    <svg class="card-icon" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
                        <g transform="translate(64.000000, 64.000000)">
                            <path d="M320,64 L320,320 L64,320 L64,64 L320,64 Z M171.749388,128 L146.817842,128 L99.4840387,256 L121.976629,256 L130.913039,230.977 L187.575039,230.977 L196.319607,256 L220.167172,256 L171.749388,128 Z M260.093778,128 L237.691519,128 L237.691519,256 L260.093778,256 L260.093778,128 Z M159.094727,149.47526 L181.409039,213.333 L137.135039,213.333 L159.094727,149.47526 Z M341.333333,256 L384,256 L384,298.666667 L341.333333,298.666667 L341.333333,256 Z M85.3333333,341.333333 L128,341.333333 L128,384 L85.3333333,384 L85.3333333,341.333333 Z M170.666667,341.333333 L213.333333,341.333333 L213.333333,384 L170.666667,384 L170.666667,341.333333 Z M85.3333333,0 L128,0 L128,42.6666667 L85.3333333,42.6666667 L85.3333333,0 Z M256,341.333333 L298.666667,341.333333 L298.666667,384 L256,384 L256,341.333333 Z M170.666667,0 L213.333333,0 L213.333333,42.6666667 L170.666667,42.6666667 L170.666667,0 Z M256,0 L298.666667,0 L298.6666667,42.6666667 L256,42.6666667 L256,0 Z M341.333333,170.666667 L384,170.666667 L384,213.333333 L341.333333,213.333333 L341.333333,170.666667 Z M0,256 L42.6666667,256 L42.6666667,298.666667 L0,298.666667 L0,256 Z M341.333333,85.3333333 L384,85.3333333 L384,128 L341.333333,128 L341.333333,85.3333333 Z M0,170.666667 L42.6666667,170.666667 L42.6666667,213.333333 L0,213.333333 L0,170.666667 Z M0,85.3333333 L42.6666667,85.3333333 L42.6666667,128 L0,128 L0,85.3333333 Z"/>
                        </g>
                    </svg>
                    <span>שימוש ב- AI</span>
                </h4>
                <p class="card-description">
                    רוצים להוסיף ברכה? כתבו את הרעיון, וה-AI שלנו ישפר וילטש אותה למסר מדויק ומרגש.
                    <br><br>
                    תוכלו לבחור גם תמונה על חשבוננינו ואנחנו, בעזרת טכנולוגיה מתקדמת, נעניק לה טוויסט עיצובי מפתיע. מגע ייחודי שנוצר רק מהרגע שלכם.
                </p>
            </div>

        </div>
    </section>

    <section class="community-section" use:scrollAnimation style="--delay: 300ms;">
        
        <div class="community-wrapper">
            <h2 class="community-title fade-in-up" use:scrollAnimation>מהקהילה שלנו</h2>

            <button class="scroll-btn left" on:click={() => scrollCommunity(-1)}>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
            </button>
            <button class="scroll-btn right" on:click={() => scrollCommunity(1)}>
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
            </button>

            <div class="community-scroll-container" bind:this={scrollContainerEl}>
                <div class="community-scroll-track">
                    
                    <div class="community-card" on:mouseenter={handleVideoPlay} on:mouseleave={handleVideoPause}>
                        <div class="community-video-placeholder">
                            <video class="community-video" src="/reels/community-video-1.mp4" playsinline muted loop preload="metadata"></video>
                        </div>
                        <div class="community-text-placeholder">
                            <div class="placeholder-line short"></div>
                            <div class="placeholder-line long"></div>
                        </div>
                    </div>

                    <div class="community-card" on:mouseenter={handleVideoPlay} on:mouseleave={handleVideoPause}>
                        <div class="community-video-placeholder">
                            <video class="community-video" src="/reels/community-video-2.mp4" playsinline muted loop preload="metadata"></video>
                        </div>
                        <div class="community-text-placeholder">
                            <div class="placeholder-line short"></div>
                            <div class="placeholder-line long"></div>
                        </div>
                    </div>

                    <div class="community-card" on:mouseenter={handleVideoPlay} on:mouseleave={handleVideoPause}>
                        <div class="community-video-placeholder">
                            <video class="community-video" src="/reels/community-video-3.mp4" playsinline muted loop preload="metadata"></video>
                        </div>
                        <div class="community-text-placeholder">
                            <div class="placeholder-line short"></div>
                            <div class="placeholder-line long"></div>
                        </div>
                    </div>

                    <div class="community-card" on:mouseenter={handleVideoPlay} on:mouseleave={handleVideoPause}>
                        <div class="community-video-placeholder">
                            <video class="community-video" src="/reels/community-video-4.mp4" playsinline muted loop preload="metadata"></video>
                        </div>
                        <div class="community-text-placeholder">
                            <div class="placeholder-line short"></div>
                            <div class="placeholder-line long"></div>
                        </div>
                    </div>

                    <div class="community-card" on:mouseenter={handleVideoPlay} on:mouseleave={handleVideoPause}>
                        <div class="community-video-placeholder">
                            <video class="community-video" src="/reels/community-video-5.mp4" playsinline muted loop preload="metadata"></video>
                        </div>
                        <div class="community-text-placeholder">
                            <div class="placeholder-line short"></div>
                            <div class="placeholder-line long"></div>
                        </div>
                    </div>

                    <div class="community-card" on:mouseenter={handleVideoPlay} on:mouseleave={handleVideoPause}>
                        <div class="community-video-placeholder">
                            <video class="community-video" src="/reels/community-video-6.mp4" playsinline muted loop preload="metadata"></video>
                        </div>
                        <div class="community-text-placeholder">
                            <div class="placeholder-line short"></div>
                            <div class="placeholder-line long"></div>
                        </div>
                    </div>

                </div> </div>
        </div> </section>
    </div>