<script>
  /**
   * Batch work order ("דף עבודה") — printed alongside the cutting sheets.
   *
   * WHY THIS EXISTS
   * A cutting sheet carries tiles and a 6pt "#Order-NNN" cut-label, nothing
   * else. Everything needed to actually fulfil the batch — whose magnets these
   * are, how many each order should end up with, the greeting text that has to
   * be printed and inserted, the admin notes — lived only on the per-order
   * admin screen. The operator had to keep a browser tab per order open while
   * sorting cut magnets. `admin_get_print_originals` was already returning the
   * greeting (coalesced with the admin's override) and nothing consumed it.
   *
   * This sheet is RTL Hebrew: unlike the tile grid it is prose for a human, not
   * an index-ordered artefact, so it must follow the surrounding admin shell's
   * direction rather than being pinned LTR.
   */

  /**
   * @type {{
   *   manifest: Array<{
   *     orderId: string,
   *     orderNumber: number | string,
   *     customerName: string,
   *     tileCount: number,
   *     hasGift: boolean,
   *     giftMessage: string,
   *     adminNotes: string,
   *     breakdown: Array<{type: string, count: number}>
   *   }>,
   *   tileCount: number,
   *   pageCount: number
   * }}
   */
  export let manifest = [];
  export let tileCount = 0;
  export let pageCount = 0;

  const TYPE_LABELS = {
    magnets_pack: 'מגנטים',
    mosaic: 'פסיפס',
    gift: 'מגנט מתנה'
  };

  const typeLabel = (type) => TYPE_LABELS[type] ?? type;

  // Stamped once per mount. The operator uses it to tell two printouts of the
  // same queue apart when a batch is reprinted.
  const printedAt = new Date().toLocaleString('he-IL', {
    dateStyle: 'short',
    timeStyle: 'short'
  });
</script>

<section class="manifest">
  <header class="manifest-header">
    <h2 class="manifest-title">דף עבודה — מנת הדפסה</h2>
    <p class="manifest-meta">
      {manifest.length} הזמנות · {tileCount} מגנטים · {pageCount} גיליונות · הופק {printedAt}
    </p>
  </header>

  {#each manifest as row (row.orderId)}
    <article class="manifest-order">
      <div class="manifest-order-head">
        <span class="manifest-order-num">#{row.orderNumber}</span>
        <span class="manifest-order-name">{row.customerName || '—'}</span>
        <span class="manifest-order-count">{row.tileCount} מגנטים</span>
      </div>

      <p class="manifest-breakdown">
        {#each row.breakdown as part, i}{i > 0 ? ' · ' : ''}{typeLabel(part.type)}: {part.count}{/each}
        {#if row.hasGift}<span class="manifest-flag">🎁 כולל מגנט מתנה</span>{/if}
      </p>

      {#if row.giftMessage}
        <!-- The greeting is the one item on this sheet that gets transcribed
             onto a physical card, so it is set larger and boxed rather than
             folded into the metadata line. -->
        <div class="manifest-block manifest-block--greeting">
          <span class="manifest-block-label">✉️ ברכה להדפסה</span>
          <p class="manifest-greeting">{row.giftMessage}</p>
        </div>
      {/if}

      {#if row.adminNotes}
        <div class="manifest-block manifest-block--notes">
          <span class="manifest-block-label">הערות אדמין</span>
          <p class="manifest-notes">{row.adminNotes}</p>
        </div>
      {/if}

      <!-- Physical checkboxes: the operator ticks these with a pen while
           sorting the cut magnets, which is the step the batch flow had no
           record of at all. -->
      <div class="manifest-checks">
        <span class="manifest-check">☐ נחתך</span>
        <span class="manifest-check">☐ נספר</span>
        {#if row.giftMessage}<span class="manifest-check">☐ ברכה הודפסה</span>{/if}
        <span class="manifest-check">☐ נארז</span>
      </div>
    </article>
  {/each}
</section>

<style>
  .manifest {
    background: #fff;
    direction: rtl;
    box-sizing: border-box;
    padding: 12mm 10mm;
    color: #1e1e1e;
    font-size: 11pt;
    line-height: 1.5;
  }

  .manifest-header {
    border-bottom: 2px solid #1e1e1e;
    padding-bottom: 6px;
    margin-bottom: 12px;
  }

  .manifest-title {
    font-size: 16pt;
    font-weight: 800;
    margin: 0 0 2px;
  }

  .manifest-meta {
    margin: 0;
    font-size: 10pt;
    color: #555;
  }

  .manifest-order {
    border: 1px solid #ccc;
    border-radius: 4px;
    padding: 8px 10px;
    margin-bottom: 10px;
    /* An order's block must never be split across two sheets: half a greeting
       on the next page is exactly the failure this sheet exists to prevent. */
    break-inside: avoid;
    page-break-inside: avoid;
  }

  .manifest-order-head {
    display: flex;
    align-items: baseline;
    gap: 12px;
    flex-wrap: wrap;
    border-bottom: 1px solid #eee;
    padding-bottom: 4px;
    margin-bottom: 5px;
  }

  .manifest-order-num {
    font-size: 13pt;
    font-weight: 800;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }

  .manifest-order-name {
    font-size: 11pt;
    font-weight: 600;
    flex: 1;
    min-width: 0;
  }

  .manifest-order-count {
    font-size: 11pt;
    font-weight: 700;
    white-space: nowrap;
  }

  .manifest-breakdown {
    margin: 0 0 6px;
    font-size: 9.5pt;
    color: #555;
  }

  .manifest-flag {
    margin-inline-start: 8px;
    font-weight: 700;
    color: #e65100;
  }

  .manifest-block {
    border-inline-start: 3px solid #999;
    padding: 4px 8px;
    margin-bottom: 6px;
    background: #fafafa;
  }

  .manifest-block--greeting { border-inline-start-color: #2e7d32; }
  .manifest-block--notes { border-inline-start-color: #f5a623; }

  .manifest-block-label {
    display: block;
    font-size: 8.5pt;
    font-weight: 700;
    color: #555;
    margin-bottom: 2px;
  }

  .manifest-greeting {
    margin: 0;
    font-size: 12pt;
    line-height: 1.55;
    /* Author's line breaks are meaningful in a greeting. */
    white-space: pre-wrap;
  }

  .manifest-notes {
    margin: 0;
    font-size: 10pt;
    white-space: pre-wrap;
  }

  .manifest-checks {
    display: flex;
    gap: 14px;
    flex-wrap: wrap;
    font-size: 9.5pt;
    color: #333;
    margin-top: 4px;
  }

  .manifest-check { white-space: nowrap; }

  @media print {
    .manifest {
      padding: 10mm;
      print-color-adjust: exact;
      -webkit-print-color-adjust: exact;
    }
  }
</style>
