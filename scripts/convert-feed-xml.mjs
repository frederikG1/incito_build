/**
 * DataFeedWatch XML -> JSON.
 *
 * Deliberately faithful rather than clever: every element becomes a
 * string field with its original name, and nothing is renamed, coerced or
 * dropped. Semantic mapping is the FieldMapping layer's job
 * (packages/pipeline/src/retailers.ts) — keeping the two apart is what
 * lets a feed's quirks change without touching the catalog engine.
 *
 * Usage: node scripts/convert-feed-xml.mjs <url-or-path> <out.json> [itemTag]
 */
import { writeFileSync, readFileSync } from 'node:fs';

const [, , source, outPath, itemTag = 'product'] = process.argv;
if (!source || !outPath) {
  console.error('usage: convert-feed-xml.mjs <url-or-path> <out.json> [itemTag]');
  process.exit(1);
}

const xml = /^https?:\/\//.test(source)
  ? await (await fetch(source)).text()
  : readFileSync(source, 'utf8');

/**
 * Minimal reader for the flat "record with string children" shape these
 * feeds use. A full XML parser is unnecessary here and would be another
 * dependency; anything nested would need one, so that case throws rather
 * than silently flattening.
 */
function decode(text) {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

const itemRe = new RegExp(`<${itemTag}\\b[^>]*>([\\s\\S]*?)</${itemTag}>`, 'g');
const fieldRe = /<([a-zA-Z0-9:_\-]+)\b[^>]*>([\s\S]*?)<\/\1>/g;

const records = [];
for (const match of xml.matchAll(itemRe)) {
  const body = match[1];
  const record = {};
  for (const field of body.matchAll(fieldRe)) {
    const [, tag, value] = field;
    if (/<[a-zA-Z]/.test(value.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, ''))) {
      throw new Error(`nested XML in <${tag}> — this reader only handles flat records`);
    }
    record[tag] = decode(value);
  }
  records.push(record);
}

if (records.length === 0) {
  console.error(`no <${itemTag}> elements found`);
  process.exit(1);
}

writeFileSync(outPath, JSON.stringify(records, null, 2));

const fields = Object.keys(records[0]);
const filled = (f) => records.filter((r) => r[f]).length;
console.log(`${records.length} records, ${fields.length} fields -> ${outPath}`);
console.log('field fill rates:');
for (const f of fields) console.log(`  ${f.padEnd(34)} ${String(filled(f)).padStart(5)}/${records.length}`);
