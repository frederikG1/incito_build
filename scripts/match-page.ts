/**
 * Rebuild a published page with this week's products.
 *
 *   npm run match -- --ref .data/reference/superbrugsen/p08.jpg
 *   npm run match -- --ref ~/avis.pdf --page 4 --brand superbrugsen
 *   npm run match -- --ref opslag.png --feed ~/uge38.json --note "mørkere bund"
 *
 * Hand it one page — a photograph, a screenshot, a page of a PDF — and a
 * feed, and it returns that page's layout carrying the feed's offers.
 *
 * This is deliberately NOT `derive:templates`. That one reads a book to
 * build a chain's vocabulary and then fills the shapes generically,
 * which is why its pages still do not look much like the chain's. Here
 * the reference IS the design brief: the model sees the page and the
 * offers together, and says which offer belongs in which cell and why.
 * Everything that can be measured rather than asked for — the page's
 * ground colour — is measured.
 *
 * What the model returns is still only data: a grid, roles, and an
 * assignment of offer ids to slot ids. No coordinates, no CSS. So the
 * renderer, the editor and the PDF path are untouched.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, extname, basename } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { jsonSchemaOutputFormat } from '@anthropic-ai/sdk/helpers/json-schema';
import { chromium } from 'playwright';
import { Brand, CatalogDocument, PageTemplate, validateTemplate } from '@incitio/schema';
import { defaultSource, findSource, getBrand, listBrands } from '@incitio/brands';
import { parseLabelDictionary, EMPTY_LABEL_DICTIONARY, ingestJson, ingestCsv } from '@incitio/ingest';
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
const refPath = resolve(process.cwd(), refArg.replace(/^~/, process.env['HOME'] ?? '~'));

console.log(`kæde       ${definition.brand.name} (${brandId})`);
console.log(`reference  ${basename(refPath)}${extname(refPath).toLowerCase() === '.pdf' ? ` side ${pageNo}` : ''}`);

/* ----------------------------------------------------------- the page */

const browser = await chromium.launch();

/**
 * The reference as a PNG, whatever it arrived as.
 *
 * A PDF is rendered with pdf.js inside the Chromium this repo already
 * launches for printing, rather than by shelling out: none of
 * pdftoppm, mutool or ghostscript can be assumed present, and the
 * browser is the one dependency that is.
 */
async function rasterise(path: string, page: number): Promise<Buffer> {
  if (extname(path).toLowerCase() !== '.pdf') return readFileSync(path);

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
        body: readFileSync(fileURLToPath(new URL('node_modules/pdfjs-dist/build/pdf.mjs', ROOT))),
        type: 'text/javascript',
      },
      '/pdf.worker.mjs': {
        body: readFileSync(fileURLToPath(new URL('node_modules/pdfjs-dist/build/pdf.worker.mjs', ROOT))),
        type: 'text/javascript',
      },
    };
    await tab.route(`${base}/**`, async (route) => {
      const hit = files[new URL(route.request().url()).pathname];
      if (!hit) return route.fulfill({ status: 404, body: '' });
      return route.fulfill({ status: 200, contentType: hit.type, body: hit.body });
    });

    await tab.goto(`${base}/host.html`, { waitUntil: 'load' });
    const pdfjs = `${base}/pdf.mjs`;
    const worker = `${base}/pdf.worker.mjs`;
    const dataUrl = `data:application/pdf;base64,${readFileSync(path).toString('base64')}`;

    const png = await tab.evaluate(async ({ lib, workerSrc, data, pageNumber }) => {
      /*
       * `new Function` rather than a plain `import(lib)`.
       *
       * This script is run through vite-node, which rewrites every
       * literal `import()` in the module source into its own SSR
       * loader — including the ones inside a string destined for the
       * browser. The page then threw `__vite_ssr_dynamic_import__ is
       * not defined`. Building the call at runtime puts it out of the
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
      if (pageNumber < 1 || pageNumber > doc.numPages) {
        throw new Error(`PDF har ${doc.numPages} sider, ikke side ${pageNumber}`);
      }
      const pdfPage = await doc.getPage(pageNumber);
      // 1400px on the long edge: enough for the model to read a price
      // and a grid, small enough to stay a cheap image block.
      const base = pdfPage.getViewport({ scale: 1 });
      const viewport = pdfPage.getViewport({ scale: 1400 / Math.max(base.width, base.height) });
      const canvas = window.document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      await pdfPage.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      return canvas.toDataURL('image/png').split(',')[1];
    }, { lib: pdfjs, workerSrc: worker, data: dataUrl, pageNumber: page });

    return Buffer.from(png as string, 'base64');
  } finally {
    await tab.close();
  }
}

const refImage = await rasterise(refPath, pageNo);

/**
 * The image's real type, read from its first bytes.
 *
 * `rasterise` returns a PDF page as PNG but hands any other file back
 * untouched, so the buffer's type is whatever the user uploaded. Named
 * from the extension it was: a JPEG declared as `image/png` is rejected
 * by the API with a 400 that names the mismatch, and an upload is
 * exactly where a `.png` holding a JPEG turns up.
 */
function mediaType(buffer: Buffer): 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif' {
  if (buffer[0] === 0x89 && buffer[1] === 0x50) return 'image/png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return 'image/jpeg';
  if (buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (buffer.subarray(0, 3).toString('ascii') === 'GIF') return 'image/gif';
  throw new Error(`${basename(refPath)} er hverken PDF, PNG, JPEG, WebP eller GIF`);
}
const refType = mediaType(refImage);

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
async function sampleGround(image: Buffer, type: string): Promise<string> {
  const tab = await browser.newPage();
  try {
    await tab.goto('about:blank');
    return await tab.evaluate(async (dataUrl) => {
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
      const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0];
      const [r, g, b] = best.split(',').map(Number);
      const hex = (c: number) => Math.min(255, Math.max(0, c)).toString(16).padStart(2, '0');
      return `#${hex(r!)}${hex(g!)}${hex(b!)}`;
    }, `data:${type};base64,${image.toString('base64')}`);
  } finally {
    await tab.close();
  }
}

const ground = await sampleGround(refImage, refType);
console.log(`bundfarve  ${ground} (målt i sidens marginer)`);

/* --------------------------------------------------------------- feed */

const labels = (() => {
  try {
    return parseLabelDictionary(read('data/labels/tjek-labels.json')).dictionary;
  } catch {
    return EMPTY_LABEL_DICTIONARY;
  }
})();

const namedSource = sourceId ? findSource(definition, sourceId) : undefined;
const source = namedSource ?? defaultSource(definition);
const feedText = feedArg
  ? readFileSync(resolve(process.cwd(), feedArg.replace(/^~/, process.env['HOME'] ?? '~')), 'utf8')
  : read(`data${source.path}`);

const { feed } = source.format === 'csv'
  ? ingestCsv(feedText, source.mapping, labels)
  : ingestJson(feedText, source.mapping, labels);

// Only offers with artwork can stand in for a product on a printed page.
const pool = feed.offers.filter((o) => o.imageUrl).slice(0, Math.max(4, poolSize));
console.log(`feed       ${feed.offers.length} tilbud, ${pool.length} med billede i puljen`);

/* -------------------------------------------------------------- model */

const SCHEMA = {
  type: 'object',
  properties: {
    heading: { type: 'string', description: 'Section heading for the NEW page, in Danish, from the offers you chose. Empty string for a page with no masthead.' },
    areas: {
      type: 'array',
      items: { type: 'string' },
      description: 'The reference page\'s grid. One string per row, cell names separated by single spaces, every row the same number of cells.',
    },
    slots: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Lowercase letters/digits, starting with a letter. Must appear in areas.' },
          role: { type: 'string', enum: ['hero', 'feature', 'standard', 'compact'] },
          bleedPercent: { type: 'integer', description: '100 = artwork stays in its cell. 115 = it prints 15% larger and over its neighbours. Only where the reference visibly does this.' },
          offerId: { type: 'string', description: 'The id of the offer that should fill this cell.' },
          why: { type: 'string', description: 'One short clause: what the reference puts here, and why this offer stands in for it.' },
        },
        required: ['id', 'role', 'bleedPercent', 'offerId', 'why'],
        additionalProperties: false,
      },
    },
  },
  required: ['heading', 'areas', 'slots'],
  additionalProperties: false,
} as const;

const SYSTEM = `You rebuild a published retail leaflet page with a different week's products.

You are given one page a chain actually printed, and a list of offers
from a feed. Report the page's grid, then cast the offers into it.

Reading the grid:
- Count the offers on the reference page. Each is one slot. A heading, a
  page number and a chain logo are not offers.
- Find the smallest column count every offer edge lines up with — most
  grocery pages sit on 2, 3, 4 or 6 — and express each offer as the cells
  it occupies. A slot's cells must form a solid rectangle.
- Roles: hero is the page's lead, printed much larger than the rest;
  feature is a band or panel on a coloured field; standard is an ordinary
  offer; compact is a filler, noticeably smaller. A page where every
  offer is the same size has NO hero, and that is a real page — do not
  invent one.
- bleedPercent is 100 unless the artwork visibly prints past its own cell
  and over a neighbour.

Casting the offers — this is the part that decides whether the new page
reads like the old one:
- Match the KIND of thing. If the reference's lead is a big frozen item
  photographed on a tray, pick an offer that will photograph like that.
  A cluster of small packets belongs where the reference has a cluster.
- Match prominence to prominence. The reference gave its lead the page
  because that offer carried the week; give the hero slot the strongest
  offer you were handed, by discount and by weight.
- Match shape to shape. A tall narrow cell wants a tall product — a
  bottle, a carton. A wide cell wants something wide or several things.
- Keep a page coherent. The reference page is about something; the new
  one should be about something too. Offers from one part of the shop
  beat a page of unrelated items, unless the reference itself is mixed.
- Use each offer id at most once, and never invent one.

The heading is for the NEW page and must describe the offers you chose,
in Danish, 1-3 words. Do not copy the reference's own campaign wording —
that is the chain's copy for a different week's products.`;

const client = new Anthropic();
const started = Date.now();

const summarise = (o: typeof pool[number]) => [
  o.id,
  o.brand ? `${o.brand} ${o.name}` : o.name,
  `${o.price} ${o.currency}`,
  o.prePrice ? `was ${o.prePrice}` : '',
  o.category,
  o.description.slice(0, 90),
  o.imagePack.length > 1 ? `${o.imagePack.length} variants` : '',
].filter(Boolean).join(' | ');

process.stdout.write('matcher    …');
const stream = client.messages.stream({
  model: flag('model', 'claude-opus-5'),
  max_tokens: 32000,
  system: SYSTEM,
  thinking: { type: 'adaptive' },
  output_config: { format: jsonSchemaOutputFormat(SCHEMA), effort: 'high' },
  messages: [{
    role: 'user',
    content: [
      { type: 'text', text: `A published ${definition.brand.name} page:` },
      {
        type: 'image',
        source: { type: 'base64', media_type: refType, data: refImage.toString('base64') },
      },
      {
        type: 'text',
        text: [
          `Rebuild this page with these ${pool.length} offers.`,
          'Each line is: id | name | price | previous price | category | fine print | variants',
          '',
          pool.map(summarise).join('\n'),
          ...(note ? ['', `Direction from the editor — follow it unless it breaks the page: ${note}`] : []),
        ].join('\n'),
      },
    ],
  }],
});

const response = await stream.finalMessage();
const elapsed = ((Date.now() - started) / 1000).toFixed(1);
if (!response.parsed_output) {
  console.error('\nmodellen returnerede intet læsbart');
  await browser.close();
  process.exit(1);
}
const plan = response.parsed_output as {
  heading: string;
  areas: string[];
  slots: { id: string; role: string; bleedPercent: number; offerId: string; why: string }[];
};

console.log(`\rmatchede   ${plan.slots.length} pladser  ·  ${elapsed}s`);
console.log(
  `tokens     ${response.usage.input_tokens} ind, ${response.usage.output_tokens} ud`
  + `  ≈ $${((response.usage.input_tokens * 5 + response.usage.output_tokens * 25) / 1e6).toFixed(3)}`,
);

/* ------------------------------------------------------- validate it */

const byId = new Map(pool.map((o) => [o.id, o]));
const used = new Set<string>();
const kept = plan.slots.filter((s) => {
  // An invented or repeated id would render an empty cell, which reads
  // as a broken page rather than as a missing product.
  if (!byId.has(s.offerId) || used.has(s.offerId)) return false;
  used.add(s.offerId);
  return true;
});
if (kept.length < plan.slots.length) {
  console.log(`           ↳ ${plan.slots.length - kept.length} plads(er) uden gyldigt tilbud, udeladt`);
}

const tidy = plan.areas.map((row) => row.trim().replace(/\s+/g, ' '));
const live = new Set(kept.map((s) => s.id));
const template = PageTemplate.parse({
  id: `${brandId}/match-${basename(refPath).replace(/\.[^.]+$/, '')}`,
  name: `Efter ${basename(refPath)}`,
  // A dropped slot must leave the grid too, or `validateTemplate` sees a
  // cell naming nothing and the whole page is refused.
  areas: tidy.map((row) => row.split(' ').map((c) => (live.has(c) ? c : '.')).join(' ')),
  slots: kept.map((s) => ({
    id: s.id,
    role: s.role,
    bleed: Math.min(1.6, Math.max(1, (s.bleedPercent ?? 100) / 100)),
  })),
});

const problems = validateTemplate(template);
if (problems.length > 0) {
  console.error(`\nmodellens gitter holder ikke: ${problems.join('; ')}`);
  await browser.close();
  process.exit(1);
}

console.log('\ngitter');
template.areas.forEach((row) => console.log(`  ${row}`));
for (const s of kept) {
  const offer = byId.get(s.offerId)!;
  console.log(`  ${s.id}  ${s.role.padEnd(9)} ${offer.name.slice(0, 44).padEnd(46)} ${s.why}`);
}

/* ---------------------------------------------------------- render it */

/*
 * The reference's own ground, on this chain's identity.
 *
 * `groundTints` is emptied so the sampled colour is the only field in
 * play: the rotation exists to keep a 40-page book from printing one
 * colour, and this is one page rebuilt from one reference.
 */
const brand = Brand.parse({
  ...definition.brand,
  groundTints: [],
  tokens: { ...definition.brand.tokens, ground },
  templates: [template, ...definition.brand.templates],
});

const now = new Date().toISOString();
const document = CatalogDocument.parse({
  id: `${brandId}-match`,
  schemaVersion: 2,
  name: `${definition.brand.name} efter ${basename(refPath)}`,
  brandId,
  pages: [{
    id: 'page-1',
    templateId: template.id,
    title: plan.heading,
    subtitle: '',
    rationale: `bygget efter ${basename(refPath)}`,
    placements: kept.map((s) => ({ offerId: s.offerId, slotId: s.id, overrides: {} })),
  }],
  offers: kept.map((s) => byId.get(s.offerId)!),
  createdAt: now,
  updatedAt: now,
});

const outDir = fileURLToPath(new URL('.data/out', ROOT));
mkdirSync(outDir, { recursive: true });
const stem = `${outDir}/${document.id}`;
const assetDir = fileURLToPath(new URL('data', ROOT));

writeFileSync(`${stem}.json`, JSON.stringify(document, null, 2));
writeFileSync(`${stem}.html`, renderCatalogueHtml(document, brand, {
  assetBase: pathToFileURL(`${assetDir}/`).href,
}));
writeFileSync(`${stem}-reference.${refType.split('/')[1]}`, refImage);
const shots = await renderCataloguePngs(document, brand, { assetDir, browser });
writeFileSync(`${stem}.png`, shots[0]!);

await browser.close();

console.log(`\nskrev      ${stem}.png          (ny side)`);
console.log(`skrev      ${stem}-reference.${refType.split('/')[1]} (det du gav mig)`);
console.log(`skrev      ${stem}.json`);
