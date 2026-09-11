import { writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { chromium, type Browser } from 'playwright';
import type { Brand, CatalogDocument } from '@incitio/schema';
import { renderCatalogueHtml } from './html.js';

export * from './html.js';
export * from './assets.js';

export interface PrintOptions {
  /** Page width in millimetres. A4 portrait is 210. */
  widthMm?: number;
  /**
   * Directory that root-relative asset paths resolve against.
   *
   * The page is written into it so `/images/x.svg` in a feed lands on
   * `<assetDir>/images/x.svg`. Omit for feeds carrying absolute URLs.
   */
  assetDir?: string;
  /** How long to wait for product photography, in ms. */
  imageTimeoutMs?: number;
  /** Reuse a browser across several catalogues. One is launched if absent. */
  browser?: Browser;
}

/**
 * Render a catalogue to a print-ready PDF.
 *
 * Chromium is the renderer for the same reason it is the previewer: one
 * engine, one stylesheet, one result. The only thing this adds over the
 * editor is patience — leaflet artwork is fetched from image services
 * and printing before it arrives produces a book of empty boxes, so the
 * page is not printed until every image has settled.
 */
export async function renderCataloguePdf(
  document: CatalogDocument,
  brand: Brand,
  options: PrintOptions = {},
): Promise<Buffer> {
  const widthMm = options.widthMm ?? 210;
  const heightMm = widthMm / brand.pageAspect;
  const html = renderCatalogueHtml(document, brand, {
    widthMm,
    ...(options.assetDir ? { assetBase: pathToFileURL(`${options.assetDir}/`).href } : {}),
  });

  const browser = options.browser ?? (await chromium.launch());
  const page = await browser.newPage();

  /*
   * Loaded from a real file, not `setContent`.
   *
   * `setContent` leaves the document on `about:blank`, and Chromium
   * refuses `file://` subresources from that origin — so a feed carrying
   * root-relative image paths printed a book of empty tiles with no
   * error anywhere. Writing the page next to the assets makes it a
   * same-origin file load and the paths resolve the way a browser
   * expects.
   */
  const scratch = join(options.assetDir ?? tmpdir(), `.incitio-print-${randomUUID()}.html`);
  writeFileSync(scratch, html);

  try {
    await page.goto(pathToFileURL(scratch).href, { waitUntil: 'load' });
    await settleType(page);
    await settleImages(page, options.imageTimeoutMs ?? 20_000);

    return await page.pdf({
      width: `${widthMm}mm`,
      height: `${heightMm.toFixed(2)}mm`,
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    });
  } finally {
    await page.close();
    rmSync(scratch, { force: true });
    // Only close what we opened: a caller printing twenty catalogues
    // should not pay for twenty browser launches.
    if (!options.browser) await browser.close();
  }
}

/**
 * Render each page to a PNG.
 *
 * The same load path as the PDF, screen media rather than print, so a
 * reviewer can look at pages in a chat, a ticket or a diff without a PDF
 * viewer. Not part of the print pipeline — proofs, not output.
 */
export async function renderCataloguePngs(
  document: CatalogDocument,
  brand: Brand,
  options: PrintOptions & { widthPx?: number } = {},
): Promise<Buffer[]> {
  const widthPx = options.widthPx ?? 900;
  const html = renderCatalogueHtml(document, brand,
    options.assetDir ? { assetBase: pathToFileURL(`${options.assetDir}/`).href } : {});

  const browser = options.browser ?? (await chromium.launch());
  const page = await browser.newPage({
    viewport: { width: widthPx + 80, height: Math.round(widthPx / brand.pageAspect) },
    deviceScaleFactor: 2,
  });

  const scratch = join(options.assetDir ?? tmpdir(), `.incitio-proof-${randomUUID()}.html`);
  writeFileSync(scratch, html);

  try {
    await page.goto(pathToFileURL(scratch).href, { waitUntil: 'load' });
    await settleType(page);
    await settleImages(page, options.imageTimeoutMs ?? 20_000);

    const shots: Buffer[] = [];
    for (const element of await page.locator('.page').all()) {
      shots.push(await element.screenshot());
    }
    return shots;
  } finally {
    await page.close();
    rmSync(scratch, { force: true });
    if (!options.browser) await browser.close();
  }
}

/**
 * Wait for every `<img>` to load or fail.
 *
 * `waitUntil: 'networkidle'` is not enough on its own — lazy-loaded
 * images below the fold never enter the network at all until they are
 * scrolled to, and a print render never scrolls. So loading is forced
 * eagerly first, then awaited.
 */
/**
 * Do not print until the chain's typeface is live.
 *
 * The faces are data URIs in the document, so there is nothing to fetch
 * — but a face is not usable the instant the document loads, and a page
 * printed in that window is laid out on the fallback's metrics and
 * drawn with the real face's. Every line ends up a hair off the width
 * it was measured at, which on a price mark is the difference between
 * a centred numeral and one that leans. One await removes the race.
 */
async function settleType(page: import('playwright').Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
    // An old Chromium without the API prints the way it always did.
    .catch(() => undefined);
}

async function settleImages(page: import('playwright').Page, timeoutMs: number): Promise<void> {
  await page.evaluate(() => {
    for (const img of Array.from(document.images)) img.loading = 'eager';
  });
  await page
    .waitForFunction(
      () => Array.from(document.images).every((img) => img.complete),
      undefined,
      { timeout: timeoutMs },
    )
    // A slow image service must not cost the whole print run. The page
    // still prints; the missing tile shows its placeholder.
    .catch(() => undefined);
}
