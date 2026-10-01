/**
 * Re-render a catalogue that has already been built.
 *
 *   npm run render -- .data/out/superbrugsen-ai.json
 *   npm run render -- .data/out/superbrugsen-ai.json --no-pdf
 *
 * Curation is the expensive step and its result is a plain document on
 * disk, so iterating on templates or the stylesheet should not cost
 * another model call. This is that loop.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { CatalogDocument, OfferRules, readDesignExport, withOfferGrids } from '@incitio/schema';
import { getBrand } from '@incitio/brands';
import { renderCatalogueHtml, renderCataloguePdf, renderCataloguePngs } from '@incitio/pdf';

const ROOT = new URL('..', import.meta.url);
const args = process.argv.slice(2);
const has = (name: string) => args.includes(`--${name}`);
const path = args.find((a) => !a.startsWith('--'));

if (!path) {
  console.error('brug: npm run render -- <sti-til-katalog.json> [--no-pdf] [--no-png]');
  process.exit(1);
}

const file = resolve(process.cwd(), path);
const document = CatalogDocument.parse(JSON.parse(readFileSync(file, 'utf8')));
// Drawn in the chain's own offer designs when it ships them, as the studio draws it.
const brand = (() => {
  const base = getBrand(document.brandId).brand;
  try {
    const shipped = readDesignExport(readFileSync(fileURLToPath(new URL(`data/designs/${base.id}-cms.json`, ROOT)), 'utf8'));
    return withOfferGrids({
      ...base,
      offerDesigns: shipped.designs,
      designTag: shipped.tag,
      ...(shipped.rules.length > 0 && base.offerRules.length === 0 ? { offerRules: OfferRules.parse(shipped.rules) } : {}),
    });
  } catch {
    return base;
  }
})();

const assetDir = fileURLToPath(new URL('data', ROOT));
const stem = file.replace(/\.json$/, '');

console.log(`katalog    ${document.name} — ${document.pages.length} sider (${brand.name})`);

writeFileSync(`${stem}.html`, renderCatalogueHtml(document, brand, {
  assetBase: pathToFileURL(`${assetDir}/`).href,
}));
console.log(`skrev      ${stem}.html`);

if (!has('no-png')) {
  const shots = await renderCataloguePngs(document, brand, { assetDir });
  shots.forEach((shot, i) => {
    writeFileSync(`${stem}-p${String(i + 1).padStart(2, '0')}.png`, shot);
  });
  console.log(`skrev      ${shots.length} PNG-korrektur`);
}

if (!has('no-pdf')) {
  const pdf = await renderCataloguePdf(document, brand, { assetDir });
  writeFileSync(`${stem}.pdf`, pdf);
  console.log(`printede   ${stem}.pdf  (${(pdf.length / 1024).toFixed(0)} KB)`);
}
