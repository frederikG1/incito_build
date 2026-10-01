import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkMapping, feedRows, ingestFeed, parseLabelDictionary, sniffFormat } from '@incitio/ingest';
import { brandIds, feedToTjekTransformed, getBrand, resolveSource } from '../index.js';

/**
 * Every sample feed in `data/feeds`, through the mapping that claims it.
 *
 * The snapshot is the check report — rows in, offers out, why rows fell
 * out, how full each Offer field is — plus the first offers whole. A
 * change to a mapping shows up here as a diff of exactly what it changed.
 * Update with `npx vitest run -u` once the diff is what you meant.
 */
const DATA = new URL('../../../../data/', import.meta.url);
const labels = parseLabelDictionary(readFileSync(new URL('labels/tjek-labels.json', DATA), 'utf8')).dictionary;

const samples = brandIds().flatMap((id) => getBrand(id).sources
  .filter((source) => source.path)
  .map((source) => ({ brandId: id, source })));

describe('sample feeds', () => {
  it.each(samples.map((s) => [`${s.brandId}/${s.source.id}`, s] as const))('%s', (_, { brandId, source }) => {
    const text = readFileSync(new URL(source.path!.slice(1), DATA), 'utf8');
    // The file is recognised by its own fields as the reader that ships it.
    expect(resolveSource(getBrand(brandId), text, source.path!).source?.id).toBe(source.id);

    const report = checkMapping(feedRows(text, source.mapping, sniffFormat(text, source.path)), source.mapping, labels);
    expect(report.warnings.filter((w) => !w.includes('rows dropped'))).toEqual([]);
    expect({
      rows: report.rows,
      offers: report.offers,
      dropped: report.dropped,
      filled: Object.fromEntries(report.fields.map((f) => [f.field, f.filled])),
      first: report.result.feed.offers.slice(0, 2),
    }).toMatchSnapshot();
  });
});

describe('XML', () => {
  it('reads nemlig\'s DataFeedWatch feed as XML exactly as its JSON conversion', () => {
    const json = readFileSync(new URL('feeds/nemlig.json', DATA), 'utf8');
    const records = (JSON.parse(json) as Record<string, string>[]).slice(0, 50);
    const escape = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const xml = `<?xml version="1.0"?>\n<products>\n${records.map((r) => `<product>${
      Object.entries(r).map(([k, v]) => `<${k}>${escape(String(v))}</${k}>`).join('')
    }</product>`).join('\n')}\n</products>`;

    const nemlig = getBrand('nemlig');
    expect(resolveSource(nemlig, xml, 'feed.xml').source?.id).toBe('datafeedwatch');
    const mapping = nemlig.sources[0]!.mapping;
    expect(ingestFeed(xml, mapping, labels, 'feed.xml').feed)
      .toEqual(ingestFeed(JSON.stringify(records), mapping, labels, 'feed.json').feed);
  });
});

describe('Tjek transformed offers, written', () => {
  it('reads back as the same offers — the export is the reader\'s inverse', () => {
    const superbrugsen = getBrand('superbrugsen');
    const coop = superbrugsen.sources.find((s) => s.id === 'coop-export')!;
    const { feed } = ingestFeed(readFileSync(new URL('feeds/SuperBrugsenW36.json', DATA), 'utf8'), coop.mapping, labels);
    const rows = feedToTjekTransformed(feed);
    const text = JSON.stringify(rows);
    const reader = resolveSource(superbrugsen, text, 'transformed.json');
    expect(reader.source?.id).toBe('tjek-transformed');
    const back = ingestFeed(text, reader.source!.mapping, labels).feed.offers;

    expect(back).toHaveLength(feed.offers.length);
    const keep = (o: typeof feed.offers[number]) => ({
      id: o.id, name: o.name, price: o.price, prePrice: o.prePrice, savings: o.savings, memberPrice: o.memberPrice,
      // Tjek has no "pack" unit: a bare piece count is "piece" there, and prints the same.
      quantity: o.quantity.unit === 'pack' && o.quantity.size === null ? { ...o.quantity, unit: 'pcs' } : o.quantity,
      // The reader reads "Pris" in comment_label_1 as a price word, not a pack — its rule, kept.
      pack: /^(medlemspris|pris)$/i.test(o.pack) ? '' : o.pack, imageUrl: o.imageUrl, imagePack: o.imagePack.length > 1 ? o.imagePack : [],
      validFrom: o.validFrom, validTo: o.validTo,
      marks: o.labels.filter((l) => l.image).map((l) => l.text),
    });
    expect(back.map(keep)).toEqual(feed.offers.map((o) => ({ ...keep(o), imagePack: o.imagePack.length > 1 ? o.imagePack : [] })));
  });
});
