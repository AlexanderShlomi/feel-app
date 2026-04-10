import { test, expect } from '@playwright/test';

test('mosaic: grid size panel does not introduce horizontal scroll (mobile)', async ({ page }) => {
  await page.goto('/uploader');

  // Force MOSAIC mode with a tiny in-memory image so the Mosaic dock renders.
  const injected = await page.evaluate(async () => {
    try {
      const b64 =
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/6X2YfQAAAAASUVORK5CYII=';
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const blob = new Blob([bin], { type: 'image/png' });
      const url = URL.createObjectURL(blob);

      const mod = await import('/src/lib/stores.js');
      const PRODUCT_TYPES = mod?.PRODUCT_TYPES;
      const editorSettings = mod?.editorSettings;
      if (!PRODUCT_TYPES || !editorSettings?.update) return false;

      editorSettings.update((s) => ({
        ...s,
        currentProductType: PRODUCT_TYPES.MOSAIC,
        splitImageSrc: url,
        splitImageRatio: 1,
        gridBaseSize: Math.max(3, s.gridBaseSize || 3)
      }));

      return true;
    } catch {
      return false;
    }
  });

  expect(injected).toBeTruthy();

  // Open the "grid size" floating panel from the bottom dock.
  await page.getByRole('button', { name: 'גודל רשת' }).click({ force: true });

  // Regression guard: mosaic tiles should not rely on -webkit-optimize-contrast (can flicker on iOS).
  const firstTile = page.locator('.magnet-wrapper .split-image').first();
  await expect(firstTile).toBeVisible();
  const tileStyle = await firstTile.evaluate((el) => getComputedStyle(el).imageRendering);
  expect(tileStyle).toBe('auto');

  // Acceptable: 0–1px due to subpixel rounding.
  const noHorizontalScroll = await page.evaluate(() => {
    const doc = document.documentElement;
    const body = document.body;
    const okDoc = doc.scrollWidth <= doc.clientWidth + 1;
    const okBody = body ? body.scrollWidth <= doc.clientWidth + 1 : true;
    return okDoc && okBody;
  });

  expect(noHorizontalScroll).toBeTruthy();

  // Sanity: panel stays within viewport width.
  const panel = page.locator('.floating-panel');
  await expect(panel).toBeVisible();
  const bb = await panel.boundingBox();
  expect(bb).toBeTruthy();
  if (bb) {
    expect(bb.x).toBeGreaterThanOrEqual(-1);
    expect(bb.x + bb.width).toBeLessThanOrEqual((await page.viewportSize()).width + 1);
  }
});

