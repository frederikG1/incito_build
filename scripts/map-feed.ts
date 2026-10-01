/**
 * Feed file in, Incitio's offer format out. Nothing else runs — no model,
 * no layout, no rendering.
 *
 *   npm run map -- data/feeds/SuperBrugsenW36.json               # JSON to stdout
 *   npm run map -- data/feeds/SuperBrugsenW36.json --check       # what the mapping lost
 *   npm run map -- feed.xml --brand nemlig --out .data/out/nemlig-offers.json
 *   npm run map -- feed.json --brand superbrugsen --source tjek-transformed
 *   npm run map -- data/feeds/SuperBrugsenW36.json --as tjek       # Tjek transformed offers
 *   npm run map -- --list                                        # every mapping
 *
 * The reader is picked the way the studio picks it: by the file's own
 * field names (`resolveSource`). `--brand` narrows the search to one
 * chain; without it every chain is tried and the first chain-specific
 * reader that fits wins. `--check` exits 1 when the report has warnings,
 * so it can gate a change to a mapping.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  checkMapping, feedRows, formatReport, parseLabelDictionary, sniffFormat,
  EMPTY_LABEL_DICTIONARY,
} from '@incitio/ingest';
import {
  brandIds, feedToTjekTransformed, findSource, getBrand, resolveSource, type BrandDefinition, type FeedSource,
} from '@incitio/brands';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const has = (name: string) => args.includes(`--${name}`);
const valued = new Set(['brand', 'source', 'out', 'as'].flatMap((n) => [`--${n}`]));
const path = args.find((a, i) => !a.startsWith('--') && !valued.has(args[i - 1] ?? ''));

const PLATFORM = new Set(['tjek', 'tjek-transformed']);

if (has('list')) {
  for (const id of brandIds()) {
    for (const source of getBrand(id).sources) {
      const tag = PLATFORM.has(source.id) ? ' (platform)' : '';
      console.log(`${id.padEnd(14)} ${source.id.padEnd(18)} ${source.format.padEnd(5)} ${source.name}${tag}${source.path ? `  data${source.path}` : ''}`);
    }
  }
  process.exit(0);
}

if (!path) {
  console.error('usage: npm run map -- <feed.json|.csv|.xml> [--brand id] [--source id] [--as incitio|tjek] [--check] [--out file] | --list');
  process.exit(2);
}

const text = readFileSync(resolve(process.cwd(), path), 'utf8');

function pick(): { definition: BrandDefinition; source: FeedSource; reason: string } {
  const brandId = flag('brand');
  const sourceId = flag('source');
  const candidates = brandId ? [getBrand(brandId)] : brandIds().map(getBrand);
  if (sourceId) {
    for (const definition of candidates) {
      const source = findSource(definition, sourceId);
      if (source) return { definition, source, reason: 'named with --source' };
    }
    throw new Error(`no source "${sourceId}"${brandId ? ` for ${brandId}` : ''} — see --list`);
  }
  const matches = candidates
    .map((definition) => ({ definition, match: resolveSource(definition, text, path!) }))
    .filter((m) => m.match.source !== null);
  const own = matches.find((m) => !PLATFORM.has(m.match.source!.id)) ?? matches[0];
  if (!own) {
    const miss = resolveSource(candidates[0]!, text, path!);
    throw new Error(`no mapping reads this file: ${miss.reason}`);
  }
  return { definition: own.definition, source: own.match.source!, reason: own.match.reason };
}

const { definition, source, reason } = pick();
const labels = (() => {
  try {
    return parseLabelDictionary(readFileSync(new URL('../data/labels/tjek-labels.json', import.meta.url), 'utf8')).dictionary;
  } catch {
    return EMPTY_LABEL_DICTIONARY;
  }
})();

const rows = feedRows(text, source.mapping, sniffFormat(text, path));
const report = checkMapping(rows, source.mapping, labels);
const head = `${definition.brand.id}/${source.id} — ${reason}`;

if (has('check')) {
  console.log(head);
  console.log(formatReport(report));
  process.exit(report.warnings.length > 0 ? 1 : 0);
}

const as = flag('as') ?? 'incitio';
if (as !== 'incitio' && as !== 'tjek') {
  console.error(`--as takes incitio (the default) or tjek, not "${as}"`);
  process.exit(2);
}
// `tjek` is Tjek's transformed-offers format, the rows the publication builder holds.
const json = JSON.stringify(as === 'tjek' ? feedToTjekTransformed(report.result.feed) : report.result.feed, null, 2);
const out = flag('out');
if (out) {
  writeFileSync(resolve(process.cwd(), out), json);
  console.error(`${head}\n${report.rows} rows -> ${report.offers} offers -> ${out}`);
} else {
  process.stdout.write(`${json}\n`);
  console.error(`${head}\n${report.rows} rows -> ${report.offers} offers`);
}
