/**
 * Something about an avis that stops it, or is worth a look — the same
 * shape as the studio's `Finding`, so the studio lists these with the
 * rest and the server can refuse a write with the same sentence.
 */
export interface Finding {
  /** Stable across re-reads, so the list does not reshuffle under the pointer. */
  id: string;
  /** What kind of thing is wrong, for grouping and for the icon. */
  kind: FindingKind;
  /** The sentence the editor reads. Danish, and about the page, not the code. */
  said: string;
  /** Where to go. Null on a finding about the whole book. */
  pageId: string | null;
  pageNumber: number | null;
  /** The tile to select on arrival, when the finding is about one. */
  offerId: string | null;
  /**
   * Whether this stops a print or is worth a look.
   *
   * Two levels and not five. The question the list answers is "can I
   * send this to print", and a scale invites an argument about whether
   * something is a 3 or a 4 instead of answering it.
   */
  weight: 'stop' | 'se';
}

export const FINDING_KINDS = [
  'billede', 'plads', 'tekst', 'pris', 'klynge', 'ark', 'uge', 'skabelon', 'regler', 'skalmed',
  'førpris', 'solgt',
] as const;
export type FindingKind = (typeof FINDING_KINDS)[number];

/** A finding, as the server refuses with one. */
export type Stop = Finding;

/** The stops in `after` that `before` did not have — what a write introduced. */
export function newStops(before: Stop[], after: Stop[]): Stop[] {
  const had = new Set(before.map((stop) => stop.id));
  return after.filter((stop) => stop.weight === 'stop' && !had.has(stop.id));
}
