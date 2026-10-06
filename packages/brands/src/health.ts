import { checkMapping, feedRows, sniffFormat, EMPTY_LABEL_DICTIONARY, type LabelDictionary } from '@incitio/ingest';
import type { BrandDefinition } from './types.js';
import { resolveSource } from './index.js';

/**
 * One feed file, judged before anything is built from it.
 *
 * The same reading `npm run map -- --check` does, folded into what a
 * person deciding "can we print from this on Thursday" needs: did a
 * reader recognise the file, what did it lose, which offers will print
 * without a picture, and which days the offers cover. Pure — the caller
 * hands over the text, so the CLI, the API and a test judge the same way.
 */
export interface FeedHealth {
  file: string;
  brandId: string;
  /** The reader that recognised the file; null when none did. */
  sourceId: string | null;
  /** Why that reader, or why none. */
  reason: string;
  verdict: 'ok' | 'advarsel' | 'ulæselig';
  rows: number;
  offers: number;
  dropped: { reason: string; count: number }[];
  /** Offers that will print without a product picture. */
  noImage: { count: number; offerIds: string[] };
  /** First and last day any offer is valid, as the feed states them. */
  validity: { from: string | null; to: string | null };
  /** Columns filled in the file that no reader looks at, and no one has said why. */
  unreadColumns: string[];
  warnings: string[];
}

export function feedHealth(
  definition: BrandDefinition,
  text: string,
  file: string,
  labels: LabelDictionary = EMPTY_LABEL_DICTIONARY,
): FeedHealth {
  const empty = {
    file, brandId: definition.brand.id, rows: 0, offers: 0, dropped: [],
    noImage: { count: 0, offerIds: [] }, validity: { from: null, to: null }, unreadColumns: [],
  };
  const match = resolveSource(definition, text, file);
  if (!match.source) {
    return { ...empty, sourceId: null, reason: match.reason, verdict: 'ulæselig', warnings: [match.reason] };
  }
  let report: ReturnType<typeof checkMapping>;
  try {
    report = checkMapping(feedRows(text, match.source.mapping, sniffFormat(text, file)), match.source.mapping, labels);
  } catch (error) {
    const said = `læseren ${match.source.id} fejlede: ${error instanceof Error ? error.message : error}`;
    return { ...empty, sourceId: match.source.id, reason: match.reason, verdict: 'ulæselig', warnings: [said] };
  }
  const offers = report.result.feed.offers;
  const pictureless = offers.filter((offer) => !offer.imageUrl && offer.imagePack.length === 0);
  const days = (key: 'validFrom' | 'validTo') => offers.map((offer) => offer[key]).filter((d): d is string => Boolean(d)).sort();
  const from = days('validFrom');
  const to = days('validTo');
  return {
    file,
    brandId: definition.brand.id,
    sourceId: match.source.id,
    reason: match.reason,
    verdict: report.rows === 0 ? 'ulæselig' : report.warnings.length > 0 ? 'advarsel' : 'ok',
    rows: report.rows,
    offers: report.offers,
    dropped: report.dropped.map(({ reason, count }) => ({ reason, count })),
    noImage: { count: pictureless.length, offerIds: pictureless.slice(0, 10).map((offer) => offer.id) },
    validity: { from: from[0] ?? null, to: to[to.length - 1] ?? null },
    unreadColumns: report.columns
      .filter((column) => !column.read && !column.unreadBecause && column.filled > 0)
      .map((column) => column.key),
    warnings: report.warnings,
  };
}

/** Every chain whose readers recognise the file — the first is the one `map` would pick. */
export function feedHealthAnyBrand(
  definitions: BrandDefinition[],
  text: string,
  file: string,
  labels?: LabelDictionary,
): FeedHealth {
  const judged = definitions.map((definition) => feedHealth(definition, text, file, labels));
  // A chain's own reader beats the platform's shared ones (Tjek's formats every chain can read).
  const own = judged.find((h) => h.sourceId !== null && !PLATFORM.has(h.sourceId));
  return own ?? judged.find((h) => h.sourceId !== null) ?? judged[0]!;
}

const PLATFORM = new Set(['tjek', 'tjek-transformed']);
