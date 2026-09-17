/**
 * A page whose layout is drawn rather than handed in.
 *
 *   npm run layout -- --brand superbrugsen --cells 6
 *   npm run layout -- --feed ~/uge38.json --note "én stor vare øverst"
 *   npm run layout -- --prompt-only        # see the prompt, call nothing
 *
 * Two models, two jobs. The image model decides what SHAPE the page is;
 * the casting model reads that drawing and decides which product sits in
 * which cell. The drawing is written beside the result so it can be
 * looked at — it is never printed, and nothing on the sheet comes from
 * it but the geometry.
 *
 * Billing warning, unchanged from `npm run decorate`: every image-capable
 * model on the Gemini API is billing-gated, and a free-tier key answers
 * `limit: 0` rather than a smaller quota. `--prompt-only` works without
 * any key at all.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getBrand, listBrands } from '@incitio/brands';
import { imaginePage, layoutPrompt, MatchError } from '@incitio/match';
import { GeminiError } from '@incitio/decor';
import { renderCatalogueHtml, renderCataloguePngs } from '@incitio/pdf';

const ROOT = new URL('..', import.meta.url);
const args = process.argv.slice(2);
const flag = (name: string) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : undefined;
};
const has = (name: string) => args.includes(`--${name}`);

const brandId = flag('brand') ?? listBrands()[0]!.id;
const definition = getBrand(brandId);
const { brand } = definition;
const cells = Number(flag('cells') ?? 6);
const note = flag('note');

const prompt = layoutPrompt({
  cells,
  ground: brand.groundTints?.[0] ?? '',
  ...(note ? { note } : {}),
});

if (has('prompt-only')) {
  console.log(prompt);
  process.exit(0);
}

/*
 * The feed is the chain's shipped sample unless one is named, the same
 * default the studio opens with. A drawn layout with nothing to put in
 * it is a picture, and this repo has a word for those.
 */
const feedPath = flag('feed');
const sample = definition.sources.find((source) => source.path)?.path;
const feedFile = feedPath
  ? resolve(process.cwd(), feedPath)
  : (sample ? fileURLToPath(new URL(`data${sample}`, ROOT)) : null);

if (!feedFile) {
  console.error(`${brand.name} har ingen eksempelfil — angiv --feed <fil>`);
  process.exit(1);
}

try {
  const feedText = readFileSync(feedFile, 'utf8');
  const result = await imaginePage({
    brandId,
    feedText,
    catalogId: `${brandId}-layout`,
    referenceName: 'tegnet layout',
    layout: {
      cells,
      ground: brand.groundTints?.[0] ?? '',
      ...(note ? { note } : {}),
    },
  });

  console.log(`kæde       ${brand.name}`);
  console.log(`tegnet af  ${result.imageModel} på ${(result.drawnInMs / 1000).toFixed(1)}s`);
  console.log(`læst som   ${result.grid.columns}×${result.grid.rows} (${result.grid.source})`);
  console.log(`bund       ${result.ground} — målt i tegningens marginer\n`);

  const names = new Map(result.document.offers.map((offer) => [offer.id, offer.name]));
  for (const seat of result.casting) {
    const name = names.get(seat.offerId) ?? seat.offerId;
    console.log(`  ${seat.slotId}  ${seat.role.padEnd(9)} ${name.slice(0, 44).padEnd(46)} ${seat.why}`);
  }
  if (result.rejected > 0) console.log(`  ↳ ${result.rejected} plads(er) uden gyldigt tilbud`);

  const outDir = fileURLToPath(new URL('.data/out', ROOT));
  mkdirSync(outDir, { recursive: true });
  const stem = `${outDir}/${result.document.id}`;
  const assetDir = fileURLToPath(new URL('data', ROOT));

  writeFileSync(`${stem}.json`, JSON.stringify(result.document, null, 2));
  writeFileSync(`${stem}.html`, renderCatalogueHtml(result.document, result.brand, {
    assetBase: pathToFileURL(`${assetDir}/`).href,
  }));
  // The drawing, written beside the page it shaped. It is scaffolding,
  // and the only way to judge whether it was read right is to see both.
  writeFileSync(`${stem}-drawing.${result.reference.type.split('/')[1]}`, result.reference.image);

  const shots = await renderCataloguePngs(result.document, result.brand, { assetDir });
  shots.forEach((shot, index) => writeFileSync(`${stem}-p${index + 1}.png`, shot));

  console.log(`\nskrev      ${stem}-drawing.*   (tegningen — trykkes ikke)`);
  console.log(`skrev      ${stem}-p1.png       (siden)`);
  console.log(`skrev      ${stem}.json`);
} catch (error) {
  const known = error instanceof MatchError || error instanceof GeminiError;
  console.error(`\n${known ? (error as Error).message : error}`);
  process.exitCode = 1;
}
