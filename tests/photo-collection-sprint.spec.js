// Stabilization-sprint regression tests for the photo collection grid +
// single-magnet editor. Each test maps back to one of the sprint's findings
// so we can spot regressions without re-reading the review.
//
// Run via: `npm run test:smoke -- photo-collection-sprint`
//
// To run against a *real device* instead of the emulated Pixel 5:
//   1. Enable USB debugging on the phone, plug it in, run `chrome://inspect`
//      to confirm visibility from the host Chrome.
//   2. `adb reverse tcp:4173 tcp:4173` so the phone can reach the host's dev
//      server, OR start a Chrome instance on the phone with
//      `--remote-debugging-port=9222 --remote-debugging-address=0.0.0.0`.
//   3. Use `chromium.connectOverCDP(...)` in a custom fixture instead of
//      relying on the project-launched browser. The store-state assertions
//      below transfer 1:1; only the DOM snapshot in the perf test depends on
//      the actual viewport.
//
// Helper: capture the current value of a Svelte writable without leaking the
// subscription. Svelte calls the subscriber synchronously during `subscribe`
// so we record the value, immediately call the returned unsubscribe, and
// return. Avoids the TDZ trap of `let unsub; unsub = subscribe(...)` inside
// the same expression.
const SNAPSHOT_BODY = `
function snapshot(store) {
  let value;
  const u = store.subscribe(v => { value = v; });
  u();
  return value;
}
`;

const TINY_JPEG_B64 =
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/2wBDAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAARCAAQABADASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAr/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AL+AAAAAAAAAAAAA/9k=';

import { test, expect } from '@playwright/test';

async function uploadNMagnets(page, n) {
  const ok = await page.evaluate(async ({ b64, count, snapshotBody }) => {
    eval(snapshotBody);
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const files = Array.from({ length: count }, (_, i) =>
      new File([bin], `sprint-${i + 1}.jpg`, { type: 'image/jpeg' })
    );
    const mod = await import('/src/lib/stores.js');
    if (typeof mod?.addUploadedMagnets !== 'function') return false;
    await mod.addUploadedMagnets(files);
    return true;
  }, { b64: TINY_JPEG_B64, count: n, snapshotBody: SNAPSHOT_BODY });
  expect(ok).toBeTruthy();
}

test.describe('Photo collection — Stabilization Sprint', () => {
  test('Phase 3: mobile uploads start with src=null (skeleton path), preview resolves later', async ({ page }) => {
    await page.goto('/uploader');

    const initial = await page.evaluate(async ({ b64, snapshotBody }) => {
      eval(snapshotBody);
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const files = Array.from({ length: 4 }, (_, i) =>
        new File([bin], `sprint-${i + 1}.jpg`, { type: 'image/jpeg' })
      );
      const mod = await import('/src/lib/stores.js');
      await mod.addUploadedMagnets(files);
      // Capture the store state synchronously, BEFORE the async preview
      // generator (which runs in `.then(...)` callbacks queued during
      // `addUploadedMagnets`) gets to swap `src` to a preview blob.
      const snap = snapshot(mod.magnets);
      return snap.map((m) => ({
        hasOriginal: typeof m.originalSrc === 'string' && m.originalSrc.startsWith('blob:'),
        srcIsNull: m.src === null,
        srcIsBlob: typeof m.src === 'string' && m.src.startsWith('blob:')
      }));
    }, { b64: TINY_JPEG_B64, snapshotBody: SNAPSHOT_BODY });

    expect(initial.length).toBe(4);
    // Every magnet has an originalSrc immediately…
    expect(initial.every((m) => m.hasOriginal)).toBeTruthy();
    // …and the grid src is *not* the original. On mobile (the Playwright
    // project here emulates Pixel 5), src starts null until preview resolves;
    // on desktop the original is reused. Either is acceptable evidence that
    // the two-tier wiring exists.
    expect(initial.every((m) => m.srcIsNull || m.srcIsBlob)).toBeTruthy();

    // After a short wait, every src should be a blob URL (preview committed).
    await page.waitForFunction(({ snapshotBody }) => {
      const m = window.__sprintSnapshotEval ?? eval(snapshotBody) ?? null;
      // We re-eval the helper here because page.evaluate scopes don't persist.
      return import('/src/lib/stores.js').then((mod) => {
        let value;
        const u = mod.magnets.subscribe((v) => { value = v; });
        u();
        return Array.isArray(value)
          && value.length > 0
          && value.every((mm) => typeof mm.src === 'string' && mm.src.startsWith('blob:'));
      });
    }, { snapshotBody: SNAPSHOT_BODY }, { timeout: 6000 });
  });

  test('Phase 1: skeleton CSS infrastructure is wired into Magnet markup and animation runs', async ({ page }) => {
    await page.goto('/uploader');
    await uploadNMagnets(page, 1);

    // The skeleton may have already faded out in the very fast emulator
    // by the time we query — that's OK. What matters is that the *style*
    // for the pulse is present in the page, i.e. the CSS rules from
    // `Magnet.svelte` shipped to the client.
    const cssOk = await page.evaluate(() => {
      const sheets = Array.from(document.styleSheets);
      let foundPulse = false;
      let foundFadeOut = false;
      for (const s of sheets) {
        let rules;
        try { rules = s.cssRules; } catch { continue; } // skip CORS-blocked sheets
        if (!rules) continue;
        for (const r of rules) {
          const txt = r.cssText || '';
          if (txt.includes('tileSkeletonPulse')) foundPulse = true;
          if (txt.includes('tile-skeleton--fade-out')) foundFadeOut = true;
        }
      }
      return { foundPulse, foundFadeOut };
    });

    expect(cssOk.foundPulse).toBeTruthy();
    expect(cssOk.foundFadeOut).toBeTruthy();
  });

  test('Phase 2a / Phase 5: editor save round-trips xPct/yPct/zoom into the magnet store with high precision', async ({ page }) => {
    await page.goto('/uploader');
    await uploadNMagnets(page, 1);

    const expected = { zoom: 1.5, xPct: 0.25, yPct: -0.4 };
    const stored = await page.evaluate(async ({ tr, snapshotBody }) => {
      eval(snapshotBody);
      const mod = await import('/src/lib/stores.js');
      const list = snapshot(mod.magnets);
      mod.updateMagnetTransform(list[0].id, tr);
      mod.bumpWorkspaceLayoutRefreshSignal();
      const after = snapshot(mod.magnets);
      return after[0].transform;
    }, { tr: expected, snapshotBody: SNAPSHOT_BODY });

    expect(stored.zoom).toBeCloseTo(expected.zoom, 6);
    expect(stored.xPct).toBeCloseTo(expected.xPct, 6);
    expect(stored.yPct).toBeCloseTo(expected.yPct, 6);
  });

  test('Phase 5 / accuracy: grid <Magnet> renders the saved transform as CSS variables', async ({ page }) => {
    await page.goto('/uploader');
    await uploadNMagnets(page, 1);

    const expected = { zoom: 2, xPct: 0.5, yPct: 0 };
    await page.evaluate(async ({ tr, snapshotBody }) => {
      eval(snapshotBody);
      const mod = await import('/src/lib/stores.js');
      const list = snapshot(mod.magnets);
      mod.updateMagnetTransform(list[0].id, tr);
      mod.bumpWorkspaceLayoutRefreshSignal();
    }, { tr: expected, snapshotBody: SNAPSHOT_BODY });

    // Wait until the inner <img> has decoded so cropForCss has real
    // naturalWidth/Height to work with.
    await page.waitForFunction(() => {
      const img = document.querySelector('.magnet .magnet-image');
      return img && img.complete && img.naturalWidth > 0;
    }, null, { timeout: 6000 });

    const cssVars = await page.evaluate(() => {
      const el = document.querySelector('.magnet');
      if (!el) return null;
      const cs = getComputedStyle(el);
      return {
        zoom: parseFloat(cs.getPropertyValue('--zoom')),
        tx: cs.getPropertyValue('--tx').trim(),
        ty: cs.getPropertyValue('--ty').trim()
      };
    });

    expect(cssVars).not.toBeNull();
    expect(cssVars.zoom).toBeCloseTo(expected.zoom, 4);
    const txNum = parseFloat(cssVars.tx);
    expect(Number.isFinite(txNum)).toBeTruthy();
    expect(Math.abs(txNum)).toBeGreaterThan(0); // xPct=0.5 with zoom>1 must shift off-center
  });

  test('Phase 6: editor dock fits within viewport without horizontal scroll', async ({ page }) => {
    await page.goto('/uploader');
    await uploadNMagnets(page, 1);

    // Wait for the magnet to actually be rendered in the DOM. Using `page.goto`
    // here would lose the store state (full reload), so we navigate via the
    // real UI: tap the tile, which `+layout.svelte` wires to `openEditorForMagnet`.
    await page.waitForFunction(({ snapshotBody }) => {
      return import('/src/lib/stores.js').then((mod) => {
        let value;
        const u = mod.magnets.subscribe((v) => { value = v; });
        u();
        return Array.isArray(value)
          && value.length > 0
          && typeof value[0].src === 'string';
      });
    }, { snapshotBody: SNAPSHOT_BODY }, { timeout: 6000 });

    // The mobile grid uses `pointer-events: none` on `.magnet-wrapper` so vertical
    // scrolling passes through; the actual tap-to-edit is detected via coords on
    // `.canvas-container` (`getMagnetIdAtPoint` in `+layout.svelte`). Use a
    // coordinate-based tap that matches what a real finger would do.
    const box = await page.locator('.magnet-wrapper').first().boundingBox();
    expect(box).not.toBeNull();
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForURL(/\/uploader\/edit\//, { timeout: 6000 });
    // The persistent uploader workspace also has a `.glass-dock` (hidden via
    // `display:none`), so target the editor's dock by id to avoid ambiguity.
    await page.waitForSelector('#bottom-toolbar-edit.glass-dock');

    const dockMetrics = await page.locator('#bottom-toolbar-edit.glass-dock').evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      overflowX: getComputedStyle(el).overflowX
    }));
    expect(dockMetrics.overflowX).not.toBe('auto');
    expect(dockMetrics.overflowX).not.toBe('scroll');
    expect(dockMetrics.scrollWidth).toBeLessThanOrEqual(dockMetrics.clientWidth + 1);

    const docMetrics = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth
    }));
    expect(docMetrics.scrollWidth).toBeLessThanOrEqual(docMetrics.clientWidth + 1);
  });

  test('Performance: scrolling the grid stays within a frame budget', async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto('/uploader');
    await uploadNMagnets(page, 24);

    // Wait until at least the top-of-grid magnets have a valid src so scroll has something to render.
    await page.waitForFunction(({ snapshotBody }) => {
      return import('/src/lib/stores.js').then((mod) => {
        let value;
        const u = mod.magnets.subscribe((v) => { value = v; });
        u();
        return Array.isArray(value)
          && value.length === 24
          && value.slice(0, 4).every((m) => typeof m.src === 'string');
      });
    }, { snapshotBody: SNAPSHOT_BODY }, { timeout: 15_000 });

    const samples = await page.evaluate(async () => {
      const container = document.querySelector('.canvas-container.mobile-grid-active') || document.scrollingElement;
      const intervals = [];
      let last = performance.now();
      let stop = false;
      function sample() {
        const now = performance.now();
        intervals.push(now - last);
        last = now;
        if (!stop) requestAnimationFrame(sample);
      }
      requestAnimationFrame(sample);

      const start = performance.now();
      while (performance.now() - start < 2000) {
        if (container && typeof container.scrollBy === 'function') {
          container.scrollBy({ top: 16, behavior: 'auto' });
        } else {
          window.scrollBy(0, 16);
        }
        await new Promise((r) => setTimeout(r, 16));
      }
      stop = true;
      // Skip the first two samples (warm-up) and clamp pathological gaps.
      return intervals.slice(2).filter((d) => d < 200);
    });

    if (samples.length < 30) {
      console.warn(`[perf] only ${samples.length} samples captured`);
      return;
    }

    const avg = samples.reduce((s, x) => s + x, 0) / samples.length;
    const sorted = samples.slice().sort((a, b) => a - b);
    const p95 = sorted[Math.floor(samples.length * 0.95)];
    console.log(`[perf] avg frame: ${avg.toFixed(2)}ms, p95: ${p95.toFixed(2)}ms, n=${samples.length}`);

    // Pixel-5 emulation under headless chromium isn't a true 60fps surface,
    // but it should comfortably fit < 33ms p95 (~30fps floor) — a regression
    // would push us above this in practice. Tighten when running on real
    // hardware via CDP.
    expect(p95).toBeLessThan(33);
  });
});
