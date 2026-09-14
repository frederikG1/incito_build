/**
 * Rebuild a published page with this week's products.
 *
 *   npm run match -- --ref .data/reference/superbrugsen/p08.jpg
 *   npm run match -- --ref ~/avis.pdf --page 4 --brand superbrugsen
 *   npm run match -- --ref opslag.png --feed ~/uge38.json --note "mørkere bund"
 *
 * The pipeline itself lives in `@incitio/match` — reference in, grid
 * and casting out, a `CatalogDocument` on the other side. This file is
 * the terminal's way in; the studio's way in is
 * `POST /api/brand/reproduce`, which calls the same function. Keeping
 * one implementation is what stops "rebuild this page" from meaning two
 * different things depending on where you asked.
 *
 * What this adds over the library is the things only a terminal wants:
 * files on disk, a printed grid, and a proof PNG.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, extname, basename } from 'node:path';
import { chromium } from 'playwright';
import { matchPage, MatchError } from '@incitio/match';
import { getBrand, listBrands } from '@incitio/brands';
import { parseLabelDictionary, EMPTY_LABEL_DICTIONARY } from '@incitio/ingest';
import { renderCatalogueHtml, renderCataloguePngs } from '@incitio/pdf';

const ROOT = new URL('..', import.meta.url);
const args = process.argv.slice(2);
const flag = (name: string, fallback = '') => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1]!.startsWith('--') ? args[i + 1]! : fallback;
};

const refArg = flag('ref');
const brandId = flag('brand', 'superbrugsen');
const sourceId = flag('source', 'coop-export');
const feedArg = flag('feed');
const pageNo = Number(flag('page', '1'));
const note = flag('note');
const poolSize = Number(flag('pool', '60'));

if (!refArg) {
  console.error('brug: npm run match -- --ref <billede eller pdf> [--page N] [--brand id] [--feed fil]');
  process.exit(1);
}
if (!process.env['ANTHROPIC_API_KEY']) {
  console.error('ANTHROPIC_API_KEY er ikke sat — læg den i .env');
  process.exit(1);
}

let definition;
try {
  definition = getBrand(brandId);
} catch {
  console.error(`ukendt kæde "${brandId}". Kendte: ${listBrands().map((b) => b.id).join(', ')}`);
  process.exit(1);
}

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, ROOT)), 'utf8');
const expand = (path: string) => resolve(process.cwd(), path.replace(/^~/, process.env['HOME'] ?? '~'));
const refPath = expand(refArg);

console.log(`kæde       ${definition.brand.name} (${brandId})`);
console.log(`reference  ${basename(refPath)}${extname(refPath).toLowerCase() === '.pdf' ? ` side ${pageNo}` : ''}`);

/*
 * The feed, read here rather than inside the library.
 *
 * `@incitio/match` is a library and does not own a filesystem — the
 * server hands it an uploaded string, and so does this. `--feed`
 * overrides; otherwise the chain's own sample is used.
 */
const labels = (() => {
  try {
    return parseLabelDictionary(read('data/labels/tjek-labels.json')).dictionary;
  } catch {
    return EMPTY_LABEL_DICTIONARY;
  }
})();

const source = definition.sources.find((s) => s.id === sourceId) ?? definition.sources[0]!;
const feedText = feedArg ? readFileSync(expand(feedArg), 'utf8') : read(`data${source.path}`);

/* ------------------------------------------------------------- run it */

const browser = await chromium.launch();
process.stdout.write('matcher    …');

try {
  const result = await matchPage(brandId, {
    file: readFileSync(refPath),
    pageNumber: pageNo,
    feedText,
    sourceId: source.id,
    poolSize,
    labels,
    browser,
    referenceName: basename(refPath),
    catalogId: `${brandId}-match`,
    ...(note ? { note } : {}),
  });

  console.log(`\rbundfarve  ${result.ground} (målt i sidens marginer)`);
  console.log(`feed       ${result.offersInFeed} tilbud, ${result.poolSize} med billede i puljen`);
  console.log(`matchede   ${result.casting.length} pladser  ·  ${(result.elapsedMs / 1000).toFixed(1)}s`);
  console.log(
    `tokens     ${result.usage.inputTokens} ind, ${result.usage.outputTokens} ud`
    + `  ≈ $${((result.usage.inputTokens * 5 + result.usage.outputTokens * 25) / 1e6).toFixed(3)}`,
  );
  if (result.rejected > 0) {
    console.log(`           ↳ ${result.rejected} plads(er) uden gyldigt tilbud, udeladt`);
  }

  console.log('\ngitter');
  result.template.areas.forEach((row) => console.log(`  ${row}`));
  const names = new Map(result.document.offers.map((o) => [o.id, o.name]));
  for (const seat of result.casting) {
    const name = names.get(seat.offerId) ?? seat.offerId;
    console.log(`  ${seat.slotId}  ${seat.role.padEnd(9)} ${name.slice(0, 44).padEnd(46)} ${seat.why}`);
  }

  /* --------------------------------------------------------- write it */

  const outDir = fileURLToPath(new URL('.data/out', ROOT));
  mkdirSync(outDir, { recursive: true });
  const stem = `${outDir}/${result.document.id}`;
  const assetDir = fileURLToPath(new URL('data', ROOT));
  const refExt = result.reference.type.split('/')[1];

  writeFileSync(`${stem}.json`, JSON.stringify(result.document, null, 2));
  writeFileSync(`${stem}.html`, renderCatalogueHtml(result.document, result.brand, {
    assetBase: pathToFileURL(`${assetDir}/`).href,
  }));
  writeFileSync(`${stem}-reference.${refExt}`, result.reference.image);
  const shots = await renderCataloguePngs(result.document, result.brand, { assetDir, browser });
  writeFileSync(`${stem}.png`, shots[0]!);

  console.log(`\nskrev      ${stem}.png          (ny side)`);
  console.log(`skrev      ${stem}-reference.${refExt} (det du gav mig)`);
  console.log(`skrev      ${stem}.json`);
} catch (error) {
  console.error(`\n${error instanceof MatchError ? error.message : error}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
