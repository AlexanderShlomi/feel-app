<script>
  /**
   * On-screen "assembled reference" for a single mosaic.
   *
   * WHY THIS EXISTS
   * The printed sheet nests tiles 3-across for paper efficiency, so a mosaic
   * whose native grid is 4 or 5 columns wide never reconstructs the customer's
   * photo on paper. The admin cannot tell by looking at the sheet whether the
   * right image, crop, zoom and effect were used.
   *
   * This renders the mosaic WHOLE at its native cols x rows using the SAME
   * geometry module as the printed sheet (Law A), so it is a faithful picture
   * of what the customer composed in the editor. Screen only: hidden in
   * @media print.
   */
  import { getMosaicWholeStyle } from '$lib/admin/printCropMath.js';

  /**
   * @type {{
   *   ref: {
   *     orderNumber: number | string,
   *     cols: number,
   *     rows: number,
   *     transform: { zoom: number, xPct: number, yPct: number },
   *     effect: string,
   *     imageRatio: number | null
   *   },
   *   url: string
   * }}
   */
  export let ref;
  export let url;

  function getStyle(imgNatW, imgNatH) {
    return getMosaicWholeStyle(
      ref.cols,
      ref.rows,
      ref.transform,
      ref.effect,
      ref.imageRatio,
      imgNatW,
      imgNatH
    );
  }
</script>

<figure class="mosaic-ref">
  <figcaption class="mosaic-ref-caption">
    הזמנה #{ref.orderNumber} — פסיפס {ref.cols}×{ref.rows} ({ref.cols * ref.rows} מגנטים)
  </figcaption>

  <!-- direction:ltr — the surrounding admin shell is RTL; the cut-line overlay
       is index-based and must run left-to-right like the tile stream. -->
  <div
    class="mosaic-ref-frame"
    style="aspect-ratio: {ref.cols} / {ref.rows};"
  >
    {#if url}
      <img
        src={url}
        alt="תצוגת הפסיפס המורכב כפי שהלקוח הרכיב אותו"
        class="mosaic-ref-img"
        style={getStyle(0, 0)}
        on:load={(e) => {
          if (ref.imageRatio == null) {
            const img = e.target;
            img.style = getStyle(img.naturalWidth, img.naturalHeight);
          }
        }}
      />
    {:else}
      <div class="mosaic-ref-placeholder"></div>
    {/if}

    <!-- Cut-line overlay: shows where the guillotine splits the image, so the
         admin sees the same grid the customer saw in the editor. -->
    <div
      class="mosaic-ref-grid"
      style="grid-template-columns: repeat({ref.cols}, 1fr); grid-template-rows: repeat({ref.rows}, 1fr);"
      aria-hidden="true"
    >
      {#each Array(ref.cols * ref.rows) as _}
        <span class="mosaic-ref-cell"></span>
      {/each}
    </div>
  </div>
</figure>

<style>
  .mosaic-ref {
    margin: 0;
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .mosaic-ref-caption {
    font-size: 12px;
    font-weight: 600;
    color: #555;
    text-align: center;
  }

  .mosaic-ref-frame {
    position: relative;
    overflow: hidden;
    width: 100%;
    background: #f9f9f9;
    border-radius: 4px;
    /* See the note on .batch-grid in PrintBatchPage: the admin shell is RTL
       and the overlay below is a direction-sensitive grid. */
    direction: ltr;
  }

  .mosaic-ref-img {
    display: block;
    max-width: none;
    max-height: none;
  }

  .mosaic-ref-grid {
    position: absolute;
    inset: 0;
    display: grid;
    pointer-events: none;
  }

  .mosaic-ref-cell {
    border: 1px solid rgba(255, 255, 255, 0.55);
    box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.12);
  }

  .mosaic-ref-placeholder {
    width: 100%;
    height: 100%;
    background: #eee;
  }

  /* Reference is a screen-only verification aid — never goes on paper. */
  @media print {
    .mosaic-ref {
      display: none !important;
    }
  }
</style>
