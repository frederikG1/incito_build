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
  /**
   * Print the sheet for a printer rather than for a screen: the page
   * grown by `bleedMm` on every side, crop marks in a slug around it,
   * and a line saying what the sheet is. Omit for a proof.
   */
  marks?: PrintMarks;
}

export interface PrintMarks {
  /** How far the ground runs past the trim. 3 mm is what Danish printers ask for. */
  bleedMm?: number;
  /** Written in the slug of every sheet — chain, week, when it was printed. */
  slug?: string;
}

/** The white margin the crop marks stand in. */
const SLUG_MM = 10;

/**
 * Stand every page on a larger sheet with bleed and crop marks.
 *
 * Done in the browser after load rather than in the markup, because
 * the page's ground is only known once the stylesheet has run: it is
 * a CSS variable that depends on the page's place in the book. The
 * bleed is the page's own computed ground, plus its background picture
 * when it has one, drawn 3 mm larger underneath the trimmed page — so
 * nothing on the page moves, and nothing is re-laid out for print.
 */
function markSheets(input: { bleed: number; slug: number; label: string }): void {
  const mm = (n: number) => `${n}mm`;
  const pages = [...document.querySelectorAll<HTMLElement>('.catalog > .page, .catalog .page')];
  pages.forEach((page, index) => {
    // Read while the page still stands in the book: its ground depends
    // on where it sits, and a detached element has no computed style.
    const ground = getComputedStyle(page).backgroundColor;
    const sheet = document.createElement('div');
    sheet.className = 'sheet';
    page.replaceWith(sheet);

    const bleed = document.createElement('div');
    bleed.className = 'sheet__bleed';
    bleed.style.background = ground;
    const picture = page.querySelector(':scope > .page__bg');
    if (picture) bleed.append(picture.cloneNode(true));
    sheet.append(bleed, page);

    const at = input.slug + input.bleed;
    const length = input.slug - 3;
    const marks: [string, string, string, string][] = [];
    for (const x of ['left', 'right'] as const) {
      for (const y of ['top', 'bottom'] as const) {
        // Horizontal mark, level with the trim, out in the slug.
        marks.push([`${x}:0`, `${y}:${mm(at)}`, `width:${mm(length)}`, 'height:0;border-top:0.25pt solid #000']);
        // Vertical mark, level with the trim, out in the slug.
        marks.push([`${x}:${mm(at)}`, `${y}:0`, `height:${mm(length)}`, 'width:0;border-left:0.25pt solid #000']);
      }
    }
    for (const style of marks) {
      const mark = document.createElement('i');
      mark.className = 'sheet__mark';
      mark.setAttribute('style', style.join(';'));
      sheet.append(mark);
    }

    const said = document.createElement('span');
    said.className = 'sheet__slug';
    said.textContent = `${input.label} · side ${index + 1} af ${pages.length}`;
    sheet.append(said);
  });
}

function sheetCss(widthMm: number, heightMm: number, bleed: number): string {
  const edge = SLUG_MM + bleed;
  return `
  @page { size: ${(widthMm + 2 * edge).toFixed(2)}mm ${(heightMm + 2 * edge).toFixed(2)}mm; margin: 0; }
  @media print {
    .sheet {
      position: relative;
      width: ${(widthMm + 2 * edge).toFixed(2)}mm;
      height: ${(heightMm + 2 * edge).toFixed(2)}mm;
      background: #fff;
      break-after: page;
      overflow: hidden;
    }
    .sheet:last-child { break-after: auto; }
    .sheet__bleed {
      position: absolute;
      left: ${SLUG_MM}mm; top: ${SLUG_MM}mm;
      width: ${(widthMm + 2 * bleed).toFixed(2)}mm;
      height: ${(heightMm + 2 * bleed).toFixed(2)}mm;
      container-type: size;
    }
    .sheet > .page { position: absolute; left: ${edge}mm; top: ${edge}mm; break-after: auto; }
    .sheet__mark { position: absolute; display: block; }
    .sheet__slug {
      position: absolute; left: ${edge}mm; bottom: 3mm;
      font: 6.5pt/1 system-ui, sans-serif; color: #000;
    }
  }`;
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
  const bleed = options.marks ? options.marks.bleedMm ?? 3 : 0;
  const html = renderCatalogueHtml(document, brand, {
    widthMm,
    ...(options.assetDir ? { assetBase: pathToFileURL(`${options.assetDir}/`).href } : {}),
    ...(options.marks ? { extraCss: sheetCss(widthMm, heightMm, bleed) } : {}),
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
    await settleBackgrounds(page, options.imageTimeoutMs ?? 20_000);

    if (options.marks) {
      await page.evaluate(markSheets, {
        bleed,
        slug: SLUG_MM,
        label: options.marks.slug ?? document.name,
      });
    }
    const edge = options.marks ? 2 * (SLUG_MM + bleed) : 0;

    return await page.pdf({
      width: `${(widthMm + edge).toFixed(2)}mm`,
      height: `${(heightMm + edge).toFixed(2)}mm`,
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
  options: PrintOptions & { widthPx?: number; css?: string } = {},
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
    // Extra rules for a partial proof — the ground alone, say.
    if (options.css) await page.addStyleTag({ content: options.css });
    await settleImages(page, options.imageTimeoutMs ?? 20_000);
    await settleBackgrounds(page, options.imageTimeoutMs ?? 20_000);

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

/**
 * Wait for every page's background picture.
 *
 * A CSS `background-image` is not an `<img>`, so `settleImages` never
 * sees it, and a sheet photographed before its picture arrived is the
 * ground colour alone. Each one is loaded once more as an image and
 * awaited — the browser serves the second request from its cache.
 */
async function settleBackgrounds(page: import('playwright').Page, timeoutMs: number): Promise<void> {
  await page.evaluate(async (timeout) => {
    const urls = [...document.querySelectorAll<HTMLElement>('.page__bg')]
      .map((el) => /url\(["']?(.*?)["']?\)/.exec(getComputedStyle(el).backgroundImage)?.[1])
      .filter((url): url is string => Boolean(url));
    await Promise.race([
      Promise.all(urls.map((url) => new Promise<void>((done) => {
        const img = new Image();
        img.onload = () => done();
        img.onerror = () => done();
        img.src = url;
      }))),
      new Promise<void>((done) => setTimeout(done, timeout)),
    ]);
  }, timeoutMs);
}
