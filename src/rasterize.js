// Flat-image rasterizer (ADR-006). Drives a headless Chromium (Playwright) to
// screenshot a rendered page into a PNG, so a "dumb" screen that can't load
// HTML/CSS/SVG can still poll a single immutable image URL and display a board.
//
// Faithful by construction: it screenshots the SAME render routes a browser
// would show (publish snapshots), so gradients, SVG textPath, fonts and
// per-site assets reproduce exactly — no second renderer to keep in sync.
//
// Best-effort: Playwright + its browser are an OPTIONAL capability. Everything
// here imports Playwright lazily and degrades gracefully — a missing browser
// never breaks publish; it just means no flat image until one is installed.

let browserPromise = null; // singleton; launched on first use, reused after.

export class RasterizeUnavailable extends Error {
  constructor(message) { super(message); this.name = 'RasterizeUnavailable'; }
}

/** Lazily import + launch a shared headless browser. Throws RasterizeUnavailable. */
async function getBrowser() {
  if (!browserPromise) {
    browserPromise = (async () => {
      let chromium;
      try {
        ({ chromium } = await import('playwright'));
      } catch {
        throw new RasterizeUnavailable('Playwright is not installed (run: npm i playwright).');
      }
      try {
        return await chromium.launch({ args: ['--no-sandbox', '--disable-gpu'] });
      } catch (e) {
        throw new RasterizeUnavailable(
          `No headless browser available (run: npx playwright install chromium). ${e.message}`,
        );
      }
    })();
    // If launch fails, clear the cache so a later attempt (after install) retries.
    browserPromise.catch(() => { browserPromise = null; });
  }
  return browserPromise;
}

/**
 * Screenshot `url` at exactly `width`x`height` device pixels into a PNG Buffer.
 * Waits for network idle + web fonts so type renders, then clips to the frame.
 */
export async function rasterizeUrl({ url, width = 1920, height = 1080, timeoutMs = 15000, scale = 1 }) {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const browser = await getBrowser();
  const context = await browser.newContext({
    viewport: { width: w, height: h },
    deviceScaleFactor: scale,
  });
  try {
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'networkidle', timeout: timeoutMs });
    // Web fonts may resolve after networkidle; wait for them so type isn't a fallback.
    await page.evaluate(() => (document.fonts ? document.fonts.ready : null)).catch(() => {});
    return await page.screenshot({
      type: 'png',
      clip: { x: 0, y: 0, width: w, height: h }, // exact signage frame, never a tall full-page capture
    });
  } finally {
    await context.close().catch(() => {});
  }
}

/** Close the shared browser (process shutdown / tests). Safe to call when idle. */
export async function closeRasterizer() {
  if (!browserPromise) return;
  const p = browserPromise;
  browserPromise = null;
  try { (await p).close(); } catch { /* already gone */ }
}
