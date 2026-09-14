/**
 * Add generated mood artwork to a catalogue that has already been built.
 *
 *   npm run decorate -- .data/out/superbrugsen-baseline.json
 *   npm run decorate -- .data/out/superbrugsen-baseline.json --dry
 *   npm run decorate -- .data/out/superbrugsen-baseline.json --offline
 *   npm run decorate -- .data/out/superbrugsen-baseline.json --brief "efterår"
 *   npm run decorate -- .data/out/superbrugsen-baseline.json --style "akvarel"
 *
 * A separate step from `build:catalogue` for the same reason `render` is
 * one: the expensive part is already on disk. Curation decided what is
 * on each page; this decides what is painted behind it, and re-running
 * it must not reshuffle a single offer.
 *
 *   --dry      choose the motifs and print them, generate nothing.
 *              Costs one cheap text call and no image calls.
 *   --offline  use whatever is already in `data/decor`, call no image
 *              model. What CI and a plane run.
 *
 * `--brief` and `--style` go to different models and are not
 * interchangeable: --brief steers WHICH motif each page gets and never
 * leaves the text step; --style is added verbatim to every image prompt
 * and never reaches the text step.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { CatalogDocument } from '@incitio/schema';
import { getBrand } from '@incitio/brands';
import { decorate, chooseSubjects, imagePrompt, decorStore, generateImage, cutout } from '@incitio/decor';

const ROOT = new URL('..', import.meta.url);
const args = process.argv.slice(2);
const has = (name: string) => args.includes(`--${name}`);
const flag = (name: string, fallback = '') => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1]!.startsWith('--') ? args[i + 1]! : fallback;
};
const path = args.find((a) => !a.startsWith('--'));

/*
 * --probe: one motif, one image call, no catalogue.
 *
 * The smallest thing that answers "does image generation work for me
 * yet" — which is a question about a Google billing setting, not about
 * this repository, and therefore worth being able to ask for the price
 * of a single picture rather than a whole book.
 *
 * It runs the REAL path — same prompt builder, same model, same cut-out,
 * same cache — so a probe that succeeds means `npm run decorate` will
 * too, and the artwork it paid for is already in the cache for the run
 * that follows.
 */
const probe = flag('probe');
if (probe) {
  const brandId = flag('brand');
  const probeBrand = brandId ? getBrand(brandId).brand : undefined;
  const prompt = imagePrompt(probe, {
    ...(probeBrand ? { brandName: probeBrand.name } : {}),
    ...(flag('style') ? { style: flag('style') } : {}),
  });
  const store = decorStore(fileURLToPath(new URL('data', ROOT)));
  const out = fileURLToPath(new URL('.data/out/', ROOT));
  mkdirSync(out, { recursive: true });

  console.log(`motiv      ${probe}`);
  console.log(`prompt     ${prompt}`);

  const started = Date.now();
  // A probe's whole job is to report, so a failure here is an ANSWER and
  // is printed as one. A stack trace through the fetch layer says
  // nothing a person testing their billing setup can use.
  const image = await generateImage(prompt, {
    ...(flag('image-model') ? { model: flag('image-model') } : {}),
  }).catch((error: unknown) => {
    console.error(`\nfejl       ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
  console.log(`genereret  ${image.mimeType}, ${(image.bytes.length / 1024).toFixed(0)} kB, ${Date.now() - started} ms`);
  writeFileSync(`${out}probe-raw.png`, image.bytes);

  const browser = await chromium.launch();
  try {
    const cut = await cutout(image.bytes, image.mimeType, { browser });
    const at = store.put(prompt, cut.bytes);
    console.log(
      `udklippet  ${cut.width}×${cut.height}, `
      + `${(100 - cut.kept * 100).toFixed(0)}% baggrund fjernet`,
    );
    // The number worth reading: a model that ignored the white-background
    // instruction leaves nothing to cut, and `decorate` skips such a page
    // rather than printing a photograph with corners on a coloured field.
    if (cut.kept > 0.97) console.log('advarsel   næsten intet blev skåret fra — modellen tegnede ikke på hvid');
    writeFileSync(`${out}probe-cut.png`, cut.bytes);
    console.log(`skrev      .data/out/probe-raw.png  (rå)`);
    console.log(`           .data/out/probe-cut.png  (udklippet, gennemsigtig)`);
    console.log(`           ${at.file.replace(fileURLToPath(ROOT), '')}  (cache)`);
  } finally {
    await browser.close();
  }
  process.exit(0);
}

if (!path) {
  console.error('brug: npm run decorate -- <sti-til-katalog.json> [--dry] [--offline] [--brief "..."] [--style "..."]');
  console.error('      npm run decorate -- --probe "a handful of almonds" [--brand superbrugsen]');
  process.exit(1);
}

const file = resolve(process.cwd(), path);
const document = CatalogDocument.parse(JSON.parse(readFileSync(file, 'utf8')));
const { brand } = getBrand(document.brandId);
const assetRoot = fileURLToPath(new URL('data', ROOT));
const brief = flag('brief');
const style = flag('style');

console.log(`katalog    ${document.name} — ${document.pages.length} sider (${brand.name})`);

/*
 * --dry stops after the editorial decision.
 *
 * That decision is the half worth reading before spending anything: it
 * is where "toiletpapir gets nothing" happens, and seeing the list is
 * how you find out the model disagrees with you before it has drawn six
 * pictures about it.
 */
if (has('dry')) {
  const offers = new Map(document.offers.map((o) => [o.id, o]));
  const store = decorStore(assetRoot);
  const result = await chooseSubjects(
    document.pages.map((page) => ({
      pageId: page.id,
      title: page.title,
      offers: page.placements.map((p) => offers.get(p.offerId)).filter((o) => !!o),
    })),
    brief ? { brief } : {},
  );

  for (const page of result.pages) {
    const title = document.pages.find((p) => p.id === page.pageId)?.title || page.pageId;
    if (!page.subject) {
      console.log(`  ${title.padEnd(22)} — ingen dekoration`);
      continue;
    }
    const prompt = imagePrompt(page.subject.motif, {
      brandName: brand.name,
      ...(style ? { style } : {}),
    });
    const cached = store.has(prompt) ? ' [cache]' : '';
    console.log(`  ${title.padEnd(22)} ${page.subject.subject}${cached}`);
    console.log(`  ${' '.repeat(22)} → ${page.subject.motif}`);
  }
  if (result.usage) {
    console.log(`\nforbrug    ${result.usage.input} ind / ${result.usage.output} ud tokens`);
  }
  process.exit(0);
}

const browser = await chromium.launch();
try {
  const result = await decorate(document, {
    assetRoot,
    brand,
    browser,
    offline: has('offline'),
    ...(brief ? { brief } : {}),
    ...(style ? { style } : {}),
    ...(flag('image-model') ? { imageModel: flag('image-model') } : {}),
  });

  for (const page of result.document.pages) {
    const decor = page.decorations[0];
    const title = page.title || page.id;
    console.log(decor
      ? `  ${title.padEnd(22)} ${decor.subject}  (${decor.anchor})`
      : `  ${title.padEnd(22)} — ingen dekoration`);
  }

  console.log(
    `\ntegnet     ${result.drawn} sider — ${result.cached} fra cache, `
    + `${result.skipped} sider bevidst uden`,
  );
  if (result.usage) {
    console.log(`forbrug    ${result.usage.input} ind / ${result.usage.output} ud tokens (tekst)`);
  }
  for (const error of result.errors) {
    console.error(`fejl       ${error.pageId}: ${error.message}`);
  }

  // Written even when some pages failed: the pages that DID get artwork
  // are worth keeping, and a rerun fills the rest from cache.
  writeFileSync(file, `${JSON.stringify(result.document, null, 2)}\n`);
  console.log(`skrev      ${file}`);

  // A run that drew nothing at all and reported why is a failure the
  // shell should see — this is called from build scripts.
  if (result.drawn === 0 && result.errors.length > 0) process.exit(1);
} finally {
  await browser.close();
}
