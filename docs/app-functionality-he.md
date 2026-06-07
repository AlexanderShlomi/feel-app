# תיעוד פונקציונליות — FEEL App

מסמך זה מתאר את מבנה האפליקציה, זרימות המשתמש, רכיבי ממשק, לוגיקת עסק ותשתיות טכניות. הוא מבוסס על קוד הפרויקט (SvelteKit, Supabase, IndexedDB).

**מחסנית טכנולוגית (תקציר):**

- **פרונט:** Svelte 5, SvelteKit, Vite  
- **אחסון מקומי:** IndexedDB (`FeelAppDB`, חנות `keyval`) דרך `src/lib/utils/idb.js`  
- **ענן:** Supabase (Auth, Postgres, RPC) — משתני סביבה `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY`  
- **ולידציה:** Zod (`src/lib/validation/`)  
- **עיבוד תמונה:** CSS Filters בלבד (הוסר Worker pipeline); קובץ `static/effects.worker.js` קיים כ-legacy בלבד

---

## עקרונות מחייבים (ביצועים, UX/UI, Mobile-First)

הסעיף הזה מגדיר דרישות איכות שהן **Non‑negotiable** בכל שינוי/פיצ'ר.

### ביצועים וזריזות (Performance)

- **טעינה**: ניווט בין מסכים, הידרציה, ורינדור ראשוני חייבים להיות מהירים ויציבים, בלי “קפיצות”/הבהובים מורגשים.
- **עריכה**: כל פעולת עריכה (Pan/Zoom/בחירת אזור/החלפת אפקט/שמירה) חייבת להרגיש מיידית; עיבוד כבד ירוץ ברקע (Worker) עם אינדיקציית טעינה קצרה ומדויקת בלבד.
- **גלילה**: גלילה חייבת להיות חלקה (במיוחד מובייל); אין חסימות מגע, “קפיצות” או ריצודים בזמן אינטראקציה.
- **אישור ושליחת הזמנה**: הצ'ק-אאוט (כולל יצירת הזמנה בשרת, העלאת thumbnails, ועדכון סטטוס תשלום דמו) חייב להיות מהיר ויעיל עם מצבי טעינה/שגיאה ברורים ולא חוסמים מעבר לנדרש.
- **אחזור הזמנות**: `/orders` חייב להיות יעיל — שאילתות, מבנה נתונים ותמונות ממוזערות צריכים לאפשר טעינה מהירה, גם למשתמש עם הרבה הזמנות.

### UX/UI — Pixel-Perfect, Native-Feeling

- **Mobile-first**: חוויית מובייל היא ה־baseline. דסקטופ מוסיף יכולות (hover, גרירה) אבל לא “מציל” UX חלש.
- **ללא גלילה מיותרת**: אין גלילה אופקית בשום מצב. אין גלילה אנכית כפולה/מיותרת בתוך רכיבים אם אפשר להציג את הפעולות בצורה טבעית.
- **תפריט קבוע**: התפריט/כותרת נשארים קבועים, והפעולות מוצגות באופן “נייטיב” — נגישות גבוהה, היררכיה ברורה, ללא צורך בגלילה כדי להגיע לפעולות עיקריות.
- **Dock/פעולות**: כפתורים, פאנלים צפים ומודאלים צריכים להיות מתוחים וממוקמים באופן מושלם, עם גדלי טאץ' נכונים, בלי חפיפות ובלי מצבים “חתוכים”.
- **Pixel-perfect**: כל רכיב ורכיב מיושר, מרווחים עקביים, ללא overflow שמייצר פסי גלילה/רווחים מיותרים.

### חווית משתמש — מעברים

- **ניווט גלובלי:** ב־`src/routes/+layout.svelte` מוצג פס טעינה דק בראש המסך כשה־store `$navigating` של SvelteKit פעיל — חיווי מיידי שהניווט התקבל.
- **מגנט → עורך:** ב־`Magnet.svelte` מוצג חיווי טעינה מקומי (עמעום/ספינר) בעת מעבר לעריכת מגנט.
- **עורך מגנט בודד** (`edit/[magnetId]/+page.svelte`): מלבן Skeleton ממורכז בגודל `FRAME_SIZE` (300×300px, כמו חלון המסכה) עם אנימציית **Pulse** ב־CSS (`@keyframes` על `opacity`, מחזור ~1.5s, `ease-in-out`) — משוב ויזואלי בזמן טעינה בלי לשנות את מיקום הפריים או הכפתורים. כשהתמונה המקורית מסיימת להיטען (`on:load`), ה־Skeleton יורד ב־**Fade-out** (מעבר `opacity` ב־CSS) ונגרע מה־DOM לאחר סיום המעבר; התמונה נכנסת ב־Fade-in כפי שמוגדר ברכיב.

### דיוק שיקוף תמונות אחרי עריכה (Critical)

- **קולקציה (Magnets)** ו־**פסיפס (Mosaic)**: כל תמונה שעוברת עריכה חייבת להיות משוקפת **בדיוק מקסימלי** בכל מקום שבו היא מוצגת:
  - בתצוגות מקדימות, על המשטח, בעורך, בסל, בצ'ק-אאוט, וב־thumbnails להזמנה.
  - אותם ערכי crop/pan/zoom/אפקט צריכים לשחזר את אותה פריים בלי “סטייה” בין מסכים/רזולוציות.
- הרינדור מתבצע על בסיס ה-Original Blobs בלבד תוך שימוש ב-CSS Transforms למניעת איבוד איכות וריצודים במובייל.

---

## מפת נתיבים (Routes)

| נתיב | תפקיד |
|------|--------|
| `/` | דף בית (Storytelling, CTA, קרוסלה) |
| `/select` | בחירת סוג מוצר (מגנטים / פסיפס) |
| `/uploader` | משטח עריכה ראשי |
| `/uploader/edit/[magnetId]` | עורך מגנט בודד |
| `/checkout` | צ'ק-אאוט, משלוח, מדיניות פרטיות, יצירת הזמנה בשרת, תשלום דמו |
| `/orders` | **ההזמנות שלי** — רשימת הזמנות + שורות + תמונות ממוזערות (משתמש מחובר, Supabase) |
| `/auth/callback` | השלמת OAuth (PKCE, החלפת `code` לסשן) |
| `/admin` | **ממשק Admin** — רשימת כל ההזמנות, פילטר סטטוס, pagination; שורות לחיצות לניווט |
| `/admin/orders/[orderId]` | **פרטי הזמנה — Admin** — כתובת, פריטים, production job panel (הודעת מתנה, תמונת מתנה, crop editor, הערות), עדכון סטטוס, שליחת מייל משלוח |
| `/admin/print` | **הדפסת מגנטים — Admin** — בחירת הזמנות (auto-suggest), תצוגה מקדימה A4 אוטומטית, כפתור הדפסה אחד |

---

## דף בית (`src/routes/+page.svelte`)

**מטרה:** שער כניסה מותגי המבוסס על גישת Storytelling ויזואלי.

**עיצוב:**

- שימוש נרחב בווידאו רקע (`/heroImag.mp4`) המשתרע על פני אזור ה־Hero (בקוד: מיכל `.hero-container`; הגובה מוגדר ב־CSS של הדף).
- פלטת צבעים בממשק: חול (Sand), ירוק־כהה / טורקיז מותג (Teal), זהב (Tan) — ראו סעיף [עיצוב](#עיצוב) בתחתית המסמך.

**התנהגות (אנימציות):**

- אפקט `fade-in-up` מופעל באמצעות **IntersectionObserver** דרך האקשן `scrollAnimation` (`src/lib/actions/scrollAnimation.js`): כשהאלמנט נכנס ל־viewport (סף ~10%), נוספת קלאס `visible`.
- הגלילה בדף הבית מוגדרת ב־`<svelte:head>` כך ש־`body` יאפשר גלילה אנכית וימנע גלילה אופקית מיותרת.

**רקע גלובלי ולייאאוט (עדכון):**

- `body` ו־`.page-container` משתמשים ברקע **חול (Sand)** — מניעת «פס שחור» בגלילה ארוכה; `min-height` עם **`100dvh`** (עם נפילה ל־`100vh`) לעקביות במובייל.
- `.page-container` גדל עם התוכן (`min-height` ולא נעילה ל־`100vh` בלבד); רוחב `100%` במקום `100vw` כדי להפחית גלילה אופקית.

**קטע אינפורמטיבי והנעה לפעולה**

- קישור/כפתור **«בואו ניצור זיכרון»** (`#home-shop-btn`) מוביל ל־`/select`.
- טקסט קבוע (בקוד): שילוב זיכרונות עם מוצר סנטימנטלי ונגיעה טכנולוגית של **בינה מלאכותית** מתקדמת (ליצירת חוויה אישית).

**כרטיסיות מידע**

- כותרת + אייקון + תיאור; ב־hover יש הנפשה ורקע מודגש סביב הכרטיס (עיצוב `.info-card`).
- לחיצה על כרטיס יכולה לפתוח ישירות זרימת יצירה: **קולקציית תמונות** או **פסיפס** — באמצעות `resetSystem` + מעבר ל־`/uploader`.

**קולקציית תמונות / פסיפס מהדף הראשי**

- כמו ב־`/select`, המשתמש נכנס למסלול המתאים אחרי `resetSystem(PRODUCT_TYPES.MAGNETS_PACK | MOSAIC)`.

**קרוסלת קהילה**

- מציגה סרטונים בסגנון Reels בתוך מיכל גלילה אופקי.
- **גלילה מעגלית:** פונקציית `scrollCommunity` בודקת אם הגענו לסוף/התחלה; אם כן — קופצת להתחלה או לסוף (Loop).
- **דסקטופ:** כפתורי חיצים לניווט; מרחק צעד גלילה מבוסס על `scrollStep` (למשל 300px).
- **נייד:** גלילה מבוססת מגע; הכרטיסים רחבים יותר — התאמה ב־CSS של הרכיב.

**ווידאו בכרטיסי קהילה**

- ב־hover (דסקטופ) מופעלת נגינה; ביציאה — השהיה (`handleVideoPlay` / `handleVideoPause`).

---

## דף בחירת מוצר (`src/routes/select/+page.svelte`)

**מטרה:** צומת החלטה לפני הכנסה לעורך (בעתיד יכול להרחיב לשירותים נוספים).

**עיצוב:** כרטיסי מידע גדולים עם אפקט hover עשיר (שכבה כהה + «התחל לעצב»).

**התנהגות:**

- **קולקציית תמונות:** `resetSystem(PRODUCT_TYPES.MAGNETS_PACK)` → `goto('/uploader')`.
- **פסיפס:** `resetSystem(PRODUCT_TYPES.MOSAIC)` → `goto('/uploader')`.

**מה עושה `resetSystem` בפועל** (`src/lib/stores.js`):

- משחרר `blob:` URLs קיימים (מניעת דליפות זיכרון).
- מאפס את מערך `magnets`, מבטל `editingItemId`.
- מאפס `editorSettings` לברירות מחדל (סוג מוצר, scale, רקע משטח, פסיפס, אפקט, מתנה וכו').
- קורא ל־`clearStorage()` — מוחק טיוטת Workspace מ־IndexedDB.

**הבדלי נייד / דסקטופ:** כרטיסים בעמודה אחת מול שתי עמודות; בנייד לחיצה ישירה במקום hover.

---

## דף העריכה וההעלאה — קולקציית תמונות (`src/routes/uploader/+layout.svelte`, `+page.svelte`)

**מחזור חיים (Lifecycle) — ביצועים:**

- משטח הקולקציה, ה־`FileUploader`, ה־Dock והפאנלים חיים ב־**`src/routes/uploader/+layout.svelte`** ו־**לא עוברים unmount** במעבר ל־`/uploader/edit/[magnetId]`. המשטח מוסתר ב־`display: none` בזמן עריכת מגנט בודד, כדי לשמור על טעינת תמונות מקורית (Original Blobs) ועל פענוח בזיכרון ללא הבהוב בחזרה לקולקציה.
- **`src/routes/uploader/+page.svelte`** ריק במכוון — התוכן נטען מה־layout. עמוד העורך (`edit/[magnetId]/+page.svelte`) מוצג ב־`<slot />` של אותו layout.
- **שחזור גלילה:** חזרה מ־`/uploader/edit/...` ל־`/uploader` משחזרת את מיקום הגלילה דרך `afterNavigate` + `sessionStorage` (מפתח `feel_uploader_scroll_v1`).
- **שער פעילות גלילה (`uploaderScrollActive`):** במובייל, store בוליאני שעוקב אחרי גלילת הקונטיינר **וגם** תנועת `visualViewport` (שינוי גובה address bar). שניהם נחשבים "גלילה" למניעת blank בהחלפת blob URLs תוך כדי תנועה. טיימר משותף `SCROLL_IDLE_MS = 460ms` — רק אחרי idle מתבצע flush של תור ההחלפות. פונקציית עזר `waitForUploaderScrollIdle()` משמשת לפני פעולות כבדות (autosave).
- **שימור סידור הגריד אחרי עריכה (Critical):** כשהמסך עובר ל־`display:none`, ה-`ResizeObserver` המאזין ל־`canvas-container` מקבל `contentRect.width = 0`. ב-`+layout.svelte` יש הגנה מפורשת — `if (newWidth <= 0) return;` בתוך ה-callback, וכן `if (surfaceWidth <= 0) return;` ב־`handleReflow` ו־`fillEmptySlots` — שמונעת ריפלו במצב מוסתר. ללא הגנה זו, `numCols` היה מחושב כ-1, וכל המגנטים היו נדחסים לעמודה אחת — ואז בחזרה מהעריכה הסידור המותאם של המשתמש היה נמחק.
- **מטמון Blob להידרציה:** ב־`src/lib/utils/storage.js`, `base64ToBlobUrl` משתמש במפה גלובלית (מפתח: מחרוזת `data:`) כדי שלא ייווצרו `createObjectURL` כפולים לאותו מקור בעת טעינת Workspace מה־IndexedDB. המפה מתנקה ב־`resetSystem` (יחד עם `clearDataUrlBlobUrlCache`).
- **תמונות:** רכיבי `<img>` רלוונטיים משתמשים ב־`decoding="async"` ו־`loading="eager"` במסלולי העורך/קולקציה כדי להפחית חסימת Main Thread ב־decode; על אריחי המגנט/פסיפס הוחלו `content-visibility: auto` ו־`contain-intrinsic-size` לסיוע בגלילה.

### מנוע הגריד החופשי (Layout Engine)

**בטעינה:** מוצג פקד **הוסף תמונות**; חוויית דסקטופ מאפשרת סידור «כמו על המקרר» — פילטרים, זום, בחירת אזור בתמונה למגנט.

**מצב התחלה:**

- טעינה מ־IndexedDB (רק בנתיב `/uploader` דרך `initApp`) או קבצים חדשים מ־`FileUploader` / `addUploadedMagnets`.
- **`placeNewMagnets`** (בלוגיקת הדף): מחפש סלוטים פנויים לפי מפת תפוסה וממקם תמונות חדשות בלי חפיפה.
- **היוריסטיקת השמה ראשונית עמידה:** בטעינה ראשונית, אם **לפחות מגנט אחד** ברשימה חסר מיקום תקין (`!m.position` או `x === 0 && y === 0`) — מופעל `fillEmptySlots`. הבדיקה רצה על כל המערך (`$magnets.some(...)`), ולא רק על המגנט הראשון, כדי שמיגרציה ישנה או הידרציה חלקית לא ישאירו מגנטים "תלויים" בלי מיקום.

### לוגיקה מתמטית (Reflow & Snap)

- **`draggable.js`:** אקשן Svelte ל־`mousedown` / `mousemove` (ודומים), חישוב `dx`/`dy` בזמן אמת. בדסקטופ-pack מקבל `containerBounds` שמונע יציאה אופקית מגבולות המשטח (Law B — אין גלילה אופקית).
- **Snap-to-Grid:** אחרי גרירה — `findBestTargetSlot` מעגל למיקום לפי `GridStep` (תמיד מחזיר את הסלוט הקרוב ביותר מתמטית, ללא בדיקת תפוסה).
- **מניעת חפיפה / Reflow:** ב-`onMagnetDragEnd` נבדקת התנגשות באמצעות `isSlotOccupied` (פרט למגנט הנגרר). אם הסלוט פנוי — snap רגיל. אם תפוס — `reflowWithDraggedMagnet` משבצת את המגנט הנגרר באינדקס reading-order של היעד, ודוחפת את שאר המגנטים קדימה ב-1, וממקמת את כולם רציף משמאל-לימין, מלמעלה-למטה.
- **גלילה:** נמנעת גלילה מיותרת עד שמלאים את המשטח; אז גלילה אנכית. בדסקטופ נוסף `clearance` תחתון של 140px ב-`updateSurfaceHeight` כדי שהשורה האחרונה לא תיחבא מאחורי ה-Glass Dock. בזמן גרירה, `onDragMove` מגדיל את `surfaceMinHeight` בזמן אמת כדי לאפשר גלילה אנכית חלקה (`onDragStart` מחשב baseline בודד פעם אחת לחיסכון).
- **יחידת בסיס:** `BASE_MAGNET_SIZE = 150` פיקסלים; גודל תצוגה = `150 × currentDisplayScale` (ברירת מחדל `SCALE_DEFAULT = 1.44` ⇒ ~216px).
- **Margin:** `MULTI_MARGIN_PERCENT = 0.1` (10% מגודל המגנט הסופי).
- **GridStep:** `FullSize + Margin`.
- **עמודות דסקטופ:** לפי `surfaceWidth`, נוסחה: `(width - margin) / gridStep`.
- **מיקום אבסולוטי:** `x = Margin + col × GridStep`, `y = Margin + row × GridStep`.
- **מעקב בגרירה:** עדכון סטייל בזמן אמת; בשחרור — הצמדה לרשת.
- **Occupancy:** `Set` של מפתחות `"col,row"` (משמש ב-`placeNewMagnets`); ב-`isSlotOccupied` הבדיקה מבוצעת ע"י סריקה ישירה של המגנטים והשוואת הסלוטים שלהם.
- **`reflowMagnets`:** כפתור «סדר מחדש» — מיון לפי Y ואז X ומילוי רציף.
- **`reflowWithDraggedMagnet`:** וריאנט מיוחד שנקרא מ-`onMagnetDragEnd` כשיש התנגשות; משלב את המגנט הנגרר באינדקס reading-order המבוקש לפני המיקום מחדש הרציף.

### מובייל — דריסת גריד

- ביטול מיקום אבסולוטי; **CSS Grid** קבוע `repeat(2, 1fr)`, `gap` ~16px, `aspect-ratio: 1/1`.
- **ביטול draggable** — גלילת עמוד חופשית.
- **גובה משטח דינמי** לפי מספר שורות.
- **Tap על מגנט:** מעבר ל־`/uploader/edit/[id]`.
- **Dock:** הסתרת «סדר מחדש» ו«גודל תצוגה» (`mobile-hidden`); אפקטים, רקע, +, מתנה, Upsell.

### לוגיקת תמונה בתוך המגנט (`Magnet.svelte`)

- `overflow: hidden` על wrapper; משתני CSS דינמיים מוזרקים ל-`style` של המגנט: `--magnet-size`, `--zoom`, `--tx`/`--ty` (תרגום בפיקסלים על אחרי scale), `--base-w`/`--base-h` (גודל הבסיס לפני זום, מחושב לפי `computeCoverBaseSize`), ו-`--bg-url`. בעבר התיעוד הזכיר `--pos-x`/`--pos-y` — אלה הוחלפו ב-`--tx`/`--ty` המבוססים על נוסחת המרה אחידה (`computeMaxTranslateFromBase` + `pctToTranslate`).
- בפסיפס בלבד נוספים `--bg-w`/`--bg-h`/`--bg-x`/`--bg-y` לרקע שנוסע כתמונה אחת בין התאים.
- **Cover** כברירת מחדל כשאין עריכה ידנית; יישור Portrait לרוב למעלה, Landscape למרכז.

#### רינדור דו-שכבתי במובייל (Two-Tier Rendering)

- **בדסקטופ:** ה-`<img>` משתמש ישירות ב-Blob המקורי (`originalSrc`).
- **במובייל:** בטעינה ראשונית `src = null` (Skeleton מוצג); לאחר שה-preview מוכן, מופעלת `swapDisplaySrcWhenReady()` שמחליפה את המקור **רק אחרי `decode()` מלא** — מניעת הבהוב/blank frames ב-iOS Safari.
- **שער גלילה (`uploaderScrollActive`):** החלפות מקור תמונה **נדחות** בזמן גלילה פעילה (כולל שינויי כתובת-bar ב-viewport). רק כשה-scroll idle (>460ms ללא תנועה) מתבצע flush של תור ההחלפות. מונע ריצוד/blank בזמן גלילה מהירה.

#### מדידת Frame סינכרונית בטעינה ראשונה

- אקשן `bindFrameMeasure(node, active)`: במעבר ראשון מבצע `measureSync()` — לוכד `clientWidth` **סינכרונית** לפני ש-`ResizeObserver` מספיק לשלוח callback.
- קריטי לגריד מובייל (100% של תא ≈ 50vw - gutters) שבו הקבוע `size` מה-store לא תואם את הרוחב ב-CSS בפועל.
- מונע הבהוב: ללא מדידה סינכרונית, ה-crop מחושב בפריים הראשון לפי גודל דסקטופ, ואז מתעדכן ב-RAF — גורם ל-flash.
- שימוש ריאקטיבי: `frameSize = $isMobile && !isSplitPart && measuredFrame > 0 ? measuredFrame : size`.

### פעולות על תמונה (דסקטופ — hover)

- **מחיקה** ו**עריכה** מתגלות בהובר על המגנט (כפתורים בפינות העליונות של ה-overlay).
- **הפרדת גרירה מלחיצה:** `dragstart` נחסם **רק** על `.surface-el` (לא window-wide) כדי לא לפגוע בבחירת טקסט. אירוע `click` **מבוטל** אם זוהתה גרירה (`dx²+dy² > threshold`) — מונע מצב שגרירת מגנט פותחת את מסך העריכה (fix קריטי לדסקטופ).
- **גרירה חופשית על הגריד עם snap:** המגנט נגרר עם העכבר, מתעדכן בזמן אמת, ובשחרור מתבצעת הצמדה לסלוט הקרוב ביותר ב-Grid (`findBestTargetSlot`).
- **גבולות גרירה (`containerBounds`):** הגרירה מוגבלת אופקית ל-`[0, surfaceWidth - itemFullSize]` — לא ניתן לגרור מעבר לקצה הימני/שמאלי של המשטח, כדי שלא תיווצר גלילה אופקית רגעית (Law B). אנכית — מאפשרים גרירה ללא חסם עליון, כדי לאפשר הרחבת המשטח דינמית.
- **הצמדת התנגשות (Push-Forward):** בעת drop על סלוט שכבר תפוס ע"י מגנט אחר — ה-`reflowWithDraggedMagnet` שם את המגנט הנגרר באינדקס reading-order של היעד ודוחף את כל היתר ב-1 קדימה. כל המגנטים מסודרים מחדש רציף משמאל-לימין, מלמעלה-למטה — בלי חורים ובלי חפיפות. אם הסלוט פנוי, נשמרת ההתנהגות של snap-רגיל בלי לגעת בשאר המגנטים (חופש לסידור עם רווחים, "כמו מגנטים על מקרר").
- **גלילה חיה בזמן גרירה:** `onDragMove` מגדיל את `surfaceMinHeight` בזמן אמת אם המגנט יורד מתחת לגבול הקיים — `onDragStart` מחשב baseline פעם אחת בלבד מ־`maxBottom` של שאר המגנטים, ב-`onDragMove` משווים מולו ומעדכנים את ה-store רק כשצריך (גובה רק עולה, לא יורד באמצע גרירה — מונע ריצוד).

### תפריט פעולות (Glass Dock)

- סדר מחדש, גודל תצוגה (`SCALE_MIN`–`SCALE_MAX`), רקע בהיר/כהה, הוספת תמונות, אפקטים גלובליים.
- **שמור ועדכן הזמנה:** רכיב **UpsellWidget** — חישוב מחיר, מינימום יחידות, הוספה/עדכון בסל.
- **מתנה:** `GiftButton` — עורך מתנה, סנכרון עם סל (Singleton).

**סטנדרטים מחייבים למסך זה (סיכום):**

- **אין גלילה אופקית** (לא במשטח ולא בדוק/פאנלים). מוגן בשני מנגנונים: `containerBounds` ב-`draggable.js` בזמן גרירה, ו-`overflow-x: hidden` על `.canvas-container:not(.split-center)` בדסקטופ כקו הגנה שני.
- **השורה האחרונה תמיד נגישה:** clearance תחתון של **140px** (`DESKTOP_DOCK_CLEARANCE_PX`) נוסף ל-`surfaceMinHeight` בדסקטופ-pack — כדי שהשורה התחתונה לא תיחבא מאחורי ה-Glass Dock הצף.
- **הפעולות העיקריות זמינות תמיד** בלי צורך בגלילה כדי “למצוא כפתור”.
- **תנועתיות חלקה** בזמן גרירה/זום/רינדור; כל עיבוד כבד עם Loader קצר וברור. בגרירה — `onDragMove` מתבצעת בתוך `requestAnimationFrame` של ה-`draggable` action ולא דורשת throttle נוסף.
- **שימור הסידור על פני מעברי מסכים:** המעבר ל-`/uploader/edit/[magnetId]` ובחזרה לא משנה את מיקומי המגנטים (ראו "שימור סידור הגריד אחרי עריכה" בסעיף ה-Lifecycle לעיל).

---

## מסך עריכת מגנט בודד (`src/routes/uploader/edit/[magnetId]/+page.svelte`)

**מטרה:** עורך ממוקד למגנט יחיד בקולקציה.

- **מסגרת:** ריבוע קבוע (בקוד: `FRAME_SIZE`, למשל 300×300px) כהדמיה להדפסה.
- **מסכה:** צל סביב אזור החיתוך; רקע מתכהה בזמן גרירה/מגע.
- **Loader מותג:** פס עליון + ספינר בעת עיבוד כבד.
- **גרירה + Clamping:** אין «חורים» לבנים בתוך המסגרת.
- **זום:** slider בטווח (למשל 1×–3×) מעל מינימום שמכסה את הגובה.
- **שמירה יחסית:** אחוזים ב־store לעומת פיקסלים קבועים.
- **אפקטים:** מקורי / Silver / Noir / Vivid / Dramatic — עיבוד ב־Worker כשמיישמים פילטר על פיקסלים.
- **Glass Dock:** איפוס, אפקטים, מחיקה, שמור (חזרה ל־`/uploader`).
  - **Wrap במובייל צר:** ב-viewport צר, ה-Dock משתמש ב-`flex-wrap: nowrap` עם גלילה אופקית momentum (`-webkit-overflow-scrolling: touch`), padding/gap מצטמצמים ב-`@media (max-width: 768px)`, ו-`max-width` מכבד safe-area insets (`calc(100vw - 12px - env(safe-area-inset-left/right))`). כפתורים ב-`flex-shrink: 0` — לא מתכווצים.

#### תמונה מקורית vs. Preview בזמן אינטראקציה

- **Idle:** העורך מציג את ה-**Blob המקורי** (`displaySrc`) — איכות מלאה.
- **בזמן Pan/Zoom:** מוחלף ל-`previewSrc` (downscale עד max 1600px, JPEG 92%) לביצועי רינדור חלקים.
- נוסחה: `resolvedEffectSrc = (isInteracting && previewSrc) ? previewSrc : displaySrc`.
- **דסקטופ בלבד:** במובייל, יצירת preview מדולגת כדי לא להכפיל עומס על תמונות גדולות.

#### שמירה מותנית בגאומטריה מקורית (Geometry Gate)

- `saveAndClose()` ממתין ל-`baseGeomReady` — Promise שמתמלא כש-`decodeNaturalSize(displaySrc)` מחזיר את מידות המקור האמיתיות.
- אם `baseNaturalW`/`baseNaturalH` עדיין לא נטענו (למשל תמונה כבדה) — השמירה חוסמת עד שהם זמינים.
- **מונע ratio drift:** ללא הגנה זו, חישוב ה-crop עלול להתבסס על מימדי ה-preview (1600px max) ולייצר `xPct`/`yPct` בעלי סטייה קלה מהמקור.

**דרישת דיוק:** התוצאה אחרי Save חייבת להיות זהה ויזואלית למצב בעורך (פריים/זום/מיקום/אפקט), כולל בשחזור מה־Workspace, בסל וב־thumbnails להזמנה.

---

## דף העריכה — פסיפס (אותו `uploader/+layout.svelte`, מצב `PRODUCT_TYPES.MOSAIC`)

### כללי

- חלוקת תמונה אחת לרשת מגנטים ריבועיים תוך שמירה על פרופורציה ורזולוציה הגיונית.
- אפשרות **אזור מיקוד (Focus)** מתוך התמונה המלאה ליצירת הפסיפס רק מאזור זה (לפי המימוש ב־`MosaicEditor` והסטור).

### פריסה ומרכוז

- מיכל המשטח במצב פסיפס מיושר למרכז (`split-center` וכו' ב־CSS).
- **Top-align** ראשוני לטעינת תמונה חדשה.
- **עמודות/שורות:** נגזרות מ־`splitImageRatio` ו־`gridBaseSize` (צד קצר ננעל על הבסיס, הצד הארוך גדל לפי היחס).

**קבועים מרכזיים** (`stores.js`):

- `MIN_GRID_BASE = 3` — מינימום **3×3 = 9** חלקים.
- `SPLIT_MARGIN_PERCENT` — ריווח יחסי קטן בין חלקים בדסקטופ.
- `SPLIT_MAGNET_SIZE` — בסיס חישוב גודל תא בפסיפס.

### חוק ה־9 (Minimum 9 Rule)

- לא ניתן להוריד מתחת ל־9 חלקים; ולידציה עסקית: לא מוסיפים לסל אם מימדים קטנים מ־3 (לפי לוגיקת השמירה וה־UI).

### רכיב `MosaicEditor.svelte`

- **Cover:** התמונה מכסה 100% משטח הגריד; לא ניתן להקטין מעבר לכיסוי.
- **זום 1×–3×**, **Pan**, **Clamping**, **שכבת Grid** חצי־שקופה.
- **מסגרת דינמית** לפי יחס `cols/rows` כך שכל תא ריבועי.
- **רספונסיביות:** עד ~90% רוחב ו־~55% גובה viewport לחלון העריכה.
- **אחסון יחסי:** `xPct`, `yPct`, זום; שחזור (Hydration) בין מכשירים.
- **מגע:** `touchstart`/`touchmove`; **Scroll lock** בזמן גרירה בעורך.
- **כפתורים:** Reset, Cancel, Save, סגירה ב־X.

**דרישת דיוק:** כל שינוי Focus/Zoom/Pan חייב להשתקף באופן זהה בתצוגת הגריד, בסל, בצ'ק-אאוט וב־thumbnails להזמנה — ללא סטיות פריים בין מסכים/רזולוציות.

### אינטראקציה עם חלקי הפסיפס

- **הסתרת חלק (Toggle):** לחיצה מסתירה חלק, מפחיתה מה־count, מציגה מצב מוסתר (שקיפות, מסגרת מקווקוות, אייקון שחזור).
- **פינות חדות** בפסיפס (ללא רדיוס) לרצף ויזואלי.
- **ללא גרירה** של חלקים על המשטח (שונה ממגנטים בודדים).

### מחיר (Upsell בפסיפס)

- בסיס לפי חבילת 9; כל חלק מעל 9 — תוספת לפי `EXTRA_MAGNET_PRICE` (₪10).

### פאנל גודל רשת (Floating Panel)

- כפתורי ± ל־`gridBaseSize`; תצוגה `cols × rows` וסך חלקים; מינוס ננעל ב־3.
- שינוי רשת מפעיל חישוב מחדש (`calculateAndRenderSplitGrid`) ועשוי להציג Loader קצר.
- **שמירת חיתוך:** ערכי zoom/מיקום נשמרים ומוחלים על הגריד החדש.

### התאמות מובייל (פסיפס)

- **רוחב מלא:** חישוב `size` לפי רוחב חלון ו־`gap` קבוע (למשל 2px).
- גלילה אנכית כשהפסיפס גבוה מהמסך.
- ללא hover; רק Tap להסתרה/החזרה.
- Dock רחב (~90vw), כפתורי ± גדולים.

---

## רכיב סל הקניות (`CartCounter.svelte`)

- **בכותרת:** באדג' כמות (כש־`count > 0`), סכום ב־₪ עם אנימציה; מצב ריק — שקיפות מופחתת.
- **מגירה (Drawer):** מימין ב־RTL; רקע מטושטש; רוחב דסקטופ ~360px, מובייל עד ~85–94vw. גובה המגירה מבוסס על **`100dvh`** (עם נפילה ל־`100vh`) כדי להתאים ל־viewport דינמי במובייל; רשימת הפריטים נגללת בתוך אזור Flex עם **`min-height: 0`** כדי שהפוטר (כולל «מעבר לתשלום מאובטח») יישאר נגיש; ריווח תחתון ל־**safe-area** (נotch / home indicator).
- **מצב ריק:** הודעה + CTA ל־`/select`.
- **סוגי פריטים:** מגנטים (תצוגה + כמות), פסיפס (תג «פסיפס», מימדים), מתנה (מסגרת זהב, חינם).
- **מחיקה:** עם `confirm`.
- **עריכה:** `editCartItem` — טעינת Workspace מהסל, ניווט ל־`/uploader`.
- **Footer:** שורת משלוח, סה״כ, כפתור **מעבר לתשלום מאובטח** → `/checkout`.

### לוגיקה טכנית

- **סל ב־IndexedDB** במפתח `feel_cart_db_v1`; כל עדכון `cart.subscribe` שומר מיידית.
- **סריאליזציה לסל:** המרת `blob:` ל־Base64 לפני שמירה (ב־`saveWorkspaceToCart`).
- **מתנה אחת:** עדכון מתנה דורסת קודמת.
- **מחיר:** `calculatePrice` — מגנטים לפי `PACKAGES` + יתרה × `EXTRA_MAGNET_PRICE`; פסיפס — בסיס חבילת 9 + תוספת; מתנה — 0.

---

## רכיב המתנה (`GiftButton.svelte`)

- כפתור צף ב־Dock; **פעימה** עד בחירת תמונה; אחרי בחירה — צבע וסימון ✓.
- **מודאל עורך:** יחס 1:1, `FileUploader`, שמירה עגולה.
- **Singleton בסל**; מחיר 0; פריט נפרד ממוצר ראשי.
- `URL.revokeObjectURL` בעת החלפת תמונה.

---

## Upsell & Pricing (`UpsellWidget.svelte`)

- מנוע מחיר דינמי לפי `count` וסוג מוצר.
- **מינימום:** לא ניתן לשמור מגנטים לסל מתחת ל־9 יחידות (חוץ ממצבי עריכה/מתנה לפי הלוגיקה ב־`saveWorkspaceToCart`).
- **ציר חבילות / Progress** — תמרוץ ויזואלי והודעות מיקרו־קופי.
- **מצב יצירה מול עריכה:** `editingItemId` משנה כפתור ל־«עדכן הזמנה» ושומר על אותו `id` בסל.

### טבלת חבילות מגנטים (`PACKAGES` ב־`stores.js`)

| כמות | מחיר (₪) | שם |
|------|----------|-----|
| 9 | 119 | FEEL Moments |
| 12 | 139 | FEEL Story |
| 15 | 159 | FEEL Collection (מומלץ) |
| 24 | 239 | FEEL Gallery |
| 30 | 289 | FEEL Life |

מעל כמות החבילה הנבחרת (הגדולה ביותר שעדיין ≤ count) — כל יחידה נוספת: **+₪10**.

**פסיפס:** בסיס כמו חבילת 9; כל חלק מעל 9 — +₪10 ליחידה.

---

## צ'ק-אאוט (`src/routes/checkout/+page.svelte`)

### שער מדיניות פרטיות (Privacy Gate)

- **אורח:** אישור נשמר ב־`localStorage` דרך `privacyCheckoutConsent.js` (`hasCheckoutPrivacyConsent` / `setCheckoutPrivacyConsent`).
- **משתמש מחובר:** השוואת `profile.privacy_policy_version_accepted` מול `currentPrivacyPolicy.version` מ־Supabase; אם חסרה חתימה לגרסה העדכנית — שער חובה.
- לחיצה על קישור פותחת את רכיב `PrivacyPolicy` (אירוע גלובלי `OPEN_PRIVACY_EVENT` מה־layout).

### אימות משתמש

- ליצירת הזמנה נדרש משתמש מחובר; אם לא — נפתח `AuthModal`.
- ניתן לסגור את המודאל ולהמשיך כאורח עד שלב ההזמנה (אז תופיע הדרישה להתחבר).
- במובייל, פריסת מודאל ההרשמה מותאמת למקלדת (ראו בסעיף «מובייל — טופס השלמת רישום» תחת **אימות והרשמה**) — כדי שלא יוסתרו שדות שם/תאריך מאחורי אזור פעולה תחתון או מקלדת.

### טופס משלוח ונתונים

- שדות: שם פרטי/משפחה, עיר, רחוב, מספר בית, דירה, הערות, קופון (אופציונלי).
- **השלמה אוטומטית כתובות (ישראל):** `govIlStreets.js` — חיפוש יישובים ורחובות מ־data.gov.il (בפרודקשן לעיתים ישירות מהדפדפן בגלל CORS; קיים גם פרוקסי `/api/addresses` לסביבות עם Node).
- **מיסוך טלפון ישראלי** ונרמול למספר ספרות — `inputMasks.js`.

### מתנה בהזמנה (שדות צ'ק-אאוט)

- אפשרות להפעיל מתנה עם הודעה; שם וטלפון שולח — מולאים אוטומטית מפרופיל אם קיים.

### יצירת הזמנה בשרת

תהליך יצירת ההזמנה מתוכנן לעמידות מקסימלית מול תקלות רשת/PostgREST עוברות. הלוגיקה ב־**`src/lib/orderPlacement.js`** (לקוח) ובמגרציה **`20260507000100_create_complete_order_v2_with_order_number.sql`** (שרת).

**הזרימה (Round-trip יחיד עד למסך התשלום):**

1. **בניית `itemsPayload` מטא־בלבד** (Law C): `buildOrderItemConfiguration` בודק תחילית `data:` באופן **פוזיטיבי** (ולא לפי סף אורך) למניעת חלחול data URL קצר ל־configuration. `magnetsMeta` נכלל רק עבור `magnets_pack` (בפסיפס מספיק `count`). השדה `thumbnail_url` **לא נשלח** ב־payload (מוזרק ברקע אחרי יצירה).
2. **קריאה ל־RPC `create_complete_order`** דרך `createCompleteOrderResilient`:
   - **Timeout 30 שניות** (`Promise.race` עם טיימר). אם עבר — `Error('order_creation_timeout')` עם דגל `isTimeout`.
   - **`slow warning` רך אחרי 8 שניות** — UI מציג "החיבור איטי כעת — ממשיכים לנסות". לא מבטל את הקריאה, רק מרגיע את המשתמש.
   - **Retry יחיד (700ms backoff)** רק לכשלים *לפני שהשרת ענה* (timeout / `failed to fetch` / `AbortError`). שגיאות לוגיות (validation/auth/mismatch) **לא** מעוררות retry.
   - **התאוששות אידמפוטנטית מ־unique violation:** אם הניסיון הראשון התקבל בשרת אבל התשובה אבדה ברשת, ה־retry יתנגש על ה־PK (`23505`). במקרה כזה הקליינט קורא `orders` + `order_items` ובונה את אותה תשובה לוגית. אותו `p_order_id` שנוצר ב־`crypto.randomUUID()` הוא בעצם idempotency key.
3. **ה־RPC חדש (v2 — מגרציה `20260507000100`):**
   - **מעבר אחד (single-pass)** על `p_items` שמבצע גם guardrail (50KB + `data:image`), גם תמחור שרתי (`compute_order_item_unit_price`), וגם צובר את `subtotal`. ה־`unit/qty` נשמרים במערכים ומשמשים בלולאת ה־INSERT השנייה — בלי לחשב מחדש (חצי מהעבודה לעומת `20260411120000`).
   - **`order_number` מוחזר ישירות** בתוך ה־jsonb (`{ order_id, order_number, item_ids[], subtotal, total }`). אין יותר `select('order_number')` נפרד — זה היה round-trip מיותר שהכפיל סיכוי כשל.
   - שמירה על Server-Authoritative Pricing (Law D): `client_subtotal_mismatch` / `client_total_mismatch` נדחים.
4. **סנכרון מצב התשלום ל־`sessionStorage`** (`feel_checkout_payment_v1`): `{ orderId, orderNumber, amount }`. ב־refresh בטעות — `tryRestorePaymentSession` ב־`+page.svelte` מאמת מול ה־DB ש־`status='pending'` ושיש התאמה ב־`user_id`, ומחזיר את המשתמש למסך התשלום במקום לסל ריק.
5. **העלאת thumbnails ברקע (לא חוסמת UI):** `backfillOrderThumbnailsInBackground` מעלה את כל ה־thumbnails ב־`Promise.all` (`uploadOrderItemThumbnails`) ואז קורא ל־**RPC חדש `patch_order_item_thumbnails`** (פלורלי, מגרציה `20260507000200`) שמעדכן את כל השורות במכה אחת תחת RLS — במקום RPC נפרד לכל פריט.

**טבלת שגיאות → טקסטים בעברית** (`orderCreationErrorMessage` בדף הצ'ק־אאוט):

| מקור שגיאה | טקסט למשתמש |
|------------|--------------|
| `order_creation_timeout` / `isTimeout` | "החיבור לשרת איטי כעת. נסו שוב — ההזמנה לא חויבה." |
| `failed to fetch` / `network` | "תקלת רשת זמנית. בדקו את החיבור לאינטרנט ונסו שוב." |
| `client_subtotal_mismatch` / `client_total_mismatch` | "הסכום בעגלה השתנה. רעננו את הדף ונסו שוב." |
| `not_authenticated` | "יש להתחבר כדי להשלים את ההזמנה." |
| `configuration_too_large` / `configuration_contains_data_image` | "אחד הפריטים כבד מדי. ערכו אותו מחדש בעורך ושמרו לעגלה." |

**דרישות ביצועים למסך זה (מחייב):**

- שלב יצירת ההזמנה חייב להציג מצב טעינה ברור, לא להקפיא את המסך, ולהסתיים מהר ככל האפשר.
- כשלי רשת צריכים להציג הודעה קצרה וברורה עם אפשרות חזרה/ניסיון חוזר (מבלי לאבד את הסל/הטיוטה).
- **Anti double-click:** `if (placeOrderLoading) return` בתחילת `handlePlaceOrder` — מונע יצירת שתי הזמנות בלחיצה כפולה במכשירים איטיים, גם אם ה־`disabled` עוד לא הסתנכרן.

### תשלום (דמו)

- רכיב **`PaymentMock`** (`src/lib/components/PaymentMock.svelte`): מציג **מספר הזמנה** (`#order_number`) ולא את ה־UUID; מדמה אישור תשלום.
- **אישור תשלום עובר דרך RPC `confirm_order_payment(p_order_id)`** ולא דרך `update` ישיר. UPDATE על `orders` נחסם מצד הלקוח במגרציה `20260411120000` (`revoke update on table public.orders from anon, authenticated`) כדי שלא ניתן יהיה לסמן הזמנה כ־`paid` בלי המעבר המבוקר.
- אחרי אישור: `clearPaymentSession()` מנקה את `feel_checkout_payment_v1`, `cart.set([])` מרוקן עגלה, וה־UI מנווט ל־`/checkout/success/[orderId]`.
- במסך **הצלחה** אחרי תשלום מוצג גם מספר ההזמנה כשזמין.

---

## דף ההזמנות שלי (`src/routes/orders/+page.svelte`)

- זמין מקישור **«ההזמנות שלי»** בתפריט הצד (`SideMenu`).
- דורש **משתמש מחובר**; אחרת הודעה והפניה להתחברות.
- טעינה מ־Supabase: `orders` (עם `order_number`, סטטוס, תאריך, סכום, מתנה) + `order_items` בשאילתה נפרדת (כולל `thumbnail_url` אם קיים).
- כרטיס לכל הזמנה: **«הזמנה #N»**, תאריך, סטטוס בעברית, סכום, תג מתנה, שורות עם תמונה ממוזערת / פלייסהולדר.

**דרישות יעילות (מחייב):**

- טעינה חייבת להיות מהירה גם למשתמש עם נפח הזמנות גדול.
- יש להימנע מהורדת נתונים כבדים/מיותרים; thumbnails הם המקור לתצוגה מהירה (ולא קונפיגורציות כבדות).
- UI צריך להיות “רשימתי” ונוח לסריקה במובייל, ללא גלילה אופקית וללא עומס חזותי.

---

## אימות והרשמה (`AuthModal.svelte`, `authStore.js`, `supabase.js`)

### מצב Session

- `initAuth`: טעינת סשן קיים, `onAuthStateChange`, טעינת `profiles`.
- **התנתקות:** ניקוי הסכמת צ'ק-אאוט מקומית; לוגיקה מותנית מול מדיניות.

### שיטות התחברות

- **אימייל** — שלבים: אימייל → בדיקה אם משתמש קיים/חדש (לפי מימוש ה־Modal).
- **OTP** — קוד חד־פעמי, ולידציה עם Zod, טיימר שליחה חוזרת.
- **הרשמה:** שם מלא, תאריך לידה, טלפון — סכמות `authSchema.js` (`validateBirthdayIso` לערך `YYYY-MM-DD` מתוך `<input type="date">`).

#### מובייל — טופס השלמת רישום (שם + תאריך לידה)

- **אוברליי:** `min-height: 100dvh` (עם נפילה ל־`100vh`), רוחב `100%` (לא `100vw`) — ללא גלילה אופקית; גלילה אנכית על שכבת האוברליי כשהמקלדת מצמצמת את ה־viewport.
- **מקלדת / Visual Viewport:** ריווח תחתון דינמי עם `env(safe-area-inset-bottom)` ו־`--vv-bottom-chrome` (מעודכן מ־`+layout.svelte` דרך `visualViewport`); `scroll-padding-top` / `scroll-padding-bottom` על האוברליי; `scroll-margin` על קבוצות שדות; בפוקוס — `scrollIntoView({ block: 'center' })` לשדות.
- **שדות:** שם עם `autocomplete="name"` ו־`enterkeyhint="next"`; תאריך לידה ב־`<input type="date">` (בורר מערכת), `min` / `max` (עד היום), `dir="ltr"` על השדה; גודל טקסט מינימלי **16px** בשדות כדי למנוע zoom אוטומטי ב־iOS.
- **פריסה במובייל:** המודאל נמתח לפחות לגובה דינמי (`100dvh`), לא נעול ל־`height: 100vh` בלבד, כדי שהפריסה לא «תישבר» כשהמקלדת פתוחה.
- **OAuth:** Google ו־Facebook דרך `signInWithOAuth` עם **PKCE**, `redirectTo: /auth/callback`.
- לפני redirect נשמר נתיב חזרה ב־`sessionStorage` (`OAUTH_RETURN_PATH_KEY`).

### דף callback (`/auth/callback`)

- החלפת `code` לסשן אם צריך; ניווט חזרה לנתיב השמור או לבית.

---

## מדיניות פרטיות (`PrivacyPolicy.svelte`, `privacyPolicyStore.js`)

- בטעינת האפליקציה: `fetchCurrentPrivacyPolicy` — השורה העדכנית ביותר מטבלת `privacy_policies` (גרסה, גוף, תאריך).
- **רישום הסכמה למשתמש מחובר:** RPC `record_privacy_consent` (מעדכן גרסה בפרופיל).
- רכיב תצוגה נפתח מה־Layout או מתפריט הצד / אירוע מהצ'ק-אאוט.
- **מובייל (מסך מלא):** גובה המודאל **`100dvh`**; גוף המדיניות נגלל עם **`min-height: 0`** כדי שהכותרת והפוטר (כפתור «הבנתי, בואו נמשיך») לא ייחתכו; רכיב **CookiePolicy** משתמש באותה תבנית פריסה.

---

## רכיבי תשתית נוספים

### 1. Header (`Header.svelte`)

- פריסת 3 עמודות: תפריט המבורגר, לוגו (קישור לבית), `CartCounter`.
- גובה ~70px, `position: fixed`.

### 2. תפריט צד (`SideMenu.svelte`)

- ניווט משני: יצירה (מגנטים / פסיפס עם `resetSystem`), **ההזמנות שלי** (`/orders`), צור קשר (קישור בתפריט), קישורים משפטיים (מדיניות פרטיות, Cookie, וכו').
- **אימות:** התחברות (אירוע ל־`AuthModal`), התנתקות דרך `supabase.auth.signOut`.
- **הדר הפנימי** מיושר לגובה ול־`box-sizing` כמו `app-header` (~70px); רקע כהה + לוגו + סגירה.
- **Backdrop** בתוך מיכל התפריט, שכבות `z-index` כדי שלא יחסמו לחיצות על כפתורים; תפריט מעל עגלת הקניות (`z-index` גבוה יותר).
- **Hover אחיד** על פריטי ניווט: אייקוני מילוי מול אייקוני stroke (`nav-icon--fill` / `nav-icon--stroke`), צבעי `:visited` תואמים, רקע hover ברוחב מלא (מבנה `li` + padding על הפריטים).

### 3. Layout כללי (`+layout.svelte`)

- `dir="rtl"`, `initApp`, `initAuth`, `fetchCurrentPrivacyPolicy`.
- שכבת **Global Loader** כש־`isGlobalLoading` פעיל (פס גרדיאנט עליון).
- הטמעת `Header`, `SideMenu`, `PrivacyPolicy`, **`CookiePolicy`**, `AuthModal`.
- אירועים גלובליים לפתיחת מדיניות/Cookie מתוך צ'ק-אאוט (`privacyCheckoutConsent.js`).

### 4. שמירה אוטומטית (Debounce) — Workspace

**איפה:** `src/lib/stores.js`

- על כל שינוי ב־`magnets` או ב־`editorSettings` נקראת `triggerAutoSave`.
- **Debounce:** השהיה תלוית־viewport (למשל ~8s במובייל, ~2s בדסקטופ — ראו `getAutosaveDelayMs` בקוד), וביטול הטיימר הקודם לפני תזמון חדש; לאחר מכן עבודה ב־`requestIdleCallback` (עם נפילה ל־`setTimeout`) כדי לא לחסום אינטראקציה.
- אחרי ההשהיה: אם יש מגנטים או `splitImageSrc`, נשמר ל־IndexedDB דרך `saveStateToStorage` (המרות Blob→Base64 לפי הצורך).

**תכלית:** למנוע מאות כתיבות רצופות לדיסק בזמן גרירה/זום, ולשמור עקביות אחרי שהמשתמש «נח».

**סנכרון ריאקטיבי אחרי שמירה בעורך (Persistent Layout):** משטח הקולקציה ב־`uploader/+layout.svelte` נשאר ב־DOM (מוסתר ב־`display:none` בזמן `/uploader/edit/...`). כדי ש־Zoom/Pan ישתקפו **מיד ובדיוק מלא** (בלי «סטייה» בניסיון שמירה ראשון בגלל state ישן), נהוג **פרוטוקול שמירה אטומי** (בעורך המגנט: `saveAndClose`; בשמירת פסיפס: `handleSaveMosaic`):

1. עדכון ה־store (`updateMagnetTransform` מחליף מערך מלא עם שכפול שורות; `editorSettings` בפסיפס).
2. `await tick()` — להמתין לסינכרון ה־DOM/ריאקטיביות של Svelte אחרי עדכון ה־store.
3. `bumpWorkspaceLayoutRefreshSignal()` — עדכון `lastWorkspaceLayoutRefreshSignal` כדי שהקולקציה תידע לאלץ סנכרון transform.
4. `await tick()` נוסף — לאפשר ל־`Magnet` להשלים חישוב CSS (משתנה `layoutRefreshEpoch`) לפני מעבר מסך.
5. רק אז ניווט (`goto` בעורך) או המשך רינדור רשת הפסיפס (`calculateAndRenderSplitGrid`).

ב־`Magnet.svelte` משתני ה־crop ל־CSS נגזרים בבלוק ריאקטיבי מ־props (`transform`) + מימדי תמונה + `layoutRefreshEpoch`, בלי cache מקומי של transform שיכול להיצמד לערך ישן. אין הסרת אריחים ואין טעינת Blobs מחדש.

**הערה:** הסל (`cart`) נשמר **מיד** בלי debounce (subscribe ישיר ל־`setItem`), כי כמות האירועים נמוכה יחסית וההשלכות כספיות דורשות עקביות.

### 5. מנוע אפקטים (CSS Filters — ללא Worker)

- **ארכיטקטורה נוכחית:** ה-Worker pipeline הישן (שייצר Blob URLs מעובדים לכל אפקט) **הוסר לחלוטין**. כל האפקטים מיושמים כעת ב-CSS בלבד דרך `getCssFilter()` ב-`stores.js`.
- **הגדרות פילטרים:**
  - `silver`: `grayscale(1) contrast(1.08) brightness(1.05)`
  - `noir`: `grayscale(1) contrast(1.35) brightness(0.95)`
  - `vivid`: `saturate(1.35) contrast(1.12) brightness(1.03)`
  - `dramatic`: `saturate(1.18) contrast(1.22) brightness(0.98)`
- רק ה-Blob המקורי (Original) נשמר בקליינט; אפקטים מוחלים ב-render time כ-CSS `filter`.
- קובץ `static/effects.worker.js` קיים כ-legacy fallback אך **אינו בשימוש** בזרימה הנוכחית.
- **ב־Main thread:** חיתוך, זום וגריד ויזואלי — Transforms ו־CSS לביצועים.

### 6. רכיבים משלימים

- **`FloatingPanel.svelte`:** פאנל צף לאפקטים / בקרות.
- **`FileUploader.svelte`:** העלאת קבצים.
- **`govIlStreets.js` + `api/addresses`:** השלמת כתובות ישראל.

---

## מסד נתונים (Supabase) — הערות ארכיטקטורה

- טבלאות/פונקציות רלוונטיות מהמיגרציות בפרויקט: **`orders`**, **`order_items`**, **`profiles`**, **`privacy_policies`**, **`admin_users`**, RPC **`create_complete_order`** (v3), **`patch_order_item_thumbnails`** (batch), **`patch_order_item_thumbnail`** (single, legacy), **`patch_order_item_original_paths`**, **`confirm_order_payment`**, **`compute_order_item_unit_price`**, **`my_orders_dashboard`**, **`record_privacy_consent`**, **`is_admin`**, **`admin_get_orders`**, **`admin_get_order_detail`**, **`admin_update_order_status`** (שמות מדויקים לפי קבצי ה־SQL).
- **`orders.id`:** מפתח ראשי מסוג UUID — לפעולות פנימיות, עדכון סטטוס, וקישורים טכניים. ה־UUID נוצר בקליינט (`crypto.randomUUID()`) ומשמש כ־**idempotency key** לבקשת `create_complete_order` — `unique_violation` ב־retry מסמן שהניסיון הראשון התקבל ומאפשר התאוששות.
- **`orders.order_number`:** מספר שלם עולה **ייחודי** (`UNIQUE`), נוצר מרצף **`order_number_seq`** ו־`DEFAULT nextval` — להצגה ללקוח, למסכי תשלום/הצלחה ולתמיכה. **מוחזר ישירות מ־RPC v3** (אין `select` נפרד).
- **`orders.status` ערכים חוקיים (unified flow):** `pending` → `paid` → `processing` (הזמנות gift) / `ready_for_print` (הזמנות רגילות) → `printed` → `shipped` → `delivered`; כל שלב → `cancelled`. `confirm_order_payment` מנתב אוטומטית אחרי `paid`: gift_enabled → `processing`, אחרת → `ready_for_print`. (מיגרציה: `20260607000100_unified_order_status.sql`).
- **Server-authoritative pricing (Law D):** `compute_order_item_unit_price` מחשב מחיר לפי `type + configuration.count`. סטיה בין הסכום של הקליינט לתחשיב השרתי = `client_subtotal_mismatch` / `client_total_mismatch`. **אין** `update` ישיר על `orders` מצד הלקוח — מעבר ל־`paid` רק דרך `confirm_order_payment` (security definer).
- **Configuration guardrail (50KB + ללא `data:image`):** מאוכף הן ב־CHECK constraint (`order_items_configuration_guardrail_chk`, מגרציה `20260411130000`) והן בכל קריאה ל־RPC v3 — defense in depth.
- **`order_items.thumbnail_url`:** כתובת ציבורית לתמונה ממוזערת אחרי העלאה ל-Storage. backfill ברקע אחרי יצירת ההזמנה — call יחיד דרך `patch_order_item_thumbnails` (batch).
- **`order_items.original_storage_paths`:** `jsonb` — מפת `{ magnetId: storageObjectPath }` לכל מגנט (או `{ source: path }` לפסיפס). מאוכסן בבאקט **`order-originals`** (private). backfill ברקע דרך `uploadOrderOriginalsInBackground` / `patch_order_item_original_paths`. מכיל תמונות full-resolution לשימוש בהדפסה.
- **`order_items.configuration`:** JSONB — snapshot של מטא-דאטת חיתוך ואפקטים: `magnetsMeta[{ id, xPct, yPct, zoom, effectId, hidden }]` + `settingsMeta`. משמש Admin לתצוגת פרטי ההדפסה.
- **Storage buckets:** **`order-thumbnails`** (public read; insert/update תחת `auth.uid()`). **`order-originals`** (private; insert/update/select ל-`authenticated` עם `bucket_id` filter; קריאה ישירה של קבצים רק ל-`service_role`). **חשוב:** policy של SELECT נדרש גם כשמשתמשים ב-`upsert: true` — בלעדיו Storage מחזיר RLS violation.
- **`admin_users`:** allowlist פשוטה `(user_id uuid PK)`. RLS: רק `service_role` קורא ישירות; authenticated-users בודקים דרך RPC `is_admin()` (security definer).
- **Admin RPCs (security definer, בודקים `admin_users`):** `admin_get_orders(limit, offset, status)` — כל ההזמנות ללא RLS; `admin_get_order_detail(order_id)` — הזמנה מלאה + פריטים; `admin_update_order_status(order_id, new_status)` — מעברי סטטוס חוקיים בלבד (paid→processing→shipped→delivered, כל שלב→cancelled); **`admin_get_print_queue()`** — הזמנות paid/processing עם ספירת מגנטים גלויים; **`admin_get_print_originals(order_ids[])`** — metadata + storage paths לכל הפריטים של הזמנות נבחרות; **`admin_mark_orders_printed(order_ids[])`** — stamps `printed_at`, transitions paid→processing.
- **`orders.printed_at`:** `timestamptz`, nullable — חותמת זמן הדפסה פיזית דרך מסך `/admin/print`. NULL = טרם הודפס.
- **`/orders` perf:** RPC `my_orders_dashboard(limit, offset)` מאחד הזמנות + שורות (בלי `configuration` הכבד) באגרגציה אחת, עם אינדקסים מותאמים על `(user_id, placed_at desc)` ו־`(order_id, created_at)`.
- **קבצי המגרציות (סדר כרונולוגי):** `20260325000100_checkout_orders.sql`, `20260326000100_create_complete_order_rpc.sql`, `20260404000100_privacy_policy_and_consent.sql`, `20260404120000_privacy_policies_grant_select.sql`, `20260405120000_order_item_thumbnails.sql`, `20260406120000_orders_order_number.sql`, `20260407140000_my_orders_dashboard_rpc.sql`, `20260408120000_my_orders_dashboard_perf.sql`, `20260409130000_my_orders_dashboard_lite_items.sql`, `20260410120000_create_order_return_item_ids_patch_thumbnail.sql`, `20260411120000_pricing_authority_and_payment_confirm_rpc.sql`, `20260411130000_order_items_configuration_guardrail.sql`, `20260411130100_validate_order_items_configuration_guardrail.sql`, `20260507000100_create_complete_order_v2_with_order_number.sql`, `20260507000200_patch_order_item_thumbnails_batch.sql`, `20260507000300_create_complete_order_v3_hardened.sql`, `20260508000400_feel_sanitize_text_no_chr0.sql`, `20260515000100_order_item_original_paths.sql`, `20260515000200_admin_users.sql`, `20260518000100_admin_print_pipeline.sql`, `20260520000100_admin_print_queue_real_mosaic_count.sql`, `20260605000100_order_production_jobs.sql` (טבלת production jobs + RPCs), `20260605000200_production_job_gift_crop.sql` (overridden_gift_crop column), `20260607000100_unified_order_status.sql` (unified status flow), **`20260608000100_print_originals_with_gift_crop.sql`** (תיקון RPC להחזיר overridden_gift_crop).

---

## סיכום הבדלי תשתיות (מובייל מול דסקטופ)

| רכיב | דסקטופ | מובייל |
|------|--------|--------|
| גריד מגנטים | אבסולוטי + גרירה | 2 עמודות, ללא גרירה |
| אינטראקציה | Hover + גרירת עכבר | Tap, Scroll lock בעורכים |
| Dock | צר יחסית | רחב (~90vw), כפתורים מוסתרים |
| טולטיפים | אפשריים | מופחתים/כבויים בסל |
| קרוסלה | חיצים + גלילה | מגע + snap |

---

## עיצוב

### צבעי מותג (דוגמאות מקוד / CSS)

| תפקיד | הערות |
|--------|--------|
| טורקיז / Teal מותג | כפתורי CTA, אלמנטים פעילים — למשל `rgb(63, 82, 79)` / `--color-pink` בקוד הישן |
| זהב / Tan | הדגשות, מסגרות — `#C6B29A` |
| דיו / Ink | טקסט כהה, כותרות — `#1E1E1E` |
| חול / Sand | רקע קנבס — `#F2F0EC` |

### צבעי עזר והתראות

- **Navy / אפור כהה:** טקסט משני (`--color-dark-gray` / `--color-medium-blue-gray` לפי הקבצים).
- **Slate:** כרטיסים במצב כהה.
- **לבן:** כרטיסי מידע ופאנלים צפים.
- **אדום:** מחיקה — `#e53935`.
- **ירוק:** הצלחה / אישור — `#4CAF50`.

---

## קבצים מרכזיים להתמצאות

| אזור | קבצים |
|------|--------|
| סטייט גלובלי | `src/lib/stores.js` |
| אחסון | `src/lib/utils/storage.js`, `src/lib/utils/idb.js` |
| גרירה | `src/lib/actions/draggable.js` |
| גריד / חישובים | `src/lib/utils/grid.js` (אם בשימוש בדפים) |
| עורך פסיפס | `src/lib/components/MosaicEditor.svelte` |
| סל | `src/lib/components/CartCounter.svelte` |
| צ'ק-אאוט | `src/routes/checkout/+page.svelte` |
| יצירת הזמנה חסינה (timeout/retry/idempotency) | `src/lib/orderPlacement.js` |
| הזמנות שלי | `src/routes/orders/+page.svelte` |
| תמונות ממוזערות להזמנה | `src/lib/orderThumbnails.js` |
| **תמונות מקוריות ל-Storage** | `src/lib/orderOriginals.js` |
| תשלום דמו | `src/lib/components/PaymentMock.svelte` |
| אימות | `src/lib/components/AuthModal.svelte`, `src/lib/authStore.js`, `src/lib/supabase.js` |
| **Admin — ניהול הזמנות** | `src/routes/admin/+layout.svelte`, `src/routes/admin/+page.svelte` |
| **Admin — פרטי הזמנה + Production Job** | `src/routes/admin/orders/[orderId]/+page.svelte` |
| **Admin — הדפסת מגנטים** | `src/routes/admin/print/+page.svelte`, `src/lib/admin/printPacking.js`, `src/lib/admin/PrintBatchPage.svelte` |
| **מייל משלוח (Edge Function)** | `supabase/functions/send-shipping-notification/index.ts` |
| **בדיקות אוטומטיות** | `tests/core-flow.spec.js`, `tests/photo-collection-sprint.spec.js`, `tests/mosaic-mobile-no-horizontal-scroll.spec.js` |

---

*מסמך זה נועד לצוות פיתוח ומוצר; עדכנו אותו כשמוסיפים נתיבים, חבילות מחיר, שינוי בזרימת התשלום או בשדות הזמנה (למשל `order_number`, thumbnails).*

---

## בדיקות אוטומטיות (Playwright)

### תשתית

- **Playwright config:** `playwright.config.js` — פרופילי Chromium mobile (Pixel 5) + desktop.
- הרצה: `npx playwright test`.

### סוויטות

| קובץ | מכסה |
|------|-------|
| `tests/core-flow.spec.js` | זרימה מקצה לקצה: בית → העלאה → עגלה → צ'ק-אאוט |
| `tests/mosaic-mobile-no-horizontal-scroll.spec.js` | ולידציה שאין גלילה אופקית בפסיפס במובייל |
| `tests/photo-collection-sprint.spec.js` | **רגרסיה ספרינט:** גריד קולקציה + עורך מגנט בודד |

### `photo-collection-sprint.spec.js` — פירוט

סוויטת רגרסיה שנוספה בספרינט הייצוב (מאי 2026), מכסה:
- רינדור אריח עם תשתית Skeleton (מצב `src=null` → swap)
- מצב דו-שכבתי: `originalSrc` קיים, `src` מתחלף
- Round-trip של transforms: `xPct`/`yPct`/`zoom` נשמרים ומשוחזרים בדיוק
- יישום משתני CSS נכון לפי crop
- החלפת אפקט ללא איפוס transform
- פרופיל מובייל (Pixel 5) כברירת מחדל

---

## Pipeline שמירת תמונות מקוריות (`src/lib/orderOriginals.js`)

**מטרה:** שמירת תמונות מקור ב-Storage לצורך הדפסה פיזית.

**זרימה (fire-and-forget, לא חוסמת checkout):**
1. לאחר `create_complete_order` מחזיר `item_ids`, קוראים ל-`uploadOrderOriginalsInBackground` **במקביל** ל-`backfillOrderThumbnailsInBackground`.
2. `uploadOrderOriginalsInBackground` מעלה לכל פריט:
   - **magnets_pack:** כל מגנט בנפרד → `{userId}/{orderId}/{itemId}/{magnetId}.{ext}` (Full Resolution, ללא דחיסה)
   - **mosaic:** תמונת מקור אחת → `{userId}/{orderId}/{itemId}/source.{ext}`
3. לאחר העלאה: RPC `patch_order_item_original_paths` מעדכן `order_items.original_storage_paths` (jsonb).

**איתור מקור תמונה (field resolution):**
- **magnets_pack:** `m.srcUrl ?? m.originalSrc ?? m.src` — הסל שומר את המקור ב-`originalSrc` (base64 מסריאליזציה). `srcUrl` כ-fallback למבני נתונים ישנים.
- **mosaic:** `itemData.settings.splitImageSrc ?? itemData.splitImageSrc ?? itemData.src` — התמונה מאוחסנת תחת `data.settings.splitImageSrc` (base64 / blob URL).

**Bucket:** `order-originals` — **private** (ללא Public URL). קריאה רק ל-`service_role` (Admin בלבד).

**Storage Policies (על `storage.objects`):**
- `order_originals_insert_own` — INSERT ל-`authenticated`, `WITH CHECK (bucket_id = 'order-originals')`.
- `order_originals_update_own` — UPDATE ל-`authenticated`, `USING (bucket_id = 'order-originals' AND auth.uid() = folder[1])`.
- `order_originals_select_own` — SELECT ל-`authenticated`, `USING (bucket_id = 'order-originals')`. **נדרש עבור `upsert: true`** — ללא policy זה, Storage מחזיר RLS violation גם על INSERT.

**הערה חשובה (deployment):** הבאקט חייב להיווצר ידנית בדשבורד Supabase (Storage → New bucket → `order-originals`, Public: OFF) **לפני** הרצת המיגרציה. ניתן גם ליצור דרך SQL:
```sql
INSERT INTO storage.buckets (id, name, public) VALUES ('order-originals', 'order-originals', false);
```

**מה מאוחסן יחד:**
- `original_storage_paths` — נתיבי Storage לתמונות המקור
- `configuration.magnetsMeta[i].{xPct, yPct, zoom, effectId}` — פרטי חיתוך ואפקט לכל מגנט (כבר נשמר ב-checkout)

---

## ממשק Admin (`src/routes/admin/`)

**גישה:** רק משתמשים הרשומים בטבלת `admin_users`. לא קיים בממשק לרשום את עצמך — יש להוסיף ידנית דרך Supabase Dashboard:
```sql
INSERT INTO admin_users (user_id) VALUES ('<your-auth-uid>');
```

**Guard:** `+layout.svelte` בודק על ה-client:
1. `supabase.auth.getSession()` — חייב להיות מחובר
2. RPC `is_admin()` — security definer, בודק `admin_users`; מחזיר `true/false`
3. אם לא עובר — redirect ל-`/`

**דף הזמנות (`/admin`):**
- קריאה ל-RPC `admin_get_orders(limit, offset, status)` — מחזיר כל ההזמנות ללא RLS
- פילטר לפי סטטוס, pagination 50/דף
- עמודות: מספר הזמנה, סטטוס, שם לקוח, עיר, מספר פריטים, סכום, מתנה, ברכה, תאריך
- שורות לחיצות (click/Enter) — מנווטות ל-`/admin/orders/[orderId]` ישירות
- סטטוסים + צבעים מעודכנים: `processing`=כתום, `ready_for_print`=ירוק, `printed`=כחול

**דף פרטי הזמנה (`/admin/orders/[orderId]`):**
- RPC `admin_get_order_detail(order_id)` — הזמנה מלאה + כל order_items + production job
- **כתובת משלוח + מתנה**
- **Thumbnails** + סיכום מטא-דאטה (כמות, אפקט)
- **Production Job Panel** — נטען אוטומטית עם ההזמנה:
  - **הודעת מתנה:** עריכה inline + שמירה דרך `admin_update_production_job`
  - **תמונת מתנה:** העלאה לבאקט `order-originals` (path: `gift-overrides/{orderId}/gift.jpg`) + שמירת path ב-job
  - **Crop editor לתמונת מתנה:** עורך pan/zoom/effect זהה לעורך הלקוח (Law A) — נפתח לאחר העלאה; שומר `overridden_gift_crop: {zoom, xPct, yPct, effect}` ב-RPC
  - **הערות admin:** textarea לשמירת הערות פנימיות
  - **"שחרר להדפסה"** — מעביר הזמנה מ-`processing` → `ready_for_print`
  - **"סמן כשולם"** — מעביר `pending` → `paid` (גם מנתב אוטומטית ל-`processing`/`ready_for_print`)
- **עדכון סטטוס** דרך RPC `admin_update_order_status`:
  - `printed → shipped → delivered`; כל שלב → `cancelled`
  - `processing` / `ready_for_print` → `cancelled` (לא ניתן לעבור ל-shipped ישירות, חייבים הדפסה)
- **כפתור "שלח מייל משלוח"** (זמין בסטטוס `shipped`) — קורא ל-Edge Function `send-shipping-notification`

**טבלת `order_production_jobs`** (מיגרציה `20260605000100`):
- `order_id` (FK), `production_status` (legacy — הוסר ב-`20260607000100`), `overridden_gift_message`, `overridden_gift_image_path`, `overridden_gift_crop` (jsonb: `{zoom,xPct,yPct,effect}`), `admin_notes`, `gift_message_done` (bool), `gift_image_done` (bool), `processed_by` (admin user_id)
- **RPCs:** `admin_update_production_job(order_id, ...)` — מאמת admin, מסנטז טקסטים, מעדכן שדות; `admin_get_print_queue()` — הזמנות `ready_for_print` עם `visible_tile_count`; `admin_mark_orders_printed(order_ids[])` — מעביר → `printed` + stamps `printed_at`

**דף הדפסת מגנטים (`/admin/print`):**

מסך ייעודי להדפסה פיזית של מגנטים (5×5 ס"מ) על דפי A4 מהזמנות מרובות.

- **תור הדפסה:** RPC `admin_get_print_queue()` — מחזיר הזמנות בסטטוס `ready_for_print` עם ספירת מגנטים גלויים לכל הזמנה. בפסיפס הספירה משחזרת את הרשת בפועל לפי `configuration.count` → `gridBaseSize` + `splitImageRatio`. (מיגרציה: `20260520000100_admin_print_queue_real_mosaic_count.sql`.)
- **בחירת הזמנות אוטומטית:** `suggestOptimalBatch` (greedy, יעד ≥90% ניצולת) מופעל אוטומטית בטעינה; תצוגה מקדימה נטענת אוטומטית (debounced 300ms) בכל שינוי בחירה.
- **כפתור יחיד "🖨️ שלח להדפסה":** מפעיל `window.print()` ואז listener לאירוע `afterprint` שקורא `admin_mark_orders_printed` — מסמן הזמנות ומרענן תור.
- **אלגוריתם אריזה (`src/lib/admin/printPacking.js`):**
  - קבועים: אריח 50mm, רווח 5mm, 3 עמודות × 5 שורות = 15 מגנטים/עמוד (`ITEMS_PER_PAGE`), שוליים 10mm, `min-height: 296mm` לעמוד.
  - `suggestOptimalBatch` — greedy; בוחר הזמנות מהוותיקה ביותר עד יעד ניצולת ≥90% או `maxPages=10`.
  - `flattenTilesForBatch(orders, itemsByOrder, jobsByOrder)` — מחרוז כל אריחי כל הזמנות הנבחרות למערך אחד; מטפל ב-3 סוגי items:
    - `mosaic` → `expandMosaicToTiles` — cols×rows אריחים, כל אריח עם `cropRect`, `transform`, `effect`
    - `gift` → `expandGiftTile(item, jobData)` — אריח בודד `kind:'magnet'`, `isGift:true`; מעדיף `jobData.gift_image_path` (תמונת admin) + `jobData.overridden_gift_crop`; path מ-`original_storage_paths.gift` כ-fallback
    - אחר (`magnets_pack`) → `expandMagnetsTiles` — מגנטים גלויים בלבד (`hidden=true` מדולגים), ממוינים לפי `m.order` (סדר הלקוח) אם קיים
  - `chunkTilesIntoPages(tiles, 15)` — מחלק למערך עמודים
- **DPI-Independent Crop Math (`src/lib/admin/PrintBatchPage.svelte`):**
  - קבוע `TILE_PX = 591` (= 50mm × 300dpi) — גודל רינדור לוגי
  - `getMagnetStyle(meta, natW, natH)` — `computeCoverBaseSize` + zoom + pan → left/top באחוזים
  - `getMosaicStyle(cropRect, transform, effect, imageRatio, natW, natH)` — cover-fit כולל grid, zoom+pan, הזזת חלון אריח לפי `col/row·TILE_PX`
  - כל גדלים/מיקומים בפרוצנטים מ-TILE_PX — DPI-independent (Law A)
- **תוויות cut-label:** לכל אריח: `#Order-NN`; לפסיפס: `#Order-NN • col/cols,row/rows`; לתמונת מתנה: `#Order-NN 🎁`
- **טעינת מקורות:** RPC `admin_get_print_originals(order_ids[])` — מחזיר `overridden_gift_crop` + `gift_image_path` + `original_storage_paths`; הלקוח יוצר signed URLs (תוקף שעה) לכל הpaths כולל תמונת מתנה
- **תצוגה מקדימה:** כל עמוד מוצג כקלף A4 בסקייל (~67%); `waitForAllImagesToSettle` ממתין לטעינת כל img + retry אחד
- **page-break:** `@media print`: `.page-preview-wrapper + .page-preview-wrapper { page-break-before: always }` — מונע דף ריק אחרון (Svelte text-nodes שוברים `:last-child`)
- **הוראת הדפסה:** A4 portrait ללא שוליים ללא scaling — `@page { size: A4 portrait; margin: 0 }`

**תיקון Chrome blob-URL fetch (`src/lib/utils/storage.js`, `src/lib/stores.js`, `src/lib/components/Magnet.svelte`):**
- **בעיה:** Chrome extensions מיירטים `fetch(blob:...)` ומשהים אותו (ERR_TIMED_OUT) — תמונות לא נשמרות ב-IndexedDB, tile נשאר ריק
- **תיקון storage.js:**
  - `fetchBlobSafe(blobUrl)` — XHR במקום fetch, timeout 10s, לא עובר דרך network stack
  - `dataUrlToBlob(dataUrl)` — atob + Uint8Array במקום `fetch('data:...')` (גם מיורט או נכשל תחת CSP)
  - `base64ToBlobUrl` משתמש ב-`dataUrlToBlob` (לא fetch)
  - `saveStateToStorage` — מגנטים: מעדיף `m.originalBlob instanceof Blob` → fallback ל-`fetchBlobSafe`; splitImageSrc/giftImage: משתמש ב-`fetchBlobSafe`
- **תיקון stores.js:** `addUploadedMagnets` מוסיף `originalBlob: f` (ה-File המקורי) לאובייקט המגנט — לא נשמר ב-IndexedDB (storage.js מסיר `originalBlob` לפני שמירה)
- **תיקון Magnet.svelte:** `decodeImageUrl` — hard timeout של 8 שניות; בלעדיו fetch מיורט מוביל ל-tile ריק לצמיתות

**Edge Function `send-shipping-notification`:**
- POST עם `{ order_id }` + `Authorization: Bearer <user_jwt>`
- מאמת: JWT תקין + caller ב-`admin_users`
- שולח מייל Hebrew "ההזמנה שלך בדרך! 🚚" עם thumbnails דרך Resend
- נגישה רק לאדמין — לא webhook DB
- **Secrets נדרשים:** `RESEND_API_KEY`, `ORDER_EMAIL_FROM` (=`no-reply@feel-ya.com`), `SHIPPING_WEBHOOK_SECRET`

---

## אבטחת Edge Functions — Webhook Secret

**Edge Function `send-order-confirmation`** (נקראת מ-DB webhook `orders-paid-email`):
- **ולידציית `WEBHOOK_SECRET`:** בתחילת הטיפול, הפונקציה בודקת את ה-header `Authorization: Bearer <token>` מול הסוד `WEBHOOK_SECRET` (מוגדר ב-Dashboard → Edge Functions → Secrets).
- אם הסוד מוגדר והערך לא תואם — מוחזר `401 Unauthorized`.
- אם הסוד **לא מוגדר** — הבדיקה מדולגת (תאימות לאחור).
- **הגדרה:** אותו ערך (service_role JWT) מוגדר גם ב-Secret `WEBHOOK_SECRET` וגם ב-Authorization header של ה-webhook `orders-paid-email` (Database → Webhooks).
- **Secrets נדרשים:** `RESEND_API_KEY`, `ORDER_EMAIL_FROM`, `WEBHOOK_SECRET`

