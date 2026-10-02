/**
 * Something about an avis that stops it, or is worth a look — the same
 * shape as the studio's `Finding`, so the studio lists these with the
 * rest and the server can refuse a write with the same sentence.
 */
export interface Stop {
  /** Stable for the same fault, so "did this write make a new one" is a set difference. */
  id: string;
  kind: 'førpris' | 'solgt';
  said: string;
  pageId: string | null;
  pageNumber: number | null;
  offerId: string | null;
  weight: 'stop' | 'se';
}

/** The stops in `after` that `before` did not have — what a write introduced. */
export function newStops(before: Stop[], after: Stop[]): Stop[] {
  const had = new Set(before.map((stop) => stop.id));
  return after.filter((stop) => stop.weight === 'stop' && !had.has(stop.id));
}
