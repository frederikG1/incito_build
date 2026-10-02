import {
  APPROVAL_ROLE_NAMES,
  type Approval, type ApprovalRole, type ApprovalSeen, type CatalogDocument,
} from '@incitio/schema';
import { fingerprint } from './hash.js';

/**
 * Sign-off, stated as a difference.
 *
 * An avis is approved and then changes thirty times before it prints:
 * a supplier cannot deliver, a price was wrong, a store wants its own
 * offer. Each change used to mean a new proof and a new round of "have
 * you looked at it again?". Here a signature remembers what it saw, and
 * what comes back is only what changed since — so the second look is
 * three lines, not twelve pages.
 *
 * Pure: the snapshot and the difference are plain data, testable and
 * free to compute on every keystroke.
 */

export type ChangeKind = 'pris' | 'vare' | 'flyt' | 'side' | 'udgave' | 'plads';

export const CHANGE_NAMES: Record<ChangeKind, string> = {
  pris: 'Pris',
  vare: 'Vare',
  flyt: 'Flyttet',
  side: 'Side',
  udgave: 'Udgave',
  plads: 'Solgt plads',
};

export interface Change {
  id: string;
  kind: ChangeKind;
  said: string;
  pageId: string | null;
  offerId: string | null;
}

/**
 * Which changes each signature answers for.
 *
 * Marketing signed the whole paper. The buyers signed what is in it and
 * who paid for where. Pricing signed the numbers — and a product that
 * is new to the avis brings numbers nobody has checked.
 */
export const LANE_CARES: Record<ApprovalRole, ChangeKind[]> = {
  marketing: ['pris', 'vare', 'flyt', 'side', 'udgave', 'plads'],
  indkob: ['vare', 'pris', 'plads', 'udgave'],
  pris: ['pris', 'vare'],
};

export const LANE_SAID: Record<ApprovalRole, string> = {
  marketing: 'Hele avisen: sider, rækkefølge, udgaver',
  indkob: 'Varerne, solgte pladser og butikkernes udgaver',
  pris: 'Priser, førpriser og spar-beløb',
};

/** The few facts a change can be stated in. */
export function seenOf(document: CatalogDocument): ApprovalSeen {
  const offers: ApprovalSeen['offers'] = {};
  for (const offer of document.offers) {
    offers[offer.id] = [offer.name, offer.price, offer.prePrice, offer.memberPrice, offer.savings];
  }
  const editions: ApprovalSeen['editions'] = {};
  for (const variant of document.variants ?? []) {
    editions[variant.id] = [variant.name, variant.ops.length + variant.offers.length, editionPrint(variant)];
  }
  const bookings: ApprovalSeen['bookings'] = {};
  for (const booking of document.bookings ?? []) {
    bookings[booking.id] = [booking.pageId, booking.slotId, booking.offerId ?? '', booking.supplier].join('/');
  }
  return {
    pages: document.pages.map((page) => ({
      id: page.id,
      title: page.title,
      templateId: page.templateId,
      slots: page.placements.map((placement) => [placement.slotId, placement.offerId] as [string, string]),
    })),
    offers,
    editions,
    bookings,
  };
}

/** What an edition says, as one short string: two editions with the same edits print the same. */
function editionPrint(variant: NonNullable<CatalogDocument['variants']>[number]): string {
  return fingerprint(JSON.stringify([variant.ops, variant.offers, variant.stores]));
}

const kr = (value: number | null) => (value === null
  ? '–'
  : Number.isInteger(value) ? `${value},-` : value.toFixed(2).replace('.', ','));

/** Everything that differs between what was signed and what is there now. */
export function changesSince(seen: ApprovalSeen, document: CatalogDocument): Change[] {
  const changes: Change[] = [];
  const nameOf = (id: string) => document.offers.find((offer) => offer.id === id)?.name ?? seen.offers[id]?.[0] ?? 'en vare';
  const numberNow = new Map(document.pages.map((page, index) => [page.id, index + 1]));
  const numberThen = new Map(seen.pages.map((page, index) => [page.id, index + 1]));

  // Where each product stood, then and now.
  const whereThen = new Map<string, { pageId: string; slotId: string }>();
  for (const page of seen.pages) for (const [slotId, offerId] of page.slots) whereThen.set(offerId, { pageId: page.id, slotId });
  const whereNow = new Map<string, { pageId: string; slotId: string }>();
  for (const page of document.pages) for (const p of page.placements) whereNow.set(p.offerId, { pageId: page.id, slotId: p.slotId });

  /* Pages: added, removed, moved, renamed, re-laid. */
  for (const page of document.pages) {
    const then = seen.pages.find((entry) => entry.id === page.id);
    const n = numberNow.get(page.id)!;
    if (!then) {
      changes.push({ id: `side+${page.id}`, kind: 'side', said: `Side ${n} er ny${page.title ? ` — «${page.title}»` : ''}`, pageId: page.id, offerId: null });
      continue;
    }
    if (then.title !== page.title) {
      changes.push({ id: `titel:${page.id}`, kind: 'side', said: `Side ${n}: overskrift «${then.title || 'ingen'}» → «${page.title || 'ingen'}»`, pageId: page.id, offerId: null });
    }
    if (then.templateId !== page.templateId) {
      changes.push({ id: `layout:${page.id}`, kind: 'side', said: `Side ${n} har fået et andet layout`, pageId: page.id, offerId: null });
    }
  }
  for (const then of seen.pages) {
    if (!numberNow.has(then.id)) {
      changes.push({ id: `side-${then.id}`, kind: 'side', said: `Side ${numberThen.get(then.id)}${then.title ? ` «${then.title}»` : ''} er taget ud`, pageId: null, offerId: null });
    }
  }
  // Order, only among pages both have — an added page moves everything after it, and that is not news.
  const kept = document.pages.filter((page) => numberThen.has(page.id)).map((page) => page.id);
  const keptThen = seen.pages.filter((page) => numberNow.has(page.id)).map((page) => page.id);
  if (kept.join() !== keptThen.join()) {
    changes.push({ id: 'rækkefølge', kind: 'side', said: 'Siderne står i en anden rækkefølge', pageId: null, offerId: null });
  }

  /* Products: in, out, moved. */
  for (const [offerId, now] of whereNow) {
    const then = whereThen.get(offerId);
    const n = numberNow.get(now.pageId);
    if (!then) {
      changes.push({ id: `ind:${offerId}`, kind: 'vare', said: `Side ${n}: ${nameOf(offerId)} er kommet med`, pageId: now.pageId, offerId });
    } else if (then.pageId !== now.pageId) {
      changes.push({
        id: `flyt:${offerId}`, kind: 'flyt',
        said: `${nameOf(offerId)} er flyttet fra side ${numberThen.get(then.pageId)} til side ${n}`,
        pageId: now.pageId, offerId,
      });
    } else if (then.slotId !== now.slotId) {
      changes.push({ id: `flyt:${offerId}`, kind: 'flyt', said: `Side ${n}: ${nameOf(offerId)} står på en anden plads`, pageId: now.pageId, offerId });
    }
  }
  for (const [offerId, then] of whereThen) {
    if (whereNow.has(offerId)) continue;
    const page = numberNow.has(then.pageId) ? then.pageId : null;
    changes.push({
      id: `ud:${offerId}`, kind: 'vare',
      said: `${nameOf(offerId)} er taget af side ${numberThen.get(then.pageId)}`,
      pageId: page, offerId: null,
    });
  }

  /* Prices, on what is on a page now. */
  for (const offer of document.offers) {
    const then = seen.offers[offer.id];
    const where = whereNow.get(offer.id);
    if (!then || !where) continue;
    const [, price, prePrice, memberPrice, ...rest] = then;
    const n = numberNow.get(where.pageId);
    if (price !== offer.price) {
      changes.push({ id: `pris:${offer.id}`, kind: 'pris', said: `Side ${n}: ${offer.name} ${kr(price)} → ${kr(offer.price)}`, pageId: where.pageId, offerId: offer.id });
    }
    if (prePrice !== offer.prePrice) {
      changes.push({ id: `før:${offer.id}`, kind: 'pris', said: `Side ${n}: ${offer.name} førpris ${kr(prePrice)} → ${kr(offer.prePrice)}`, pageId: where.pageId, offerId: offer.id });
    }
    if (memberPrice !== offer.memberPrice) {
      changes.push({ id: `medlem:${offer.id}`, kind: 'pris', said: `Side ${n}: ${offer.name} medlemspris ${kr(memberPrice)} → ${kr(offer.memberPrice)}`, pageId: where.pageId, offerId: offer.id });
    }
    // Kept since signatures carried it; an older one says nothing about "spar".
    if (rest.length > 0 && (rest[0] ?? null) !== offer.savings) {
      changes.push({ id: `spar:${offer.id}`, kind: 'pris', said: `Side ${n}: ${offer.name} spar ${kr(rest[0] ?? null)} → ${kr(offer.savings)}`, pageId: where.pageId, offerId: offer.id });
    }
  }

  /* Editions. */
  const editions = new Map((document.variants ?? []).map((variant) => [variant.id, variant]));
  for (const [id, variant] of editions) {
    const then = seen.editions[id];
    const now = variant.ops.length + variant.offers.length;
    const [, count, print] = then ?? [];
    if (!then) changes.push({ id: `udgave+${id}`, kind: 'udgave', said: `Udgaven ${variant.name} er ny`, pageId: null, offerId: null });
    else if (count !== now) changes.push({ id: `udgave:${id}`, kind: 'udgave', said: `Udgaven ${variant.name} er rettet (${count} → ${now} ændringer)`, pageId: null, offerId: null });
    // Same number of edits, other edits: a store swapped one offer for another.
    else if (print !== undefined && print !== editionPrint(variant)) changes.push({ id: `udgave:${id}`, kind: 'udgave', said: `Udgaven ${variant.name} er rettet`, pageId: null, offerId: null });
  }
  for (const [id, [name]] of Object.entries(seen.editions)) {
    if (!editions.has(id)) changes.push({ id: `udgave-${id}`, kind: 'udgave', said: `Udgaven ${name} er slettet`, pageId: null, offerId: null });
  }

  /* Sold places. */
  const bookings = new Map((document.bookings ?? []).map((booking) => [booking.id, booking]));
  for (const [id, booking] of bookings) {
    if (seen.bookings[id] === undefined) {
      changes.push({ id: `solgt+${id}`, kind: 'plads', said: `Side ${numberNow.get(booking.pageId) ?? '?'}: plads solgt til ${booking.supplier}`, pageId: booking.pageId, offerId: booking.offerId });
    }
  }
  for (const [id, said] of Object.entries(seen.bookings)) {
    if (!bookings.has(id)) changes.push({ id: `solgt-${id}`, kind: 'plads', said: `Solgt plads frigivet (${said.split('/')[3]})`, pageId: null, offerId: null });
  }

  return changes;
}

export interface Lane {
  role: ApprovalRole;
  name: string;
  approval: Approval | null;
  /** Changes since this lane signed that it answers for. Empty with no approval. */
  changes: Change[];
  state: 'mangler' | 'godkendt' | 'forældet';
}

export function lanesOf(document: CatalogDocument): Lane[] {
  return (Object.keys(LANE_CARES) as ApprovalRole[]).map((role) => {
    const approval = (document.approvals ?? []).find((entry) => entry.role === role) ?? null;
    const changes = approval
      ? changesSince(approval.seen, document).filter((change) => LANE_CARES[role].includes(change.kind))
      : [];
    return {
      role,
      name: APPROVAL_ROLE_NAMES[role],
      approval,
      changes,
      state: !approval ? 'mangler' : changes.length > 0 ? 'forældet' : 'godkendt',
    };
  });
}

/** The roles whose signature still holds: signed, and nothing they answer for changed since. */
export function standingApprovals(document: CatalogDocument): ApprovalRole[] {
  return lanesOf(document).filter((lane) => lane.state === 'godkendt').map((lane) => lane.role);
}

/**
 * The document with this role's signature on what it is now.
 *
 * The server's to call — it signs what it holds, not what a screen
 * shows — and it fills in `version` once the signature is saved.
 */
export function signed(document: CatalogDocument, role: ApprovalRole, who: string, at: string, version?: number): CatalogDocument {
  const others = (document.approvals ?? []).filter((entry) => entry.role !== role);
  return { ...document, approvals: [...others, { role, who, at, seen: seenOf(document), ...(version ? { version } : {}) }] };
}

/** The document with this role's signature taken back. */
export function unsigned(document: CatalogDocument, role: ApprovalRole): CatalogDocument {
  return { ...document, approvals: (document.approvals ?? []).filter((entry) => entry.role !== role) };
}

/**
 * How much of the avis stands where it stood last week.
 *
 * Readers find their way by habit — the meat on page four, the beer at
 * the back — so a week that moves everything costs them, even when each
 * move was an improvement. Counted by page: same position, same kind
 * of page (its title, else its layout).
 */
export function familiarity(previous: CatalogDocument, current: CatalogDocument): { same: number; of: number } {
  const of = current.pages.length;
  let same = 0;
  current.pages.forEach((page, index) => {
    const then = previous.pages[index];
    if (!then) return;
    const key = (p: typeof page) => (p.title ? p.title.toLowerCase().trim() : `#${p.templateId}`);
    if (key(then) === key(page)) same += 1;
  });
  return { same, of };
}
