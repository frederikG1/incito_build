import {
  partOverride, TEXT_PARTS, TILE_PARTS,
  type Brand, type CatalogDocument, type EditOp, type Offer, type PublicationVariant,
} from '@incitio/schema';
import { applyOps, EditError } from './apply.js';

/**
 * Local editions: a base publication and, per store, a short list of ops.
 *
 * `resolveVariant` works an edition out of the current base; `diffToOps`
 * goes the other way, turning whatever somebody did to an edition in the
 * studio into the ops that reproduce it — so staff edit Holbæk's pages
 * like any pages, and what is stored is "add 262023 to section 14", not a
 * nineteenth copy of the book.
 */

export interface ResolvedVariant {
  document: CatalogDocument;
  variant: PublicationVariant;
  applied: string[];
  /** Ops that no longer apply to the base — "its offer left the base" — by number. */
  conflicts: string[];
}

const withOffers = (document: CatalogDocument, extra: Offer[]): CatalogDocument => {
  const have = new Set(document.offers.map((o) => o.id));
  return { ...document, offers: [...document.offers, ...extra.filter((o) => !have.has(o.id))] };
};

export function findVariant(document: CatalogDocument, variantId: string): PublicationVariant | undefined {
  return (document.variants ?? []).find((v) => v.id === variantId);
}

/**
 * One edition, from the base as it stands now.
 *
 * Op by op rather than all at once: a variant is long-lived and the base
 * moves under it, so one stale op must not take the whole edition down.
 * It is skipped and named in `conflicts`, which the studio shows.
 */
export function resolveVariant(base: CatalogDocument, variantId: string, brand: Brand): ResolvedVariant {
  const variant = findVariant(base, variantId);
  if (!variant) throw new Error(`no variant "${variantId}"`);
  let document: CatalogDocument = { ...withOffers(base, variant.offers), name: `${base.name} — ${variant.name}` };
  delete document.variants;
  const applied: string[] = [];
  const conflicts: string[] = [];
  variant.ops.forEach((op, index) => {
    try {
      const result = applyOps(document, [op], brand);
      document = result.document;
      applied.push(...result.applied);
    } catch (error) {
      const reason = error instanceof EditError ? error.message.replace(/^op 1: /, '') : String(error);
      conflicts.push(`${index + 1}. ${op.op}${'offerId' in op ? ` ${op.offerId}` : ''}: ${reason}`);
    }
  });
  return { document, variant, applied, conflicts };
}

export interface DiffResult {
  ops: EditOp[];
  /** Differences the vocabulary cannot say — a page added, a decoration moved. Named, not lost silently. */
  unrepresented: string[];
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function positions(document: CatalogDocument): Map<string, string> {
  const at = new Map<string, string>();
  for (const page of document.pages) for (const p of page.placements) at.set(p.offerId, `${page.id}\u0000${p.slotId}`);
  return at;
}

/**
 * The ops that turn `before` into `after`.
 *
 * In phases, each applied to a working copy before the next is worked
 * out, so every op is computed against the page it will actually meet:
 * layouts and page order first (they re-slot offers), then where each
 * offer stands, then each tile's corrections, then prices and headings.
 * Replaying the result on `before` reproduces `after` in everything the
 * ops can express; the rest is listed in `unrepresented`.
 */
export function diffToOps(before: CatalogDocument, after: CatalogDocument, brand: Brand): DiffResult {
  const ops: EditOp[] = [];
  const unrepresented: string[] = [];
  let work = before;
  const run = (op: EditOp) => {
    try {
      work = applyOps(work, [op], brand).document;
      ops.push(op);
    } catch (error) {
      unrepresented.push(`${op.op}: ${error instanceof Error ? error.message.replace(/^op 1: /, '') : String(error)}`);
    }
  };

  const beforeIds = new Set(before.pages.map((p) => p.id));
  const afterIds = new Set(after.pages.map((p) => p.id));
  for (const page of after.pages) if (!beforeIds.has(page.id)) unrepresented.push(`page ${page.id} was added`);
  // A page left out first: what is on it goes to reserve, and the rest is diffed against what remains.
  for (const page of before.pages) if (!afterIds.has(page.id)) run({ op: 'removePage', pageId: page.id });

  // 1. Layouts and page order.
  for (const page of after.pages) {
    const was = work.pages.find((p) => p.id === page.id);
    if (was && was.templateId !== page.templateId) run({ op: 'layout', pageId: page.id, templateId: page.templateId });
  }
  // Page order is only compared when every page left has a counterpart.
  if ([...afterIds].every((id) => beforeIds.has(id))) {
    after.pages.forEach((page, index) => {
      if (work.pages[index]?.id !== page.id) run({ op: 'movePage', pageId: page.id, to: index });
    });
  }

  // 2. Where each offer stands.
  for (const page of after.pages) {
    if (!beforeIds.has(page.id)) continue;
    for (const placement of page.placements) {
      const want = `${page.id}\u0000${placement.slotId}`;
      if (positions(work).get(placement.offerId) !== want) {
        run({ op: 'place', offerId: placement.offerId, pageId: page.id, slotId: placement.slotId });
      }
    }
  }
  const placedAfter = positions(after);
  for (const offerId of positions(work).keys()) {
    if (!placedAfter.has(offerId)) run({ op: 'remove', offerId });
  }

  // 3. Each tile's corrections.
  for (const page of after.pages) {
    for (const placement of page.placements) {
      const current = work.pages.flatMap((p) => p.placements).find((p) => p.offerId === placement.offerId);
      if (!current) continue;
      const o = placement.overrides;
      const w = current.overrides;
      const id = placement.offerId;
      if (o.displayName !== w.displayName) run({ op: 'text', offerId: id, part: 'name', text: o.displayName });
      if (o.description !== w.description) run({ op: 'text', offerId: id, part: 'description', text: o.description });
      if (o.arrangement !== w.arrangement) run({ op: 'arrange', offerId: id, arrangement: o.arrangement });
      if (o.pinned !== w.pinned) run({ op: 'pin', offerId: id, pinned: o.pinned });
      for (const part of TILE_PARTS) {
        const a = partOverride(o, part);
        const b = partOverride(w, part);
        if (a.offsetX !== b.offsetX || a.offsetY !== b.offsetY || a.scale !== b.scale || a.hidden !== b.hidden) {
          run({
            op: 'part', offerId: id, part,
            offsetX: a.offsetX, offsetY: a.offsetY, scale: a.scale,
            ...(part === 'media' ? {} : { hidden: a.hidden }),
          });
        }
        if (a.text !== b.text) {
          if ((TEXT_PARTS as readonly string[]).includes(part)) {
            run({ op: 'text', offerId: id, part: part as (typeof TEXT_PARTS)[number], text: a.text });
          } else {
            unrepresented.push(`wording of ${part} on ${id}`);
          }
        }
      }
      if (!same(o.pack, w.pack)) unrepresented.push(`product positions inside ${id}`);
    }
  }

  // 4. Prices and headings.
  const beforeOffers = new Map(work.offers.map((o) => [o.id, o]));
  for (const offer of after.offers) {
    const was = beforeOffers.get(offer.id);
    if (was && (was.price !== offer.price || was.prePrice !== offer.prePrice)) {
      run({ op: 'price', offerId: offer.id, price: offer.price, prePrice: offer.prePrice });
    }
  }
  for (const page of after.pages) {
    const was = work.pages.find((p) => p.id === page.id);
    if (!was) continue;
    if (was.title !== page.title || was.subtitle !== page.subtitle) {
      run({
        op: 'pageText', pageId: page.id,
        ...(was.title !== page.title ? { title: page.title } : {}),
        ...(was.subtitle !== page.subtitle ? { subtitle: page.subtitle } : {}),
      });
    }
    for (const key of ['decorations', 'notes', 'background', 'ground', 'texts'] as const) {
      if (!same(was[key], page[key])) unrepresented.push(`${key} on ${page.id}`);
    }
  }
  return { ops, unrepresented };
}

/**
 * An edition as edited, stored back as ops against the base.
 *
 * `edited` is what the studio shows after somebody worked on the edition
 * — the resolved variant plus their changes. The offers it has that the
 * base does not are the edition's own; everything else is a diff.
 */
export function recordVariant(
  base: CatalogDocument,
  variant: PublicationVariant,
  edited: CatalogDocument,
  brand: Brand,
): { variant: PublicationVariant; unrepresented: string[] } {
  const inBase = new Set(base.offers.map((o) => o.id));
  const own = edited.offers.filter((o) => !inBase.has(o.id));
  const { ops, unrepresented } = diffToOps(withOffers(base, own), edited, brand);
  return { variant: { ...variant, offers: own, ops }, unrepresented };
}

/** A new, empty edition — the base as it is — ready to be edited. */
export function newVariant(base: CatalogDocument, name: string, stores: string[] = []): PublicationVariant {
  const slug = name.toLowerCase().replace(/æ/g, 'ae').replace(/ø/g, 'o').replace(/å/g, 'aa')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'variant';
  const taken = new Set((base.variants ?? []).map((v) => v.id));
  let id = slug;
  for (let n = 2; taken.has(id); n += 1) id = `${slug}-${n}`;
  return { id, name, stores, offers: [], ops: [] };
}

/** How many offers an edition differs by, for a list of editions. */
export function variantSummary(base: CatalogDocument, variant: PublicationVariant, brand: Brand): {
  added: number; removed: number; moved: number; repriced: number; conflicts: number;
} {
  const resolved = resolveVariant(base, variant.id, brand);
  const was = positions(base);
  const now = positions(resolved.document);
  const basePrices = new Map(base.offers.map((o) => [o.id, o.price]));
  return {
    added: [...now.keys()].filter((id) => !was.has(id)).length,
    removed: [...was.keys()].filter((id) => !now.has(id)).length,
    moved: [...now.keys()].filter((id) => was.has(id) && was.get(id) !== now.get(id)).length,
    repriced: resolved.document.offers.filter((o) => basePrices.has(o.id) && basePrices.get(o.id) !== o.price).length,
    conflicts: resolved.conflicts.length,
  };
}

