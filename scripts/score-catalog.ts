/**
 * Score the catalog currently open in the studio with the quality CNN.
 *
 *   npm run dev:studio          (in another terminal)
 *   npm run score
 *
 * Playwright drives the real studio and screenshots each slot element, so
 * the crops come from the same renderer a person looks at — no second
 * rendering path to drift from it. The crops go to the Keras model trained
 * on 17,588 published tiles, and the verdicts come back per tile and per
 * page.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = new URL('..', import.meta.url);
const args = process.argv.slice(2);
const flag = (name: string, fallback = '') => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1]!.startsWith('--') ? args[i + 1]! : fallback;
};

const studioUrl = flag('url', 'http://localhost:5173');
const retailer = flag('retailer', '');
const library = flag('library', '');
// --capture writes into a named corpus for fine-tuning instead of scoring.
const capture = flag('capture', '');
const scoreAfter = !capture;
const outDir = capture
  ? fileURLToPath(new URL(`.data/generated-tiles/${capture}`, ROOT))
  : fileURLToPath(new URL('.data/scoring', ROOT));

rmSync(outDir, { recursive: true, force: true });
mkdirSync(`${outDir}/tiles`, { recursive: true });

console.log(`opening ${studioUrl}`);
const browser = await chromium.launch();
// A wide viewport keeps pages near their rendered size, so crops are not
// upscaled from a thumbnail before the model sees them.
const page = await browser.newPage({ viewport: { width: 1500, height: 1100 } });

try {
  await page.goto(studioUrl, { waitUntil: 'networkidle', timeout: 60_000 });
} catch {
  console.error(
    `could not reach ${studioUrl}.\n  Start it first:  npm run dev:studio`,
  );
  await browser.close();
  process.exit(1);
}

if (retailer) {
  await page.selectOption('.toolbar__toggle select', retailer).catch(() => {});
  await page.waitForTimeout(4000);
}

// A different template library produces genuinely different tile shapes,
// which is what makes a second capture pass worth running.
if (library) {
  await page.selectOption('.toolbar__toggle:nth-of-type(2) select', library).catch(async () => {
    const selects = page.locator('.toolbar__toggle select');
    await selects.nth(1).selectOption(library).catch(() => {});
  });
  await page.waitForTimeout(4000);
}

await page.waitForSelector('.page', { timeout: 30_000 });

// Product images load lazily; scoring a tile whose artwork has not
// arrived would report an empty tile as a defect.
await page.evaluate(async () => {
  document.querySelectorAll('img').forEach((img) => img.setAttribute('loading', 'eager'));
  window.scrollTo(0, document.body.scrollHeight);
  await new Promise((resolve) => setTimeout(resolve, 1500));
  window.scrollTo(0, 0);
  await Promise.all(
    [...document.images].filter((i) => !i.complete).map(
      (i) => new Promise((r) => { i.onload = r; i.onerror = r; }),
    ),
  );
});
await page.waitForTimeout(1500);

const slots = await page.evaluate(() =>
  [...document.querySelectorAll('.page')].flatMap((pageEl) => {
    const pageId = (pageEl as HTMLElement).dataset['pageId'] ?? '';
    return [...pageEl.querySelectorAll('.page__slot')].map((slotEl) => ({
      pageId,
      slotId: (slotEl as HTMLElement).dataset['slotId'] ?? '',
      offerId: (slotEl as HTMLElement).dataset['offerId'] ?? '',
    }));
  }),
);

console.log(`capturing ${slots.length} tiles across ${new Set(slots.map((s) => s.pageId)).size} pages`);

const manifest: { path: string; pageId: string; slotId: string; offerId: string }[] = [];
for (const [index, slot] of slots.entries()) {
  const selector = `.page[data-page-id="${slot.pageId}"] .page__slot[data-slot-id="${slot.slotId}"]`;
  const locator = page.locator(selector).first();
  const file = `${outDir}/tiles/${String(index).padStart(4, '0')}.jpg`;
  try {
    await locator.screenshot({ path: file, type: 'jpeg', quality: 92 });
  } catch {
    continue; // off-screen or zero-sized; skip rather than fail the run
  }
  manifest.push({ path: file, ...slot });
  if ((index + 1) % 40 === 0) console.log(`  ${index + 1}/${slots.length}`);
}

const manifestPath = `${outDir}/manifest.json`;
writeFileSync(manifestPath, JSON.stringify(manifest));
await browser.close();

if (!scoreAfter) {
  console.log(`\ncaptured ${manifest.length} generated tiles -> ${outDir}/tiles`);
  process.exit(0);
}

console.log(`\nscoring with the CNN…`);
const python = fileURLToPath(new URL('ml/.venv/bin/python', ROOT));
if (!existsSync(python)) {
  console.error('ml/.venv not found — see the ML sidecar section in the README');
  process.exit(1);
}

const scoresPath = `${outDir}/scores.json`;
const result = spawnSync(
  python,
  [fileURLToPath(new URL('ml/score_tiles.py', ROOT)), manifestPath, scoresPath],
  { stdio: 'inherit', cwd: fileURLToPath(new URL('ml', ROOT)) },
);
if (result.status !== 0) process.exit(result.status ?? 1);

const scores = JSON.parse(readFileSync(scoresPath, 'utf8')) as {
  pages: { pageId: string; meanCleanScore: number }[];
};
const mean =
  scores.pages.reduce((sum, p) => sum + p.meanCleanScore, 0) / Math.max(1, scores.pages.length);
console.log(`\ncatalog quality (mean clean score): ${mean.toFixed(3)}`);
console.log(`crops kept in ${outDir}/tiles for inspection`);
