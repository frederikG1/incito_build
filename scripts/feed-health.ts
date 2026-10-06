/**
 * Every feed, judged before print day.
 *
 *   npm run feed-health                         # every file in data/feeds
 *   npm run feed-health -- uge42.json --brand superbrugsen
 *   npm run feed-health -- --json > health.json  # for a dashboard or CI
 *
 * One line per file: which reader recognised it, how many offers it
 * gives, what it dropped, how many will print without a picture, and the
 * days the offers cover — then the warnings under it. Exits 1 when any
 * file is unreadable or has warnings, so it can gate a mapping change or
 * a scheduled run the morning a chain's feed lands.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brandIds, feedHealth, feedHealthAnyBrand, getBrand, type FeedHealth } from '@incitio/brands';
import { EMPTY_LABEL_DICTIONARY, parseLabelDictionary } from '@incitio/ingest';

const args = process.argv.slice(2);
const brandAt = args.indexOf('--brand');
const brandId = brandAt >= 0 ? args[brandAt + 1] : undefined;
const files = args.filter((arg, i) => !arg.startsWith('--') && i !== brandAt + 1);
const FEEDS = fileURLToPath(new URL('../data/feeds/', import.meta.url));
const paths = files.length > 0
  ? files.map((file) => resolve(process.cwd(), file))
  : readdirSync(FEEDS).filter((file) => /\.(json|csv|xml)$/i.test(file)).sort().map((file) => join(FEEDS, file));

const labels = (() => {
  try {
    return parseLabelDictionary(readFileSync(new URL('../data/labels/tjek-labels.json', import.meta.url), 'utf8')).dictionary;
  } catch {
    return EMPTY_LABEL_DICTIONARY;
  }
})();

const results: FeedHealth[] = paths.map((path) => {
  const text = readFileSync(path, 'utf8');
  return brandId
    ? feedHealth(getBrand(brandId), text, basename(path), labels)
    : feedHealthAnyBrand(brandIds().map(getBrand), text, basename(path), labels);
});

if (args.includes('--json')) {
  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
} else {
  const mark = { ok: '✓', advarsel: '!', ulæselig: '✗' } as const;
  for (const h of results) {
    const lost = h.dropped.reduce((sum, d) => sum + d.count, 0);
    console.log(
      `${mark[h.verdict]} ${h.file.padEnd(36)} ${(h.sourceId ? `${h.brandId}/${h.sourceId}` : '—').padEnd(32)}`
      + ` ${String(h.offers).padStart(4)} tilbud  ${String(lost).padStart(3)} tabt  ${String(h.noImage.count).padStart(3)} uden billede`
      + `  ${h.validity.from ?? '?'} → ${h.validity.to ?? '?'}`,
    );
    for (const warning of h.warnings) console.log(`    ! ${warning}`);
    if (h.unreadColumns.length > 0) console.log(`    · ulæste kolonner: ${h.unreadColumns.join(', ')}`);
  }
}
process.exitCode = results.some((h) => h.verdict !== 'ok') ? 1 : 0;
