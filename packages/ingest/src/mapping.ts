import { Offer, type OfferFeed, type OfferLabelInput } from '@incitio/schema';
import { parsePrice, parseQuantity, parseDate } from './coerce.js';
import { EMPTY_LABEL_DICTIONARY, type LabelDictionary } from './labels.js';

/**
 * Describes where each Offer field lives in one retailer's feed. Adding a
 * new retailer is meant to be a new FieldMapping and nothing else — this
 * is the seam that keeps feed weirdness out of the rest of the system.
 *
 * Each value is a source key, an array of source keys tried in order, or
 * a function for the cases no declarative mapping survives.
 */
export type FieldSource<T> = string | string[] | ((row: Record<string, unknown>) => T | null);

export interface FieldMapping {
  retailerId: string;
  sourceName?: string;
  currency?: string;
  /**
   * How to reach the records inside a JSON payload, when they are not a
   * top-level array or under a conventional key. SuperBrugsen nests them
   * two levels down in `Pages[].Entries[]`, and the page each offer sat on
   * is itself editorial information worth carrying forward.
   */
  extractRows?: (payload: unknown) => Record<string, unknown>[];
  fields: {
    id: FieldSource<string>;
    name: FieldSource<string>;
    description?: FieldSource<string>;
    brand?: FieldSource<string>;
    category?: FieldSource<string>;
    price: FieldSource<number>;
    prePrice?: FieldSource<number>;
    savings?: FieldSource<number>;
    quantity?: FieldSource<string>;
    validFrom: FieldSource<string>;
    validTo: FieldSource<string>;
    imageUrl?: FieldSource<string>;
    priority?: FieldSource<number>;
    /**
     * The dictionary is passed in rather than imported so the package
     * stays free of I/O: whoever loads the JSON decides where it comes
     * from. A mapping that ignores it still works — it is the last
     * argument, and every existing hook simply does not declare it.
     */
    labels?: (
      row: Record<string, unknown>,
      labels: LabelDictionary,
    ) => OfferLabelInput[];
  };
}

function pick<T>(row: Record<string, unknown>, source: FieldSource<T> | undefined): unknown {
  if (source === undefined) return undefined;
  if (typeof source === 'function') return source(row) ?? undefined;
  const keys = Array.isArray(source) ? source : [source];
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

function asString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim();
  return text === '' ? undefined : text;
}

export interface IngestIssue {
  rowIndex: number;
  offerId: string | null;
  reason: string;
}

export interface IngestResult {
  feed: OfferFeed;
  issues: IngestIssue[];
}

/**
 * Rows that fail validation are collected rather than thrown on. A feed of
 * 400 offers with 3 bad rows should still produce a catalog of 397 — an
 * all-or-nothing import is useless against real retailer data.
 */
export function normalizeRows(
  rows: Record<string, unknown>[],
  mapping: FieldMapping,
  labelDictionary: LabelDictionary = EMPTY_LABEL_DICTIONARY,
): IngestResult {
  const offers: OfferFeed['offers'] = [];
  const issues: IngestIssue[] = [];
  const seenIds = new Set<string>();
  const f = mapping.fields;

  rows.forEach((row, rowIndex) => {
    const id = asString(pick(row, f.id));
    const name = asString(pick(row, f.name));
    const price = parsePrice(pick(row, f.price));
    const validFrom = parseDate(pick(row, f.validFrom));
    const validTo = parseDate(pick(row, f.validTo));

    if (!id) {
      issues.push({ rowIndex, offerId: null, reason: 'missing id' });
      return;
    }
    if (seenIds.has(id)) {
      issues.push({ rowIndex, offerId: id, reason: 'duplicate id, row skipped' });
      return;
    }
    if (!name) {
      issues.push({ rowIndex, offerId: id, reason: 'missing name' });
      return;
    }
    if (price === null) {
      issues.push({ rowIndex, offerId: id, reason: 'unparseable price' });
      return;
    }
    if (!validFrom || !validTo) {
      issues.push({ rowIndex, offerId: id, reason: 'missing or unparseable validity dates' });
      return;
    }

    const prePrice = parsePrice(pick(row, f.prePrice));
    let savings = parsePrice(pick(row, f.savings));
    // Feeds often carry one of the two and expect the reader to derive the
    // other; a tile showing "before" without "save" looks unfinished.
    if (savings === null && prePrice !== null && prePrice > price) {
      savings = Math.round((prePrice - price) * 100) / 100;
    }

    const quantity = parseQuantity(pick(row, f.quantity));

    // Unit price is a legal requirement in most retail markets, so it is
    // computed wherever the quantity makes it derivable.
    let comparison: { value: number; unit: 'kg' | 'l' | 'pcs' | 'm' } | null = null;
    if (quantity.size !== null && quantity.size > 0) {
      const total = quantity.size * quantity.pieceCount;
      if (quantity.unit === 'kg') comparison = { value: price / total, unit: 'kg' };
      else if (quantity.unit === 'g') comparison = { value: price / (total / 1000), unit: 'kg' };
      else if (quantity.unit === 'l') comparison = { value: price / total, unit: 'l' };
      else if (quantity.unit === 'ml') comparison = { value: price / (total / 1000), unit: 'l' };
      else if (quantity.unit === 'm') comparison = { value: price / total, unit: 'm' };
    }
    if (comparison) {
      comparison.value = Math.round(comparison.value * 100) / 100;
    }

    const parsed = Offer.safeParse({
      id,
      name,
      description: asString(pick(row, f.description)) ?? '',
      brand: asString(pick(row, f.brand)) ?? '',
      category: asString(pick(row, f.category)) ?? 'uncategorised',
      price,
      prePrice,
      savings,
      currency: mapping.currency ?? 'DKK',
      comparison,
      quantity,
      validFrom,
      validTo,
      imageUrl: asString(pick(row, f.imageUrl)) ?? null,
      labels: f.labels ? f.labels(row, labelDictionary) : [],
      priority: parsePrice(pick(row, f.priority)),
    });

    if (!parsed.success) {
      issues.push({
        rowIndex,
        offerId: id,
        reason: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      });
      return;
    }

    seenIds.add(id);
    offers.push(parsed.data);
  });

  return {
    feed: {
      retailerId: mapping.retailerId,
      sourceName: mapping.sourceName ?? '',
      offers,
    },
    issues,
  };
}
