import { parseCsv } from './csv.js';
import { parseXml, looksXml } from './xml.js';
import { normalizeRows, type FieldMapping, type IngestResult } from './mapping.js';
import type { LabelDictionary } from './labels.js';

export * from './check.js';
export * from './coerce.js';
export * from './csv.js';
export * from './labels.js';
export * from './mapping.js';
export * from './xml.js';

export function ingestCsv(
  text: string,
  mapping: FieldMapping,
  labels?: LabelDictionary,
): IngestResult {
  return normalizeRows(parseCsv(text), mapping, labels);
}

/**
 * Accepts either a bare array of records or an object wrapping one under a
 * common key. Retailer JSON feeds nest their payload under `data`, `feed`,
 * `items` or `offers` about as often as they return a top-level array.
 */
export function ingestJson(
  text: string,
  mapping: FieldMapping,
  labels?: LabelDictionary,
): IngestResult {
  return normalizeRows(feedRows(text, mapping), mapping, labels);
}

export function ingestXml(
  text: string,
  mapping: FieldMapping,
  labels?: LabelDictionary,
): IngestResult {
  return normalizeRows(feedRows(text, mapping, 'xml'), mapping, labels);
}

export type FeedFormat = 'csv' | 'json' | 'xml';

/** What a file is, from its first character and its name. */
export function sniffFormat(text: string, filename = ''): FeedFormat {
  const name = filename.toLowerCase();
  if (name.endsWith('.xml') || looksXml(text)) return 'xml';
  const start = text.trimStart();
  if (name.endsWith('.json') || start.startsWith('{') || start.startsWith('[')) return 'json';
  return 'csv';
}

/**
 * The records in a file, before any mapping — whatever the format.
 *
 * XML and CSV rows go through `extractRows` too when the mapping has one,
 * so a mapping written against a JSON export reads the same feed
 * converted to XML.
 */
export function feedRows(text: string, mapping?: FieldMapping, format: FeedFormat = sniffFormat(text)): Record<string, unknown>[] {
  if (format === 'csv') return parseCsv(text);
  if (format === 'xml') {
    const rows = parseXml(text);
    return mapping?.extractRows ? mapping.extractRows(rows) : rows;
  }
  const parsed: unknown = JSON.parse(text);
  return mapping?.extractRows ? mapping.extractRows(parsed) : extractRows(parsed);
}

/** Any feed file, in any of the three formats. */
export function ingestFeed(
  text: string,
  mapping: FieldMapping,
  labels?: LabelDictionary,
  filename = '',
): IngestResult {
  return normalizeRows(feedRows(text, mapping, sniffFormat(text, filename)), mapping, labels);
}

export function extractRows(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload as Record<string, unknown>[];
  if (payload && typeof payload === 'object') {
    const obj = payload as Record<string, unknown>;
    for (const key of ['offers', 'items', 'products', 'data', 'feed', 'results']) {
      const value = obj[key];
      if (Array.isArray(value)) return value as Record<string, unknown>[];
      // `data.feed` nesting is common enough to be worth one extra hop.
      if (value && typeof value === 'object') {
        const nested = extractRows(value);
        if (nested.length > 0) return nested;
      }
    }
  }
  return [];
}
