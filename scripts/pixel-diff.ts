/**
 * The avis as it renders, compared pixel by pixel with a reference.
 *
 *   npm run pixeldiff -- --catalog <id> --brand superbrugsen --against refs/u41         # vs saved pages
 *   npm run pixeldiff -- --catalog <id> --brand superbrugsen --against refs/u41 --update  # save them
 *   npm run pixeldiff -- avis.json --against viewer/u41 --threshold 0.1 --max 2           # vs the viewer
 *   npm run pixeldiff -- --catalog <id> --brand superbrugsen --twice                    # deterministic?
 *
 * The reference is a folder of `page-01.png`, `page-02.png`, … — pages
 * this script saved earlier (`--update`: a regression baseline), or
 * captures of the same publication in Tjek's viewer, one page per file.
 * Each comparison writes `diff-NN.png` beside it: the page faded, every
 * differing pixel red.
 *
 * `--twice` renders the avis two times and demands zero differing
 * pixels: the layout is deterministic, and this is where that is proven
 * rather than assumed.
 *
 * Exits 1 when any page differs by more than `--max` percent (default
 * 0.5; with --twice, 0). Renders exactly what the PDF route prints — the
 * chain's saved rules and designs folded in the same way (`chainBrand`).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { CatalogDocument } from '@incitio/schema';
import { getBrand } from '@incitio/brands';
import { diffPngs, renderCataloguePngs } from '@incitio/pdf';
import { chainBrand, readDefaultDesigns, Store } from '@incitio/server';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const has = (name: string) => args.includes(`--${name}`);
const valued = new Set(['catalog', 'brand', 'against', 'threshold', 'max', 'width'].map((n) => `--${n}`));
const file = args.find((a, i) => !a.startsWith('--') && !valued.has(args[i - 1] ?? ''));

const ROOT = new URL('..', import.meta.url);
const assetDir = fileURLToPath(new URL('data', ROOT));
const store = new Store(process.env['INCITIO_DB'] ?? fileURLToPath(new URL('.data/incitio.db', ROOT)));

const document = (() => {
  if (file) return CatalogDocument.parse(JSON.parse(readFileSync(resolve(process.cwd(), file), 'utf8')));
  const id = flag('catalog');
  const brandId = flag('brand');
  if (!id || !brandId) {
    console.error('brug: npm run pixeldiff -- <avis.json> | --catalog <id> --brand <kæde>  (--against <mappe> [--update] | --twice)');
    process.exit(2);
  }
  const found = store.get(brandId, id);
  if (!found) {
    console.error(`ingen avis ${id} hos ${brandId}`);
    process.exit(2);
  }
  return found;
})();

const definition = chainBrand(store, getBrand(document.brandId), readDefaultDesigns(fileURLToPath(new URL('data/designs/', ROOT))));
store.close();

const width = Number(flag('width') ?? 900);
const threshold = Number(flag('threshold') ?? (has('twice') ? 0 : 0.1));
const max = Number(flag('max') ?? (has('twice') ? 0 : 0.5));
const name = (n: number, kind: 'page' | 'diff') => `${kind}-${String(n + 1).padStart(2, '0')}.png`;

const browser = await chromium.launch();
try {
  const render = () => renderCataloguePngs(document, definition.brand, { assetDir, widthPx: width, browser });
  const pages = await render();
  console.log(`${document.name}: ${pages.length} sider gengivet i ${width}px`);

  let references: (Buffer | null)[];
  let out: string | null = null;
  if (has('twice')) {
    references = await render();
  } else {
    const against = flag('against');
    if (!against) throw new Error('sig --against <mappe> eller --twice');
    out = resolve(process.cwd(), against);
    mkdirSync(out, { recursive: true });
    if (has('update')) {
      pages.forEach((png, n) => writeFileSync(join(out!, name(n, 'page')), png));
      console.log(`gemt som reference i ${out}`);
    }
    references = has('update') ? [] : pages.map((_, n) => {
      const path = join(out!, name(n, 'page'));
      return existsSync(path) ? readFileSync(path) : null;
    });
  }

  let failed = 0;
  for (const [n, png] of (has('update') ? [] : pages).entries()) {
    const reference = references[n];
    if (!reference) {
      console.log(`  side ${n + 1}: ingen reference (${name(n, 'page')}) — kør med --update`);
      failed += 1;
      continue;
    }
    const diff = await diffPngs(browser, png, reference, { threshold });
    if (out) writeFileSync(join(out, name(n, 'diff')), diff.diffPng);
    const percent = diff.ratio * 100;
    const over = percent > max;
    if (over) failed += 1;
    console.log(
      `  ${over ? '✗' : '✓'} side ${n + 1}: ${percent.toFixed(3)} % forskellige pixels`
      + ` (${diff.differing} af ${diff.width}×${diff.height})${diff.scaled ? ' · reference skaleret' : ''}`,
    );
  }
  if (!has('update') && references.length > pages.length) console.log(`  referencen har ${references.length - pages.length} sider mere end avisen`);
  if (!has('update')) console.log(failed === 0 ? `ens inden for ${max} %` : `${failed} side(r) over ${max} %`);
  process.exitCode = failed === 0 ? 0 : 1;
} finally {
  await browser.close();
}
