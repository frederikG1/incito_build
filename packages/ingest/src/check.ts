import type { Offer } from '@incitio/schema';
import { normalizeRows, type FieldMapping, type IngestResult } from './mapping.js';
import { EMPTY_LABEL_DICTIONARY, type LabelDictionary } from './labels.js';

/**
 * What a mapping does to a real file, as numbers.
 *
 * The question a person (or Claude) editing a mapping needs answered is
 * not "did it parse" but "what did it lose": which rows fell out and why,
 * which Offer fields came out empty, and which of the file's own columns
 * the mapping never looked at. The last one is where a missed field
 * hides — a feed with `MemberPrice` on every row and a mapping that
 * never reads it produces a valid, quietly wrong catalogue.
 */
export interface MappingReport {
  rows: number;
  offers: number;
  dropped: { reason: string; count: number; offerIds: (string | null)[] }[];
  /** Per Offer field: how many offers carry a real value, and one example. */
  fields: { field: string; filled: number; sample: unknown; sparseBecause: string | null }[];
  /** Per column in the file: how many rows fill it, and whether the mapping read it. */
  columns: { key: string; filled: number; read: boolean; unreadBecause: string | null }[];
  warnings: string[];
}

/** Fields whose default says "the feed did not state it". */
function carries(field: string, value: unknown): boolean {
  if (value === null || value === undefined || value === false || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  if (field === 'category') return value !== 'uncategorised';
  if (field === 'quantity') return (value as Offer['quantity']).size !== null;
  return true;
}

const FIELD_ORDER: (keyof Offer)[] = [
  'id', 'name', 'description', 'brand', 'category', 'price', 'prePrice', 'savings', 'savingsMax',
  'savingsPercent', 'memberPrice', 'priceFrom', 'quantity', 'comparison', 'pack', 'imageUrl',
  'imagePack', 'imageKind', 'campaign', 'labels', 'priority', 'validFrom', 'validTo',
];

/** Fields a printed tile is thin without. Below half filled, say so. */
const EXPECTED: (keyof Offer)[] = ['imageUrl', 'description', 'quantity'];

const filledValue = (value: unknown) => value !== undefined && value !== null && String(value).trim() !== '';

export function checkMapping(
  rows: Record<string, unknown>[],
  mapping: FieldMapping,
  labels: LabelDictionary = EMPTY_LABEL_DICTIONARY,
): MappingReport & { result: IngestResult } {
  const read = new Set<string>();
  const watched = rows.map((row) => new Proxy(row, {
    get(target, key, receiver) {
      if (typeof key === 'string') read.add(key);
      return Reflect.get(target, key, receiver);
    },
  }));
  const result = normalizeRows(watched, mapping, labels);
  const { offers } = result.feed;

  const byReason = new Map<string, (string | null)[]>();
  for (const issue of result.issues) {
    byReason.set(issue.reason, [...(byReason.get(issue.reason) ?? []), issue.offerId]);
  }
  const dropped = [...byReason.entries()]
    .map(([reason, ids]) => ({ reason, count: ids.length, offerIds: ids.slice(0, 5) }))
    .sort((a, b) => b.count - a.count);

  const fields = FIELD_ORDER.map((field) => {
    const withValue = offers.filter((offer) => carries(field, offer[field]));
    return {
      field, filled: withValue.length, sample: withValue[0]?.[field] ?? null,
      sparseBecause: mapping.sparse?.[field] ?? null,
    };
  });

  const keys = new Set<string>();
  for (const row of rows) for (const key of Object.keys(row)) keys.add(key);
  // A key named in a declarative source counts as read even when every
  // row was served by an earlier key in the list.
  for (const source of Object.values(mapping.fields)) {
    if (typeof source === 'string') read.add(source);
    if (Array.isArray(source)) for (const key of source) read.add(key);
  }
  const columns = [...keys].map((key) => ({
    key,
    filled: rows.filter((row) => filledValue(row[key])).length,
    read: read.has(key),
    unreadBecause: mapping.unread?.[key] ?? null,
  }));

  const warnings: string[] = [];
  if (rows.length === 0) warnings.push('no rows found — check extractRows or the record tag');
  const lost = rows.length - offers.length;
  if (rows.length > 0 && lost / rows.length > 0.05) {
    warnings.push(`${lost} of ${rows.length} rows dropped (${Math.round((lost / rows.length) * 100)}%)`);
  }
  for (const field of EXPECTED) {
    if (mapping.sparse?.[field]) continue;
    const entry = fields.find((f) => f.field === field)!;
    if (offers.length > 0 && entry.filled / offers.length < 0.5) {
      warnings.push(`${field} is filled on only ${entry.filled} of ${offers.length} offers`);
    }
  }
  for (const column of columns) {
    if (!column.read && !column.unreadBecause && rows.length > 0 && column.filled / rows.length >= 0.5) {
      warnings.push(`column "${column.key}" is filled on ${column.filled} rows and never read`);
    }
  }

  return { rows: rows.length, offers: offers.length, dropped, fields, columns, warnings, result };
}

/** The report as plain text, for a terminal. */
export function formatReport(report: MappingReport): string {
  const pct = (n: number, of: number) => (of === 0 ? '  -' : `${String(Math.round((n / of) * 100)).padStart(3)}%`);
  const short = (value: unknown) => {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    return text.length > 60 ? `${text.slice(0, 57)}...` : text;
  };
  const lines = [`${report.rows} rows -> ${report.offers} offers`];
  if (report.dropped.length > 0) {
    lines.push('', 'dropped:');
    for (const d of report.dropped) lines.push(`  ${String(d.count).padStart(5)}  ${d.reason}  (${d.offerIds.join(', ')})`);
  }
  lines.push('', 'offer fields:');
  for (const f of report.fields) {
    const why = f.sparseBecause ? `  (sparse: ${f.sparseBecause})` : '';
    lines.push(`  ${f.field.padEnd(15)} ${pct(f.filled, report.offers)}  ${f.filled ? short(f.sample) : ''}${why}`);
  }
  lines.push('', 'file columns:');
  for (const c of report.columns) {
    const why = c.unreadBecause ? `  (unread: ${c.unreadBecause})` : '';
    lines.push(`  ${c.read ? 'read' : '    '}  ${c.key.padEnd(34)} ${pct(c.filled, report.rows)}${why}`);
  }
  if (report.warnings.length > 0) {
    lines.push('', 'warnings:');
    for (const w of report.warnings) lines.push(`  ! ${w}`);
  }
  return lines.join('\n');
}
