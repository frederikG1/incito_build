/**
 * What a model call cost, in kroner.
 *
 * An ESTIMATE, and the word is on screen: the only number that is
 * actually true is the one on the bill at the end of the month. What
 * this can do is stop a run being a mystery — a tile that quietly
 * costs forty times what the one before it did is worth knowing about
 * while you are still iterating, not when the invoice arrives.
 *
 * Two things here go stale and both are meant to be edited: the rates
 * below and the exchange rate. They are in one file, as data, for
 * exactly that reason.
 */

/** Dollars per million tokens, in and out. */
export interface Rate {
  in: number;
  out: number;
}

/**
 * The published list prices, keyed by a fragment of the model id.
 *
 * Longest match wins, so `flash-lite` beats `flash`. A model that
 * matches nothing gets NO price rather than a guessed one — see
 * `priceOf`. A made-up number in kroner is worse than no number,
 * because it looks like it was measured.
 *
 * Checked against the published tiers: Gemini Flash and Flash-Lite,
 * and Anthropic's three sizes. Newer point releases are assumed to
 * sit in their family's tier until somebody confirms otherwise — if
 * a figure below is wrong, this is the one line to change.
 */
export const RATES: { match: string; rate: Rate }[] = [
  { match: 'flash-lite', rate: { in: 0.10, out: 0.40 } },
  { match: 'flash', rate: { in: 0.30, out: 2.50 } },
  { match: 'pro', rate: { in: 1.25, out: 10.00 } },
  { match: 'haiku', rate: { in: 1.00, out: 5.00 } },
  { match: 'sonnet', rate: { in: 3.00, out: 15.00 } },
  { match: 'opus', rate: { in: 5.00, out: 25.00 } },
];

/**
 * Kroner to the dollar.
 *
 * A constant and not a lookup: this is a line under a token count, not
 * an accounting system, and a studio that phoned a currency API to
 * draw it would be worse in every way. The krone is pegged to the euro
 * and the euro moves against the dollar, so this drifts a few per cent
 * a year — which is far inside the error of the estimate it feeds.
 */
export const DKK_PER_USD = 6.9;

/** What this call cost, in kroner, or null if the model is unpriced. */
export function priceOf(
  model: string | null,
  inputTokens: number,
  outputTokens: number,
): number | null {
  if (!model) return null;
  const id = model.toLowerCase();
  // Longest match first, so a lite model is never billed as a full one.
  const found = [...RATES]
    .sort((a, b) => b.match.length - a.match.length)
    .find((entry) => id.includes(entry.match));
  if (!found) return null;
  const usd = (inputTokens * found.rate.in + outputTokens * found.rate.out) / 1e6;
  return usd * DKK_PER_USD;
}

/**
 * The price as a person reads it.
 *
 * Øre below a krone, because a placing call costs a fraction of one
 * and "0,00 kr." says nothing at all. Under an øre it says so in
 * words: the alternative is "0 øre", which reads as free, and it is
 * not free — it is merely cheap.
 */
export function saidPrice(dkk: number): string {
  if (dkk < 0.005) return 'under 1 øre';
  if (dkk < 1) return `≈ ${Math.round(dkk * 100)} øre`;
  return `≈ ${dkk.toFixed(2).replace('.', ',')} kr.`;
}
