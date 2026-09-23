/**
 * Turning whatever the user handed us into one picture of one page.
 *
 * Two jobs, both done in the Chromium this repo already launches for
 * printing: rasterising a PDF page, and measuring the page's ground.
 * Neither is asked of the model — a PDF page is a fact and so is a
 * colour, and trading a measurement for an opinion is how a rebuilt
 * page ends up nearly the right colour.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { Browser } from 'playwright';

const require = createRequire(import.meta.url);

export type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';

/** Whether these bytes are a PDF rather than an image. */
export function isPdf(file: Buffer): boolean {
  return file.subarray(0, 5).toString('ascii') === '%PDF-';
}

/**
 * The image's real type, read from its first bytes.
 *
 * Named from the extension it was: a JPEG declared as `image/png` is
 * rejected by the API with a 400 that names the mismatch, and an upload
 * is exactly where a `.png` holding a JPEG turns up.
 */
export function mediaType(buffer: Buffer): ImageMediaType {
  if (buffer[0] === 0x89 && buffer[1] === 0x50) return 'image/png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return 'image/jpeg';
  if (buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (buffer.subarray(0, 3).toString('ascii') === 'GIF') return 'image/gif';
  throw new Error('filen er hverken PDF, PNG, JPEG, WebP eller GIF');
}

/**
 * One page of a PDF as a PNG.
 *
 * Rendered with pdf.js inside Chromium rather than by shelling out:
 * none of pdftoppm, mutool or ghostscript can be assumed present, and
 * the browser is the one dependency that is.
 */
export async function rasterisePdfPage(
  browser: Browser,
  file: Buffer,
  pageNumber: number,
): Promise<Buffer> {
  const tab = await browser.newPage();
  try {
    /*
     * pdf.js is SERVED to the page, not loaded off disk.
     *
     * It ships as ESM only, and a module import is a CORS request that
     * `file://` can never satisfy: from `about:blank` the origin is
     * opaque, and from a real file the fetch is still rejected. Both
     * were tried and both failed with "Failed to fetch dynamically
     * imported module".
     *
     * Routing an invented https origin through Playwright gives the tab
     * one ordinary web origin to load everything from — the host page,
     * the library and its worker — with no server process and nothing
     * written outside the repo.
     */
    const base = 'https://pdfjs.incitio.local';
    const files: Record<string, { body: Buffer; type: string }> = {
      '/host.html': {
        body: Buffer.from('<!doctype html><meta charset="utf-8"><title>rasterise</title>'),
        type: 'text/html',
      },
      '/pdf.mjs': {
        body: readFileSync(require.resolve('pdfjs-dist/build/pdf.mjs')),
        type: 'text/javascript',
      },
      '/pdf.worker.mjs': {
        body: readFileSync(require.resolve('pdfjs-dist/build/pdf.worker.mjs')),
        type: 'text/javascript',
      },
    };
    await tab.route(`${base}/**`, async (route) => {
      const hit = files[new URL(route.request().url()).pathname];
      if (!hit) return route.fulfill({ status: 404, body: '' });
      return route.fulfill({ status: 200, contentType: hit.type, body: hit.body });
    });

    await tab.goto(`${base}/host.html`, { waitUntil: 'load' });
    const dataUrl = `data:application/pdf;base64,${file.toString('base64')}`;

    const png = await tab.evaluate(async ({ lib, workerSrc, data, page }) => {
      /*
       * `new Function` rather than a plain `import(lib)`.
       *
       * This module is also run through vite-node, which rewrites every
       * literal `import()` in the source into its own SSR loader —
       * including the ones inside a string destined for the browser.
       * The page then threw `__vite_ssr_dynamic_import__ is not
       * defined`. Building the call at runtime puts it out of the
       * transform's reach; the browser still sees an ordinary dynamic
       * import.
       */
      const load = new Function('u', 'return import(u)') as (u: string) => Promise<{
        GlobalWorkerOptions: { workerSrc: string };
        getDocument: (o: unknown) => { promise: Promise<any> };
      }>;
      const mod = await load(lib);
      mod.GlobalWorkerOptions.workerSrc = workerSrc;
      const doc = await mod.getDocument({ url: data }).promise;
      if (page < 1 || page > doc.numPages) {
        throw new Error(`PDF har ${doc.numPages} sider, ikke side ${page}`);
      }
      const pdfPage = await doc.getPage(page);
      // 1400px on the long edge: enough for the model to read a price
      // and a grid, small enough to stay a cheap image block.
      const unit = pdfPage.getViewport({ scale: 1 });
      const viewport = pdfPage.getViewport({ scale: 1400 / Math.max(unit.width, unit.height) });
      const canvas = window.document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      await pdfPage.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      return canvas.toDataURL('image/png').split(',')[1];
    }, {
      lib: `${base}/pdf.mjs`,
      workerSrc: `${base}/pdf.worker.mjs`,
      data: dataUrl,
      page: pageNumber,
    });

    return Buffer.from(png as string, 'base64');
  } finally {
    await tab.close();
  }
}

/**
 * The page's ground, sampled rather than guessed.
 *
 * This is the single loudest thing about a chain's page and it is a
 * fact about the image, so asking a model for it would be trading a
 * measurement for an opinion. Read from the margins — the outer 6% on
 * each side, where a leaflet carries field and not product — and taken
 * as the most common colour there rather than the mean, because a mean
 * of cream and a red logo is pink.
 */
export async function sampleGround(
  browser: Browser,
  image: Buffer,
  type: ImageMediaType,
): Promise<string> {
  return (await sampleGroundPalette(browser, image, type))[0]!;
}

/**
 * The few colours the page's field is actually made of, commonest first.
 *
 * `sampleGround` above wants one colour and is right to: a rebuilt page
 * gets one `background`. But a chain's ground is often not one colour —
 * SuperBrugsen prints a cream field with a flower motif tiled over it,
 * and Netto's yellow carries a darker yellow pattern. Anything that
 * asks "is this pixel ground or is it ink?" needs all of them, or it
 * counts the pattern as product and reports a nearly empty page as
 * nearly full.
 *
 * Three, because that is what a printed field costs: the paper, the
 * motif, and the halftone between them. Taking more starts admitting
 * the packshots.
 */
export async function sampleGroundPalette(
  browser: Browser,
  image: Buffer,
  type: ImageMediaType,
  depth = 3,
): Promise<string[]> {
  const tab = await browser.newPage();
  try {
    await tab.goto('about:blank');
    return await tab.evaluate(async ({ dataUrl, want }) => {
      const img = new Image();
      img.src = dataUrl;
      await img.decode();
      const canvas = window.document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const { width: w, height: h } = canvas;
      const inset = { x: Math.round(w * 0.06), y: Math.round(h * 0.06) };
      const counts = new Map<string, number>();
      const bump = (x: number, y: number) => {
        const [r, g, b] = ctx.getImageData(x, y, 1, 1).data;
        // Quantised to 8 levels a channel: a scan of one flat field is
        // never one exact value, and counting exact values makes every
        // sample unique and the mode meaningless.
        const key = [r, g, b].map((c) => Math.round(c! / 32) * 32).join(',');
        counts.set(key, (counts.get(key) ?? 0) + 1);
      };
      for (let x = 0; x < w; x += Math.max(1, Math.round(w / 120))) {
        for (let y = 0; y < inset.y; y += Math.max(1, Math.round(inset.y / 10))) bump(x, y);
        for (let y = h - inset.y; y < h; y += Math.max(1, Math.round(inset.y / 10))) bump(x, y);
      }
      for (let y = 0; y < h; y += Math.max(1, Math.round(h / 120))) {
        for (let x = 0; x < inset.x; x += Math.max(1, Math.round(inset.x / 10))) bump(x, y);
        for (let x = w - inset.x; x < w; x += Math.max(1, Math.round(inset.x / 10))) bump(x, y);
      }
      const hex = (c: number) => Math.min(255, Math.max(0, c)).toString(16).padStart(2, '0');
      return [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, want)
        .map(([key]) => {
          const [r, g, b] = key.split(',').map(Number);
          return `#${hex(r!)}${hex(g!)}${hex(b!)}`;
        });
    }, { dataUrl: `data:${type};base64,${image.toString('base64')}`, want: depth });
  } finally {
    await tab.close();
  }
}

/**
 * Whatever arrived, as one image plus its type.
 *
 * The kind is read from the bytes rather than from the filename: an
 * upload is exactly where a `.png` holding a JPEG, or a PDF saved as
 * `side4.img`, turns up.
 */
export async function pageImage(
  browser: Browser,
  file: Buffer,
  pageNumber = 1,
): Promise<{ image: Buffer; type: ImageMediaType }> {
  if (!isPdf(file)) return { image: file, type: mediaType(file) };
  return { image: await rasterisePdfPage(browser, file, pageNumber), type: 'image/png' };
}
