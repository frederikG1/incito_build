import type { Offer } from '@incitio/schema';
import { seeded } from './hash.js';
import type { PriceHistory, PriceSource } from './prices.js';

/**
 * The 30-day price history — a STAND-IN.
 *
 * The real one is the chain's price file (the ERP), read by the server.
 * Until it is connected both the studio and the server judge "før"-prices
 * against this, so what the studio warns about is exactly what the server
 * refuses. Every screen that shows it says so — see `DEMO_NOTE` in the
 * studio's `signals.ts`.
 *
 * Shape: the normal price, flat, with one in five products having run a
 * campaign two to three weeks ago — the case the rule exists for.
 */
export const standInPrices: PriceSource = {
  demo: true,
  history(offer: Offer): PriceHistory | null {
    const normal = normalPrice(offer);
    if (normal === null) return null;
    const days = Array.from({ length: 30 }, () => normal);
    if (seeded(`${offer.id}:kampagne`) < 0.2) {
      const campaign = round(offer.price + (normal - offer.price) * (0.25 + seeded(`${offer.id}:dyb`) * 0.5));
      const start = 8 + Math.floor(seeded(`${offer.id}:start`) * 8);
      for (let day = start; day < start + 7 && day < 30; day += 1) days[day] = campaign;
    }
    return { days, lowest: Math.min(...days) };
  },
};

const round = (value: number, to = 0.05) => Math.round(value / to) * to;

/** The price the avis claims the product normally costs — its "før". Null when it claims none. */
export function normalPrice(offer: Offer): number | null {
  // A "spar 20%" banner over a whole range has no price of its own to compare.
  if (offer.price <= 0) return null;
  if (offer.prePrice !== null && offer.prePrice > offer.price) return offer.prePrice;
  if (offer.savings !== null && offer.savings > 0) return round(offer.price + offer.savings, 0.01);
  if (offer.savingsPercent !== null && offer.savingsPercent > 0 && offer.savingsPercent < 100) {
    return round(offer.price / (1 - offer.savingsPercent / 100), 0.01);
  }
  return null;
}
