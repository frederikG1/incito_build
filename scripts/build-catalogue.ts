/**
 * Build one chain's leaflet end to end and print it.
 *
 *   npm run build:catalogue -- --brand superbrugsen
 *   npm run build:catalogue -- --brand superbrugsen --offers 8 --pages 2
 *   npm run build:catalogue -- --brand superbrugsen --feed ~/tilbud.json
 *   npm run build:catalogue -- --brand nemlig --no-ai      # no model call
 *   npm run build:catalogue -- --brand netto --brief "læg kød først"
 *
 * The point of --no-ai is comparison: run both and look at the two PDFs
 * to see what curation actually bought you over a category sort.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { defaultSource, getBrand, listBrands } from '@incitio/brands';
import { parseLabelDictionary, EMPTY_LABEL_DICTIONARY } from '@incitio/ingest';
import { buildCatalogue } from '@incitio/pipeline';
import { renderCataloguePdf, renderCataloguePngs, renderCatalogueHtml } from '@incitio/pdf';

const ROOT = new URL('..', import.meta.url);
const args = process.argv.slice(2);
const flag = (name: string, fallback = '') => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1]!.startsWith('--') ? args[i + 1]! : fallback;
};
const has = (name: string) => args.includes(`--${name}`);

const brandId = flag('brand', 'netto');
let definition;
try {
  definition = getBrand(brandId);
} catch {
  console.error(`ukendt kæde "${brandId}". Kendte: ${listBrands().map((b) => b.id).join(', ')}`);
  process.exit(1);
}
const { brand } = definition;

const pages = Number(flag('pages', '6'));
const offers = flag('offers') ? Number(flag('offers')) : undefined;
const sourceId = flag('source');
const feedArg = flag('feed');
const skipCuration = has('no-ai');

if (!skipCuration && !process.env['ANTHROPIC_API_KEY']) {
  console.error(
    'ANTHROPIC_API_KEY er ikke sat.\n\n'
    + '  cp .env.example .env      og læg din nøgle i .env\n'
    + '  npm run build:catalogue   (scriptet indlæser .env selv)\n\n'
    + 'Eller kør uden model:  npm run build:catalogue -- --no-ai',
  );
  process.exit(1);
}

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, ROOT)), 'utf8');

const labels = (() => {
  try {
    return parseLabelDictionary(read('data/labels/tjek-labels.json')).dictionary;
  } catch {
    return EMPTY_LABEL_DICTIONARY;
  }
})();

console.log(`kæde       ${brand.name} (${brand.id})`);
console.log(`skabeloner ${brand.templates.length} egne layouts`);
console.log(`kilder     ${definition.sources.map((s) => s.id).join(', ')}`);

/*
 * A file named on the command line, or the sample this chain ships.
 * Reading an arbitrary path is the point: the whole exercise is that a
 * store hands over a file, and it will not be sitting in the repo.
 */
const feedText = feedArg
  ? readFileSync(resolve(process.cwd(), feedArg.replace(/^~/, process.env['HOME'] ?? '~')), 'utf8')
  : read(`data${defaultSource(definition).path}`);

const started = Date.now();
const result = await buildCatalogue(brandId, feedText, {
  catalogId: `${brand.id}-${skipCuration ? 'baseline' : 'ai'}`,
  maxPages: pages,
  skipCuration,
  labels,
  ...(offers !== undefined ? { offerCount: offers } : {}),
  ...(sourceId ? { sourceId } : {}),
  ...(flag('brief') ? { brief: flag('brief') } : {}),
});
const elapsed = ((Date.now() - started) / 1000).toFixed(1);

console.log(`kilde      ${result.source.reason}`);
console.log(`feed       ${result.offerCount} tilbud, ${result.issues.length} afviste rækker`);
console.log(`udvalgt    ${result.document.offers.length} tilbud på ${result.document.pages.length} sider`);
console.log(`kuratering ${result.curated ? 'Claude' : 'kategorisortering'}  ·  ${elapsed}s`);
if (result.curationError) console.log(`           ↳ ${result.curationError}`);
if (result.usage) {
  // Opus 5 list price at the time of writing: $5 / $25 per million.
  const cost = (result.usage.inputTokens * 5 + result.usage.outputTokens * 25) / 1e6;
  console.log(`tokens     ${result.usage.inputTokens} ind, ${result.usage.outputTokens} ud  ≈ $${cost.toFixed(3)}`);
}
if (result.dropped.length > 0) {
  console.log(`droppet    ${result.dropped.length} tilbud — sidebudgettet var fyldt (--pages hæver det)`);
}
if (result.unknown.length > 0) console.log(`ukendte    ${result.unknown.length} id'er fra planen fandtes ikke`);
if (result.overflow.length > 0) console.log(`overløb    ${result.overflow.length} tilbud manglede en plads`);
for (const swap of result.substitutions) {
  console.log(`  ${swap.pageId}: ${swap.used} i stedet for "${swap.asked}" — ${swap.reason}`);
}

console.log('\nsider');
result.document.pages.forEach((page, i) => {
  const why = page.rationale ? `  — ${page.rationale}` : '';
  console.log(
    `  ${String(i + 1).padStart(2)}. ${page.title.padEnd(24)} `
    + `${String(page.placements.length).padStart(2)} tilbud  ${page.templateId.padEnd(18)}${why}`,
  );
});

const outDir = fileURLToPath(new URL('.data/out', ROOT));
mkdirSync(outDir, { recursive: true });
const stem = `${outDir}/${result.document.id}`;

const assetDir = fileURLToPath(new URL('data', ROOT));

writeFileSync(`${stem}.json`, JSON.stringify(result.document, null, 2));
// The standalone proof lives outside the asset root, so it needs a base
// for the demo feed's root-relative image paths. Hosted feeds carry
// absolute URLs and are unaffected by it.
writeFileSync(`${stem}.html`, renderCatalogueHtml(result.document, brand, {
  assetBase: pathToFileURL(`${assetDir}/`).href,
}));
console.log(`\nskrev      ${stem}.json`);
console.log(`skrev      ${stem}.html`);

if (has('png')) {
  const shots = await renderCataloguePngs(result.document, brand, { assetDir });
  shots.forEach((shot, i) => {
    writeFileSync(`${stem}-p${String(i + 1).padStart(2, '0')}.png`, shot);
  });
  console.log(`skrev      ${shots.length} PNG-korrektur (${stem}-pNN.png)`);
}

if (!has('no-pdf')) {
  process.stdout.write('printer    …');
  const pdf = await renderCataloguePdf(result.document, brand, { assetDir });
  writeFileSync(`${stem}.pdf`, pdf);
  console.log(`\rprintede   ${stem}.pdf  (${(pdf.length / 1024).toFixed(0)} KB)`);
}
