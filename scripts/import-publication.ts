/**
 * Rebuild a published leaflet from its own link.
 *
 *   npm run publication -- <link> --brand superbrugsen
 *   npm run publication -- <link> --pages 4-9 --no-offers
 *
 * Free and deterministic: the publication states its own grid, so
 * nothing here calls a model and running it twice gives the same pages.
 * That is what separates it from `npm run match`, which is handed a
 * photograph and has to ask.
 *
 * Writes the document, the HTML and one PNG per page to `.data/out/`,
 * the same way every other entry point does, so `npm run render` and
 * `npm run check` pick it up unchanged.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getBrand, listBrands } from '@incitio/brands';
import { importPublication, PublicationError } from '@incitio/publication';
import { renderCatalogueHtml, renderCataloguePngs } from '@incitio/pdf';

const ROOT = new URL('..', import.meta.url);
const args = process.argv.slice(2);
const flag = (name: string) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : undefined;
};
const has = (name: string) => args.includes(`--${name}`);
// The link is the one argument that is a link — simpler and harder to
// get wrong than counting which flags take a value.
const url = args.find((a) => /^https?:\/\//.test(a));

if (!url) {
  console.error('brug: npm run publication -- <link> [--brand <id>] [--pages 1-6] [--no-offers]');
  console.error(`kæder: ${listBrands().map((b) => b.id).join(', ')}`);
  process.exit(1);
}

/** "4", "1-6" or "2,5,9" — the same spelling `npm run match` takes. */
function pageNumbers(spec: string): number[] {
  const out = new Set<number>();
  for (const part of spec.split(',')) {
    const range = /^(\d+)\s*-\s*(\d+)$/.exec(part.trim());
    if (range) {
      for (let n = Number(range[1]); n <= Number(range[2]); n += 1) out.add(n);
    } else if (/^\d+$/.test(part.trim())) {
      out.add(Number(part.trim()));
    }
  }
  return [...out].sort((a, b) => a - b);
}

const brandId = flag('brand') ?? listBrands()[0]!.id;
const { brand } = getBrand(brandId);
const spec = flag('pages');

try {
  const started = Date.now();
  const run = await importPublication(url, {
    brandId,
    catalogId: `${brandId}-publication`,
    name: `Udgivelse ${new Date().toISOString().slice(0, 10)}`,
    withOffers: !has('no-offers'),
    ...(spec ? { pages: pageNumbers(spec) } : {}),
  });

  console.log(`udgivelse  ${run.publication.id} — ${run.publication.pages.length} sider`);
  console.log(`kæde       ${brand.name}`);
  console.log(`læst på    ${((Date.now() - started) / 1000).toFixed(1)}s, uden modelkald\n`);

  for (const reading of run.readings) {
    if (reading.skipped) {
      console.log(`side ${String(reading.number).padStart(2)}  —  ${reading.skipped}`);
      continue;
    }
    console.log(
      `side ${String(reading.number).padStart(2)}  ${reading.columns}×${reading.rows}`
      + `  ${String(reading.offers).padStart(2)} tilbud`
      + `  afvigelse ${(reading.fit * 100).toFixed(1)}%`,
    );
  }

  const outDir = fileURLToPath(new URL('.data/out', ROOT));
  mkdirSync(outDir, { recursive: true });
  const stem = `${outDir}/${run.document.id}`;
  const assetDir = fileURLToPath(new URL('data', ROOT));

  writeFileSync(`${stem}.json`, JSON.stringify(run.document, null, 2));
  writeFileSync(`${stem}.html`, renderCatalogueHtml(run.document, brand, {
    assetBase: pathToFileURL(`${assetDir}/`).href,
  }));

  if (!has('no-png')) {
    const shots = await renderCataloguePngs(run.document, brand, { assetDir });
    shots.forEach((shot, index) => {
      writeFileSync(`${stem}-p${String(index + 1).padStart(2, '0')}.png`, shot);
    });
    console.log(`\nskrev      ${shots.length} PNG-korrektur`);
  }
  console.log(`skrev      ${stem}.json  (${run.document.offers.length} varer)`);
} catch (error) {
  console.error(`\n${error instanceof PublicationError ? error.message : error}`);
  process.exitCode = 1;
}
