<script>
    /**
     * עטיפה אחידה לעמודים משפטיים (תנאי שימוש, תקנון ביטולים, נגישות).
     * עמוד סטטי in-flow (לא מודאל) — נגיש בקישור ישיר, כנדרש ע"י ספקי סליקה.
     */
    export let title = '';
    /** תאריך עדכון בפורמט ISO — עדכן בעת שינוי תוכן המסמך */
    export let updatedIso = '';

    $: lastUpdated = updatedIso
        ? new Date(updatedIso).toLocaleDateString('he-IL', {
              day: '2-digit',
              month: '2-digit',
              year: 'numeric'
          })
        : '—';
</script>

<svelte:head>
    <title>{title} – FEEL</title>
</svelte:head>

<div class="page-container legal-page" dir="rtl">
    <article class="legal-card">
        <header class="legal-header">
            <div class="brand-line">FEEL • LUXURY MEMORIES</div>
            <h1>{title}</h1>
            <div class="header-meta">עודכן לאחרונה: {lastUpdated}</div>
        </header>

        <div class="legal-body">
            <slot />
        </div>
    </article>
</div>

<style>
    /* .page-container הגלובלי הוא flex-column — מרכוז אופקי דרך align-items */
    .legal-page {
        align-items: center;
        justify-content: flex-start;
        padding-bottom: 60px;
    }

    .legal-card {
        background: #f2f0ec;
        color: #475160;
        width: 100%;
        max-width: 800px;
        margin: 20px;
        border-radius: 30px;
        overflow: hidden;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.12);
    }

    .legal-header {
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

    h1 {
        margin: 0;
        font-size: 24px;
        font-weight: 700;
        color: #1e2a38;
        line-height: 1.35;
    }

    .header-meta {
        margin-top: 8px;
        font-size: 12px;
        color: #888;
    }

    .legal-body {
        padding: 40px 45px;
        text-align: right;
    }

    /* התוכן מגיע מ-slot — עיצוב אחיד לכל המסמכים */
    .legal-body :global(section) {
        margin-bottom: 35px;
    }

    .legal-body :global(h2) {
        color: #846349;
        font-size: 19px;
        font-weight: 700;
        margin: 0 0 15px;
        border-right: 4px solid #c6b29a;
        padding-right: 15px;
    }

    .legal-body :global(p),
    .legal-body :global(li) {
        font-size: 15px;
        line-height: 1.8;
        color: #475160;
        margin-bottom: 10px;
    }

    .legal-body :global(ul),
    .legal-body :global(ol) {
        padding-right: 20px;
    }

    .legal-body :global(ul) {
        list-style: circle;
    }

    .legal-body :global(.highlight-section) {
        background: rgba(198, 178, 154, 0.1);
        padding: 25px;
        border-radius: 18px;
        border: 1px solid rgba(198, 178, 154, 0.2);
    }

    .legal-body :global(.legal-alert) {
        color: #1e2a38;
        font-weight: 700;
    }

    .legal-body :global(a) {
        color: #1e2a38;
        text-decoration: none;
        border-bottom: 1px solid transparent;
        transition: 0.2s;
        font-weight: 600;
    }

    .legal-body :global(a:hover) {
        border-bottom-color: #1e2a38;
    }

    @media (max-width: 768px) {
        .legal-card {
            margin: 10px;
            border-radius: 20px;
        }

        .legal-body {
            padding: 30px 25px;
        }

        h1 {
            font-size: 20px;
        }
    }
</style>
