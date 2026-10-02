import type { Finding } from './stop.js';

/**
 * Whether a tile holds more products than its cell has room for — the
 * one rule the tile's dot (`Crowded`) and the checks before print share.
 * `area` is the cell's share of the page as drawn.
 */
export function isCrowded(products: number, area: number): boolean {
  return (products >= 3 && area < 0.13) || (products === 2 && area < 0.07);
}

/** Newest complaints first is wrong here; severity first is what gets fixed. */
export function bySeverity(a: Finding, b: Finding): number {
  if (a.weight !== b.weight) return a.weight === 'stop' ? -1 : 1;
  return (a.pageNumber ?? 99) - (b.pageNumber ?? 99);
}

