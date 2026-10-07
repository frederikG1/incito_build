import type { CatalogDocument } from '@incitio/schema';
import type { Finding } from './findings.js';
import type { Change, Lane } from './approvals.js';
import type { PriceVerdict } from './pricerules.js';
import { count } from './format.js';

/**
 * Godkend as data: what waits for a person, and what may happen next.
 *
 * Pure, so the screen only draws it and the rules — what blocks
 * publishing, what a clean check says — are tested without React.
 */

export interface Bucket {
  key: 'tryk' | 'pris' | 'solgt' | 'ændret';
  title: string;
  /** What was looked at and found in order — the one line a clean check gets. */
  clean: string;
  lines: Line[];
  /** What someone let go — see `CatalogDocument.ignored`. Counts for nothing, shown on request. */
  ignored: Line[];
}

export interface Line { id: string; said: string; finding: Finding }

export interface Signoff {
  /** Checks with something to do, in the order they matter. */
  open: Bucket[];
  /** Checks that found nothing. */
  clean: Bucket[];
  /** Every check with something to list, open or ignored — what the screen draws below the overview. */
  listed: Bucket[];
  waiting: number;
  unsigned: Lane[];
  published: boolean;
  /** Why "Udgiv" is off, or null when it is on. */
  blockedBy: string | null;
}

/** A change, as something `goToFinding` can walk to. */
export function changeFinding(change: Change, document: CatalogDocument): Finding {
  const index = change.pageId ? document.pages.findIndex((page) => page.id === change.pageId) : -1;
  return {
    id: change.id,
    kind: change.kind === 'pris' ? 'pris' : 'plads',
    said: change.said,
    pageId: index >= 0 ? change.pageId : null,
    pageNumber: index >= 0 ? index + 1 : null,
    offerId: change.offerId,
    weight: 'se',
  };
}

/** The tile a "før" price is printed in, as somewhere to go. */
export function verdictFinding(offerId: string, document: CatalogDocument): Finding | null {
  const index = document.pages.findIndex((page) => page.placements.some((p) => p.offerId === offerId));
  if (index < 0) return null;
  return { id: `pris:${offerId}`, kind: 'førpris', said: '', pageId: document.pages[index]!.id, pageNumber: index + 1, offerId, weight: 'se' };
}

export function signoffOf(document: CatalogDocument, findings: Finding[], lanes: Lane[], verdicts: PriceVerdict[]): Signoff {
  const line = (finding: Finding) => ({ id: finding.id, said: finding.said, finding });
  const let_go = new Set(document.ignored ?? []);
  // An ignored print check arrives as 'se' — see `refreshFindings` — and is listed here as let go.
  const print = findings.filter((f) => (f.weight === 'stop' || let_go.has(f.id)) && f.kind !== 'førpris' && f.kind !== 'solgt');
  const stops = print.filter((f) => !let_go.has(f.id));
  const prices = findings.filter((f) => f.kind === 'førpris');
  const sold = findings.filter((f) => f.kind === 'solgt');
  const changed = new Map<string, Change>();
  for (const lane of lanes) for (const change of lane.changes) changed.set(change.id, change);
  const booked = document.bookings?.length ?? 0;

  const buckets: Bucket[] = [
    {
      key: 'tryk', title: 'Skal rettes før tryk',
      clean: print.length > stops.length ? `${count(print.length - stops.length, 'ignoreret', 'ignorerede')}, resten er i orden` : 'Alle sider er tjekket',
      lines: stops.map(line), ignored: print.filter((f) => let_go.has(f.id)).map(line),
    },
    {
      key: 'pris', title: 'Prisregler',
      clean: verdicts.length ? `${count(verdicts.length, 'førpris', 'førpriser')} holder` : 'Ingen førpriser',
      lines: prices.filter((f) => !let_go.has(f.id)).map(line), ignored: prices.filter((f) => let_go.has(f.id)).map(line),
    },
    {
      key: 'solgt', title: 'Solgte pladser',
      clean: booked ? `${count(booked, 'solgt plads', 'solgte pladser')} viser det aftalte` : 'Ingen pladser solgt',
      lines: sold.map(line), ignored: [],
    },
    {
      key: 'ændret', title: 'Ændret efter godkendelse',
      clean: lanes.some((lane) => lane.approval) ? 'Intet ændret siden underskrift' : 'Ingen underskrifter endnu',
      lines: [...changed.values()].map((change) => line(changeFinding(change, document))), ignored: [],
    },
  ];

  const blocking = stops.length + prices.filter((f) => f.weight === 'stop').length + sold.length;
  const unsigned = lanes.filter((lane) => lane.state !== 'godkendt');
  const published = document.status === 'udgivet';
  return {
    open: buckets.filter((bucket) => bucket.lines.length > 0),
    clean: buckets.filter((bucket) => bucket.lines.length === 0),
    listed: buckets.filter((bucket) => bucket.lines.length + bucket.ignored.length > 0),
    waiting: buckets.reduce((total, bucket) => total + bucket.lines.length, 0),
    unsigned,
    published,
    blockedBy: published ? 'Avisen er udgivet'
      : blocking > 0 ? `${blocking} skal rettes først`
        : unsigned.length > 0 ? `Mangler ${unsigned.map((lane) => lane.name.toLowerCase()).join(', ')}`
          : null,
  };
}
