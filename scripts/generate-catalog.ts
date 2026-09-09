/**
 * Generate a catalog end to end and report on it.
 *
 *   npm run generate                 # nemlig, 160 offers, planned by Claude
 *   npm run generate -- --retailer sample
 *   npm run generate -- --no-ai      # deterministic baseline, no API call
 *
 * The point of --no-ai is comparison: run both and diff the reports to see
 * what the model actually bought you over category sorting.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ingestCsv, ingestJson } from '@incitio/ingest';
import { AUTHORED_LIBRARY, generateCatalog, selectOffers } from '@incitio/layout';
import { RETAILERS } from '@incitio/pipeline';
import { planCatalog } from '@incitio/planner';
import { TemplateLibrary, type Offer } from '@incitio/schema';

const ROOT = new URL('..', import.meta.url);
const args = process.argv.slice(2);
const flag = (name: string, fallback = '') => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1]!.startsWith('--') ? args[i + 1]! : fallback;
};
const has = (name: string) => args.includes(`--${name}`);

const retailerId = flag('retailer', 'nemlig');
const retailer = RETAILERS[retailerId];
if (!retailer) {
  console.error(`unknown retailer "${retailerId}". Known: ${Object.keys(RETAILERS).join(', ')}`);
  process.exit(1);
}

const useAi = !has('no-ai');
if (useAi && !process.env['ANTHROPIC_API_KEY']) {
  console.error(
    'ANTHROPIC_API_KEY is not set.\n\n' +
    '  cp .env.example .env      then put your key in .env\n' +
    '  npm run generate          (the script loads .env for you)\n\n' +
    'Or run the deterministic baseline with no key:  npm run generate -- --no-ai',
  );
  process.exit(1);
}

const target = Number(flag('target', process.env['INCITIO_TARGET_OFFERS'] ?? '160'));

// Mined templates when the sidecar has produced them, authored otherwise.
let library = AUTHORED_LIBRARY;
try {
  const mined = TemplateLibrary.parse(
    JSON.parse(readFileSync(fileURLToPath(new URL('data/templates/mined.json', ROOT)), 'utf8')),
  );
  if (mined.templates.length > 0) library = mined;
} catch { /* fall back to the authored set */ }

const feedText = readFileSync(
  fileURLToPath(new URL(`data${retailer.feedPath}`, ROOT)), 'utf8',
);
const { feed, issues } = retailer.feedFormat === 'csv'
  ? ingestCsv(feedText, retailer.mapping)
  : ingestJson(feedText, retailer.mapping);

console.log(`retailer   ${retailer.displayName}`);
console.log(`ingested   ${feed.offers.length} offers, ${issues.length} issues`);
console.log(`templates  ${library.templates.length} (${library.version})`);

const selection = selectOffers(feed.offers, { targetCount: target });
console.log(`selected   ${selection.selected.length} of ${feed.offers.length}`);

const started = Date.now();
let groups;
let reasoning: string[] = [];
let usage;

if (useAi) {
  console.log(`\nplanning with Claude…`);
  const plan = await planCatalog(selection.selected, {
    model: process.env['INCITIO_MODEL'] ?? 'claude-opus-5',
    language: 'Danish',
  });
  if (plan.fellBack) {
    console.error('planner failed — see the warning above. Falling back to categories.');
  } else {
    groups = plan.groups;
    reasoning = plan.reasoning;
    usage = plan.usage;
  }
}

const { document, unplaced } = generateCatalog(selection.selected, {
  id: `${retailer.id}-generated`,
  name: retailer.displayName,
  retailerId: retailer.id,
  theme: retailer.theme,
  pageAspect: retailer.pageAspect,
  library,
  ...(groups ? { groups } : {}),
});

const elapsed = ((Date.now() - started) / 1000).toFixed(1);
console.log(`\npages      ${document.pages.length}`);
console.log(`unplaced   ${unplaced.length}`);
console.log(`planner    ${groups ? 'Claude' : 'category sort (deterministic)'}  ·  ${elapsed}s`);
if (usage) {
  // Opus 5 list price at the time of writing: $5 / $25 per million.
  const cost = (usage.inputTokens * 5 + usage.outputTokens * 25) / 1e6;
  console.log(`tokens     ${usage.inputTokens} in, ${usage.outputTokens} out  ≈ $${cost.toFixed(3)}`);
}

console.log('\nfirst 8 pages');
document.pages.slice(0, 8).forEach((page, i) => {
  const why = reasoning[i] ? `  — ${reasoning[i]}` : '';
  console.log(`  ${String(i + 1).padStart(2)}. ${page.title.padEnd(26)} ${page.placements.length} offers${why}`);
});

// Taken from the selection step: generateCatalog only reports a mix when
// it did the selecting, and here selection already happened above.
console.log('\ncategory mix');
Object.entries(selection.byCategory).sort((a, b) => b[1] - a[1]).slice(0, 8)
  .forEach(([category, n]) => console.log(`  ${category.padEnd(26)} ${n}`));

const outDir = fileURLToPath(new URL('.data/generated', ROOT));
mkdirSync(outDir, { recursive: true });
const outPath = `${outDir}/${retailer.id}-${groups ? 'ai' : 'baseline'}.json`;
writeFileSync(outPath, JSON.stringify(document, null, 2));
console.log(`\nwrote ${outPath}`);
