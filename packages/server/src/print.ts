import { createRequire } from 'node:module';
import type { Browser } from 'playwright';
import type { Brand, CatalogDocument } from '@incitio/schema';
import { inspectCatalogue } from '@incitio/pdf';
import { measureInputs, type Finding } from '@incitio/workflow';

/**
 * The checks that need the avis drawn: a line clipped in half, a price
 * on a name, a picture off the sheet.
 *
 * The studio measures these on the pages on screen; a script or a stale
 * tab has no screen, so before an avis is published the server draws it
 * the way the PDF is drawn and measures it with the same code — the
 * studio's `measured.ts`, bundled into the page. Slow (seconds), which
 * is why it runs at publishing and not on every save.
 */

let bundled: Promise<string> | null = null;

/** `measured.ts` as one script for the page, built once per process. */
function measureScript(): Promise<string> {
  bundled ??= (async () => {
    const esbuild = await import('esbuild');
    const require = createRequire(import.meta.url);
    const out = await esbuild.build({
      entryPoints: [require.resolve('@incitio/workflow/measured')],
      bundle: true,
      format: 'iife',
      globalName: 'IncitioMeasure',
      platform: 'browser',
      write: false,
      logLevel: 'silent',
    });
    return out.outputFiles[0]!.text;
  })();
  bundled.catch(() => { bundled = null; });
  return bundled;
}

export interface MeasureOptions { assetDir?: string; browser?: Browser; imageTimeoutMs?: number }

/** The measured findings on an avis, as the studio would list them. */
export async function measuredFindings(avis: CatalogDocument, brand: Brand, options: MeasureOptions = {}): Promise<Finding[]> {
  const script = await measureScript();
  const { untouched, crowding } = measureInputs(avis);
  return inspectCatalogue(avis, brand, async (page) => {
    await page.addScriptTag({ content: script });
    return page.evaluate((input) => {
      const api = (globalThis as unknown as {
        IncitioMeasure: { measureFindings: (root: ParentNode, ids: string[], untouched: Set<string>, crowding: Map<string, unknown>) => unknown };
      }).IncitioMeasure;
      // `document` is the page's own here: this function runs in Chromium.
      return api.measureFindings(document, input.pageIds, new Set(input.untouched), new Map(input.crowding));
    }, { pageIds: avis.pages.map((p) => p.id), untouched: [...untouched], crowding: [...crowding] }) as Promise<Finding[]>;
  }, {
    ...(options.assetDir ? { assetDir: options.assetDir } : {}),
    ...(options.browser ? { browser: options.browser } : {}),
    imageTimeoutMs: options.imageTimeoutMs ?? 15_000,
  });
}
