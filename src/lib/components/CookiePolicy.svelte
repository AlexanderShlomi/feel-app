<script>
    import { fade, fly } from 'svelte/transition';
    import { requestOpenPrivacyPolicy } from '$lib/privacyCheckoutConsent.js';

    /** תאריך עדכון סטטי למסמך זה (עדכן בעת שינוי תוכן המדיניות) */
    const LAST_UPDATED_ISO = '2026-04-05';

    export let isOpen = false;
    export let close = () => {};

    $: lastUpdated = new Date(LAST_UPDATED_ISO).toLocaleDateString('he-IL', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    });

    function openPrivacyAndClose() {
        close();
        requestOpenPrivacyPolicy();
    }
</script>

{#if isOpen}
    <div class="privacy-overlay" transition:fade={{ duration: 300 }} on:click|self={close}>
        <div class="privacy-modal theme-scroll" transition:fly={{ y: 60, duration: 500, opacity: 0 }}>
            <header class="privacy-header">
                <div class="brand-line">FEEL • LUXURY MEMORIES</div>
                <h2>מדיניות קובצי עוגיות (Cookies) ואחסון מקומי – FEEL</h2>
                <div class="header-meta">
                    <span class="update-date">עודכן לאחרונה: {lastUpdated}</span>
                </div>
                <button class="close-x-btn" on:click={close} aria-label="סגור">&times;</button>
            </header>

            <div class="privacy-body" dir="rtl">
                <section>
                    <p>
                        מדיניות זו נועדה להסביר בשקיפות כיצד אנו ב-FEEL (באמצעות האתר feel-ya.com והאפליקציה)
                        עושים שימוש בטכנולוגיות אחסון נתונים על גבי המכשיר שלך. מדיניות זו מהווה חלק בלתי נפרד
                        מ־
                        <button type="button" class="inline-legal-link" on:click={openPrivacyAndClose}>
                            מדיניות הפרטיות
                        </button>
                        שלנו.
                    </p>
                </section>

                <section>
                    <h3>1. מהן עוגיות (Cookies) וטכנולוגיות אחסון מקומי?</h3>
                    <p>
                        קובצי עוגיות הם קבצי טקסט קטנים המוצבים על המכשיר שלך (מחשב, טלפון חכם או טאבלט) בעת
                        ביקור באתרים. בנוסף אליהם, קיימות טכנולוגיות דומות של &quot;אחסון מקומי&quot; (Local
                        Storage ו-IndexedDB), המאפשרות לאפליקציות אינטרנט לשמור נתונים ישירות על הדפדפן שלך
                        כדי להבטיח פעילות תקינה ורציפה.
                    </p>
                </section>

                <section>
                    <h3>2. כיצד אנו משתמשים בטכנולוגיות אלו?</h3>
                    <p>
                        כדי לספק לך חוויית יצירה ועיצוב מאובטחת ורציפה, FEEL משתמשת אך ורק בטכנולוגיות אחסון
                        החיוניות והכרחיות לתפעול השירות.
                    </p>
                    <p>אנו עושים שימוש בטכנולוגיית אחסון מקומי (IndexedDB) למטרות הבאות:</p>
                    <ul>
                        <li>
                            <strong>מניעת אובדן נתונים:</strong> שמירת מצב העריכה שלך (Workspace), התמונות
                            שהעלית ואזור החיתוך שבחרת, כדי שאלו לא ימחקו אם תרענן את העמוד או תסגור את
                            האפליקציה בטעות.
                        </li>
                        <li>
                            <strong>ניהול סל הקניות:</strong> שמירת הפריטים והקולקציות שהוספת לסל עד למעבר
                            לתשלום.
                        </li>
                        <li>
                            <strong>ביצועי אפליקציה:</strong> מתן אפשרות לטעינה ועיבוד מהיר של תמונות (באמצעות
                            Web Workers) ישירות על המכשיר שלך, מבלי להעמיס על שרתי הענן ומבלי להעביר נתונים
                            החוצה בשלבי העיצוב.
                        </li>
                    </ul>
                </section>

                <section class="highlight-section">
                    <h3>3. היעדר מעקב וצדדים שלישיים (Zero Tracking)</h3>
                    <p>אנו מכבדים את פרטיותך באופן מוחלט. נכון לעדכון מדיניות זו:</p>
                    <ul>
                        <li>איננו משתמשים בקובצי עוגיות למטרות פרסום ממוקד (Retargeting) או שיווק מחדש.</li>
                        <li>
                            איננו משתמשים בפיקסלים של צדדים שלישיים (כגון רשתות חברתיות או מנועי חיפוש) כדי
                            לעקוב אחר הרגלי הגלישה שלך.
                        </li>
                        <li>
                            הנתונים השמורים באחסון המקומי נותרים במכשירך בלבד ואינם משותפים עם מפרסמים או חברות
                            מידע.
                        </li>
                    </ul>
                </section>

                <section>
                    <h3>4. ניהול ושליטה על ידך</h3>
                    <p>
                        היות והטכנולוגיות בהן אנו משתמשים מוגדרות כ־&quot;חיוניות בהחלט&quot; (Strictly
                        Necessary) לצורך אספקת השירות שביקשת (עריכת התמונות ויצירת ההזמנה), איננו נדרשים על
                        פי חוק לבקש את הסכמתך להפעלתן מראש.
                    </p>
                    <p>עם זאת, השליטה המלאה נמצאת בידיים שלך:</p>
                    <ul>
                        <li>
                            באפשרותך למחוק את נתוני האתר בכל עת דרך הגדרות הדפדפן שלך (ניקוי מטמון ו-Site
                            Data).
                        </li>
                    </ul>
                    <p class="biometric-alert">
                        לתשומת ליבך: מחיקת האחסון המקומי של FEEL תוביל לאובדן מיידי של כל התמונות שטרם הוזמנו,
                        איפוס סביבת העבודה וריקון סל הקניות שלך.
                    </p>
                </section>

                <section>
                    <h3>5. שינויים במדיניות זו</h3>
                    <p>
                        אנו עשויים לעדכן מדיניות זו מעת לעת (לדוגמה, אם נחליט בעתיד להוסיף כלי אנליטיקה למידת
                        ביצועים). במקרה של שינוי מהותי הכולל הוספת עוגיות מעקב, אנו נעדכן מסמך זה ונדאג ליישם
                        מנגנון קבלת הסכמה (Cookie Banner) כנדרש בחוק.
                    </p>
                </section>

                <section>
                    <h3>6. צור קשר</h3>
                    <p>
                        לכל שאלה הנוגעת לשימוש בטכנולוגיות אחסון באפליקציה, ניתן לפנות אלינו בכתובת:
                        <a href="mailto:privacy@feel-ya.com">privacy@feel-ya.com</a>.
                    </p>
                </section>
            </div>

            <footer class="privacy-footer">
                <button class="accept-btn" on:click={close}>הבנתי, בואו נמשיך</button>
            </footer>
        </div>
    </div>
{/if}

<style>
    .privacy-overlay {
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        background: rgba(13, 13, 13, 0.8);
        backdrop-filter: blur(20px);
        z-index: 9000;
        display: flex;
        justify-content: center;
        align-items: center;
        padding: 20px;
    }

    .privacy-modal {
        background: #f2f0ec;
        color: #475160;
        width: 100%;
        max-width: 800px;
        max-height: 85vh;
        border-radius: 30px;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        box-shadow: 0 40px 100px rgba(0, 0, 0, 0.3);
        position: relative;
    }

    .privacy-header {
        padding: 35px 40px 25px;
        text-align: center;
        background: #eae5dd;
        border-bottom: 1px solid rgba(198, 178, 154, 0.3);
    }

    .brand-line {
        color: #846349;
        font-weight: 800;
        font-size: 10px;
        letter-spacing: 4px;
        margin-bottom: 10px;
        opacity: 0.8;
    }

    h2 {
        margin: 0;
        font-size: 22px;
        font-weight: 700;
        color: #1e2a38;
        line-height: 1.35;
    }

    .header-meta {
        margin-top: 8px;
        font-size: 12px;
        color: #888;
    }

    .close-x-btn {
        position: absolute;
        top: 25px;
        left: 25px;
        background: none;
        border: none;
        color: #846349;
        font-size: 38px;
        cursor: pointer;
        line-height: 1;
        transition: transform 0.2s;
    }

    .close-x-btn:hover {
        transform: scale(1.1);
        color: #1e2a38;
    }

    .privacy-body {
        padding: 40px 45px;
        overflow-y: auto;
        flex: 1;
        text-align: right;
    }

    section {
        margin-bottom: 35px;
    }

    h3 {
        color: #846349;
        font-size: 19px;
        margin-bottom: 15px;
        border-right: 4px solid #c6b29a;
        padding-right: 15px;
    }

    p,
    li {
        font-size: 15px;
        line-height: 1.8;
        color: #475160;
        margin-bottom: 10px;
    }

    ul {
        padding-right: 20px;
        list-style: circle;
    }

    .highlight-section {
        background: rgba(198, 178, 154, 0.1);
        padding: 25px;
        border-radius: 18px;
        border: 1px solid rgba(198, 178, 154, 0.2);
    }

    .biometric-alert {
        color: #1e2a38;
        font-weight: 700;
    }

    .inline-legal-link {
        display: inline;
        padding: 0;
        margin: 0;
        border: none;
        background: none;
        color: #1e2a38;
        font: inherit;
        font-weight: 700;
        text-decoration: underline;
        text-underline-offset: 3px;
        cursor: pointer;
    }

    .inline-legal-link:hover {
        color: #846349;
    }

    .privacy-body a {
        color: #1e2a38;
        text-decoration: none;
        border-bottom: 1px solid transparent;
        transition: 0.2s;
        font-weight: 600;
    }

    .privacy-body a:hover {
        border-bottom-color: #1e2a38;
    }

    .privacy-footer {
        padding: 30px;
        background: #eae5dd;
        text-align: center;
        border-top: 1px solid rgba(198, 178, 154, 0.3);
    }

    .accept-btn {
        background: #c6b29a;
        color: #ffffff;
        border: none;
        padding: 16px 60px;
        border-radius: 50px;
        font-weight: 800;
        font-size: 17px;
        cursor: pointer;
        transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
        box-shadow: 0 4px 15px rgba(198, 178, 154, 0.3);
    }

    .accept-btn:hover {
        transform: translateY(-3px);
        box-shadow: 0 8px 25px rgba(198, 178, 154, 0.5);
        background: #846349;
    }

    @media (max-width: 768px) {
        .privacy-modal {
            height: 100vh;
            max-height: 100vh;
            border-radius: 0;
        }

        .privacy-body {
            padding: 30px 25px;
        }

        h2 {
            font-size: 18px;
        }

        .close-x-btn {
            top: 15px;
            left: 15px;
        }
    }
</style>
