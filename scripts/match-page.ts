/**
 * Rebuild published pages with this week's products.
 *
 *   npm run match -- --ref .data/reference/superbrugsen/p08.jpg
 *   npm run match -- --ref ~/avis.pdf --page 1-6 --brand superbrugsen
 *   npm run match -- --ref p08.jpg --ref p09.jpg --feed ~/uge38.json
 *   npm run match -- --ref opslag.png --note "mørkere bund"
 *
 * `--ref` may be given several times and `--page` takes a range or a
 * list ("4", "1-6", "2,5,9"), so a whole avis is one command. The pages
 * are built one after another and each is told what the ones before it
 * already used, so the same product does not lead four spreads.
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
import { matchPages, MatchError, type MatchReference } from '@incitio/match';
import { getBrand, listBrands } from '@incitio/brands';
import { parseLabelDictionary, EMPTY_LABEL_DICTIONARY } from '@incitio/ingest';
import { renderCatalogueHtml, renderCataloguePngs } from '@incitio/pdf';

const ROOT = new URL('..', import.meta.url);
const args = process.argv.slice(2);
const flag = (name: string, fallback = '') => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1]!.startsWith('--') ? args[i + 1]! : fallback;
};
/** Every occurrence of a repeatable flag, in the order they were typed. */
const flags = (name: string): string[] => args
  .map((arg, i) => (arg === `--${name}` && args[i + 1] && !args[i + 1]!.startsWith('--')
    ? args[i + 1]!
    : null))
  .filter((value): value is string => value !== null);

/**
 * A page spec as the pages it names: "2,5-7" is 2, 5, 6, 7.
 *
 * The same rule the studio's panel uses — see `pageNumbers` in the
 * studio's state. Typed order is kept and duplicates dropped.
 */
function pageNumbers(spec: string): number[] {
  const out: number[] = [];
  for (const chunk of spec.split(',')) {
    const trimmed = chunk.trim();
    const range = /^(\d{1,3})\s*-\s*(\d{1,3})$/.exec(trimmed);
    if (range) {
      const from = Number(range[1]);
      const to = Number(range[2]);
      for (let page = Math.min(from, to); page <= Math.max(from, to); page += 1) out.push(page);
      continue;
    }
    if (/^\d{1,3}$/.test(trimmed)) out.push(Number(trimmed));
  }
  return [...new Set(out.filter((page) => page >= 1 && page <= 400))];
}

const refArgs = flags('ref');
const brandId = flag('brand', 'superbrugsen');
const sourceId = flag('source', 'coop-export');
const feedArg = flag('feed');
const pageSpec = flag('page', '1');
const note = flag('note');
const poolSize = Number(flag('pool', '60'));

if (refArgs.length === 0) {
  console.error('brug: npm run match -- --ref <billede eller pdf> [--ref ...] [--page 1-6] [--brand id] [--feed fil]');
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

/*
 * One reference per page, not per file.
 *
 * `--page` applies to every PDF given — a whole avis is normally one
 * file and one range — and an image is always exactly one page,
 * whatever the range says.
 */
const references: MatchReference[] = refArgs.flatMap((arg) => {
  const path = expand(arg);
  const file = readFileSync(path);
  const name = basename(path);
  if (extname(path).toLowerCase() !== '.pdf' && file.subarray(0, 5).toString('ascii') !== '%PDF-') {
    return [{ file, name }];
  }
  const pages = pageNumbers(pageSpec);
  return (pages.length > 0 ? pages : [1]).map((pageNumber) => ({
    file,
    pageNumber,
    name: `${name} s. ${pageNumber}`,
  }));
});

console.log(`kæde       ${definition.brand.name} (${brandId})`);
console.log(`referencer ${references.map((reference) => reference.name).join(', ')}`);

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

try {
  const run = await matchPages(brandId, {
    references,
    feedText,
    sourceId: source.id,
    poolSize,
    labels,
    browser,
    catalogId: `${brandId}-match`,
    onPage: ({ index, total, name }) => {
      process.stdout.write(`\nmatcher    ${index + 1}/${total}  ${name} …`);
    },
    ...(note ? { note } : {}),
  });

  const usage = run.pages.reduce(
    (sum, page) => ({
      inputTokens: sum.inputTokens + page.usage.inputTokens,
      outputTokens: sum.outputTokens + page.usage.outputTokens,
    }),
    { inputTokens: 0, outputTokens: 0 },
  );
  const seconds = run.pages.reduce((sum, page) => sum + page.elapsedMs, 0) / 1000;

  console.log(`\r\nfeed       ${run.pages[0]!.offersInFeed} tilbud i alt`);
  console.log(`byggede    ${run.pages.length} side(r)  ·  ${seconds.toFixed(1)}s`);
  console.log(
    `tokens     ${usage.inputTokens} ind, ${usage.outputTokens} ud`
    + `  ≈ $${((usage.inputTokens * 5 + usage.outputTokens * 25) / 1e6).toFixed(3)}`,
  );
  for (const failure of run.failures) {
    console.log(`           ↳ ${failure.name}: ${failure.message}`);
  }

  const names = new Map(run.document.offers.map((o) => [o.id, o.name]));
  run.pages.forEach((page, index) => {
    console.log(`\nside ${index + 1}  ${page.document.pages[0]!.title}`);
    console.log(`  bund ${page.ground} (målt i marginerne) · ${page.poolSize} i puljen`);
    page.template.areas.forEach((row) => console.log(`  ${row}`));
    for (const seat of page.casting) {
      const name = names.get(seat.offerId) ?? seat.offerId;
      console.log(`  ${seat.slotId}  ${seat.role.padEnd(9)} ${name.slice(0, 44).padEnd(46)} ${seat.why}`);
    }
    if (page.rejected > 0) {
      console.log(`  ↳ ${page.rejected} plads(er) uden gyldigt tilbud, udeladt`);
    }
  });

  /* --------------------------------------------------------- write it */

  const outDir = fileURLToPath(new URL('.data/out', ROOT));
  mkdirSync(outDir, { recursive: true });
  const stem = `${outDir}/${run.document.id}`;
  const assetDir = fileURLToPath(new URL('data', ROOT));

  writeFileSync(`${stem}.json`, JSON.stringify(run.document, null, 2));
  writeFileSync(`${stem}.html`, renderCatalogueHtml(run.document, run.brand, {
    assetBase: pathToFileURL(`${assetDir}/`).href,
  }));
  run.pages.forEach((page, index) => {
    const ext = page.reference.type.split('/')[1];
    writeFileSync(`${stem}-${index + 1}-reference.${ext}`, page.reference.image);
  });
  const shots = await renderCataloguePngs(run.document, run.brand, { assetDir, browser });
  shots.forEach((shot, index) => writeFileSync(`${stem}-${index + 1}.png`, shot));

  console.log(`\nskrev      ${stem}-N.png           (${shots.length} nye sider)`);
  console.log(`skrev      ${stem}-N-reference.*   (det du gav mig)`);
  console.log(`skrev      ${stem}.json`);
} catch (error) {
  console.error(`\n${error instanceof MatchError ? error.message : error}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
