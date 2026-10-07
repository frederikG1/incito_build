import type { CatalogDocument } from '@incitio/schema';
import { priceRuleFindings as rules, standInPrices } from '@incitio/workflow';

/** The price rules — shared with the server, which refuses what these stop. See `@incitio/workflow`. */
export { priceVerdicts, type PriceVerdict } from '@incitio/workflow';

/**
 * The price findings, said as what they are.
 *
 * While the 30-day history is the stand-in (`standInPrices.demo`), a
 * "førpris 69,-, men laveste pris var 57,50" is about a price nobody
 * charged — and it reads exactly like a real one. Each line says so, so
 * nobody changes a printed price, or stops a publish, over invented numbers.
 */
export function priceRuleFindings(document: CatalogDocument | null): ReturnType<typeof rules> {
  const found = rules(document);
  if (!standInPrices.demo) return found;
  return found.map((finding) => finding.kind === 'førpris' ? { ...finding, said: `${finding.said} · Eksempeltal` } : finding);
}
