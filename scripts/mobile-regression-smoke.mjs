import puppeteer from 'puppeteer';

const BASE = process.env.BASE_URL || 'http://localhost:5173';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function run() {
  const browser = await puppeteer.launch({
    headless: 'new'
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true });

    page.on('console', (msg) => {
      const type = msg.type();
      // eslint-disable-next-line no-console
      console.log(`[browser:${type}]`, msg.text());
    });

    // --- Cart open/close + body scroll lock ---
    await page.goto(`${BASE}/select`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('.header-cart-btn', { timeout: 15000 });

    await page.click('.header-cart-btn');
    await page.waitForSelector('.cart-drawer', { timeout: 10000 });

    const locked = await page.evaluate(() => {
      const b = document.body;
      const h = document.documentElement;
      return {
        bodyOverflow: b?.style?.overflow || '',
        htmlOverflow: h?.style?.overflow || ''
      };
    });
    if (locked.bodyOverflow !== 'hidden' || locked.htmlOverflow !== 'hidden') {
      throw new Error(`Expected scroll lock (hidden), got body="${locked.bodyOverflow}" html="${locked.htmlOverflow}"`);
    }

    await page.click('.backdrop');
    await page.waitForSelector('.cart-drawer', { hidden: true, timeout: 10000 });

    const unlocked = await page.evaluate(() => {
      const b = document.body;
      const h = document.documentElement;
      return {
        bodyOverflow: b?.style?.overflow || '',
        htmlOverflow: h?.style?.overflow || ''
      };
    });
    if (unlocked.bodyOverflow === 'hidden' || unlocked.htmlOverflow === 'hidden') {
      throw new Error(`Expected scroll unlock, got body="${unlocked.bodyOverflow}" html="${unlocked.htmlOverflow}"`);
    }

    // --- Uploader scroll activity: ensure scroll events don't crash ---
    await page.goto(`${BASE}/uploader`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('.canvas-container', { timeout: 15000 });
    await page.evaluate(() => {
      const el = document.querySelector('.canvas-container');
      if (!el) throw new Error('Missing .canvas-container');
      el.scrollTop = 10;
      el.dispatchEvent(new Event('scroll', { bubbles: false }));
    });

    // Give debounced idle timers a moment to fire.
    await sleep(500);

    // Basic sanity: no detached portal nodes lingering after close.
    const portalCount = await page.evaluate(() => document.querySelectorAll('.cart-drawer, .backdrop').length);
    if (portalCount !== 0) {
      throw new Error(`Expected no cart portal nodes, found ${portalCount}`);
    }

    // eslint-disable-next-line no-console
    console.log('OK: mobile regression smoke passed');
  } finally {
    await browser.close();
  }
}

run().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('FAIL:', e);
  process.exitCode = 1;
});

