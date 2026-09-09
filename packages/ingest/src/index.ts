import { parseCsv } from './csv.js';
import { normalizeRows, type FieldMapping, type IngestResult } from './mapping.js';
import type { LabelDictionary } from './labels.js';

export * from './coerce.js';
export * from './csv.js';
export * from './labels.js';
export * from './mapping.js';

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
  const parsed: unknown = JSON.parse(text);
  const rows = mapping.extractRows ? mapping.extractRows(parsed) : extractRows(parsed);
  return normalizeRows(rows, mapping, labels);
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
