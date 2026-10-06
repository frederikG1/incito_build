import type { PriceSource } from '@incitio/workflow';
import type { AuthMode } from './auth.js';

/**
 * What must never reach a retailer: Eksempeltal, and an open door.
 *
 * The studio runs on stand-ins until Tjek's data is wired — a made-up
 * 30-day price history the server JUDGES "før"-prices by (the 30-day
 * lowest-price rule: a price claim checked against invented numbers is
 * a claim nobody checked). That is fine on a laptop and labelled there.
 * In production it is a legal problem, so it is not a warning: the server
 * refuses to start, and says why in a way nobody can scroll past.
 */

/** Production is declared, by either name a host is likely to set. */
export function isProduction(env: Record<string, string | undefined>): boolean {
  return env['INCITIO_ENV'] === 'production' || env['NODE_ENV'] === 'production';
}

/** Every reason this configuration must not serve real chains. Empty: it may. */
export function productionRefusals(config: { prices: PriceSource; auth: AuthMode }): string[] {
  const reasons: string[] = [];
  if (config.prices.demo) {
    reasons.push(
      'Eksempeltal: førpriser dømmes mod en opdigtet 30-dages prishistorik (standInPrices). '
      + 'Giv createApp en rigtig `prices` fra kædens prisfil.',
    );
  }
  if (config.auth !== 'on') {
    reasons.push('Login er slået fra: enhver kan vælge en kæde med en header. Sæt INCITIO_AUTH=on.');
  }
  return reasons;
}

export class ProductionRefused extends Error {
  constructor(readonly reasons: string[]) {
    super([
      '',
      '█'.repeat(72),
      '  INCITIO STARTER IKKE I PRODUKTION',
      '█'.repeat(72),
      ...reasons.map((reason) => `  ✗ ${reason}`),
      '█'.repeat(72),
      '',
    ].join('\n'));
    this.name = 'ProductionRefused';
  }
}

export function assertProductionReady(config: { prices: PriceSource; auth: AuthMode }): void {
  const reasons = productionRefusals(config);
  if (reasons.length > 0) throw new ProductionRefused(reasons);
}
