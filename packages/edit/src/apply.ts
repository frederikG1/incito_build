import {
  PlacementOverrides, PACK_DEFAULTS, tidyAdjust, packLimits, packOverride, partLimits, partOverride, partPatch, TILE_PART_NAMES,
  type Brand, type CatalogDocument, type CatalogPage, type PageTemplate, type Placement,
} from '@incitio/schema';
import { EditOp } from './ops.js';

export interface EditResult {
  document: CatalogDocument;
  /** One line per op, in order: what it did. */
  applied: string[];
}

export class EditError extends Error {
  constructor(readonly index: number, readonly op: unknown, message: string) {
    super(`op ${index + 1}: ${message}`);
    this.name = 'EditError';
  }
}

const ROLE_RANK = { hero: 3, feature: 2, standard: 1, compact: 0 } as const;
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

/** The template a page is laid out on: the document's own first, then the chain's. */
export function pageTemplate(document: CatalogDocument, brand: Brand, page: CatalogPage): PageTemplate | undefined {
  return document.templates.find((t) => t.id === page.templateId)
    ?? brand.templates.find((t) => t.id === page.templateId);
}

function locate(document: CatalogDocument, offerId: string): { page: CatalogPage; placement: Placement } | null {
  for (const page of document.pages) {
    const placement = page.placements.find((p) => p.offerId === offerId);
    if (placement) return { page, placement };
  }
  return null;
}

function withPage(document: CatalogDocument, pageId: string, change: (page: CatalogPage) => CatalogPage): CatalogDocument {
  return { ...document, pages: document.pages.map((page) => (page.id === pageId ? change(page) : page)) };
}

function withOverrides(
  document: CatalogDocument, offerId: string,
  change: (overrides: PlacementOverrides) => PlacementOverrides,
): CatalogDocument {
  return {
    ...document,
    pages: document.pages.map((page) => ({
      ...page,
      placements: page.placements.map((p) => (p.offerId === offerId ? { ...p, overrides: change(p.overrides) } : p)),
    })),
  };
}

/** A page moved onto another layout: offers keep their order, pinned ones first to stay. */
function relayout(page: CatalogPage, old: PageTemplate | undefined, next: PageTemplate): { page: CatalogPage; dropped: number } {
  const order = old ? old.slots.map((s) => s.id) : page.placements.map((p) => p.slotId);
  const ranked = [...page.placements].sort((x, y) => order.indexOf(x.slotId) - order.indexOf(y.slotId));
  // Pinned tiles are placed first, so a smaller layout drops the loose ones.
  const kept = [...ranked.filter((p) => p.overrides.pinned), ...ranked.filter((p) => !p.overrides.pinned)]
    .slice(0, next.slots.length);
  const placements = ranked
    .filter((p) => kept.includes(p))
    .map((p, i) => ({ ...p, slotId: next.slots[i]!.id }));
  return { page: { ...page, templateId: next.id, placements }, dropped: ranked.length - placements.length };
}

/**
 * Apply ops in order, all or nothing.
 *
 * A list either lands whole or not at all, and the error says which op
 * failed and why — "op 3: no offer X" — so an agent can correct that one
 * op and resend. Nothing here guesses: an unknown id, a slot the page's
 * layout does not have, a template the chain does not own, is an error.
 */
export function applyOps(document: CatalogDocument, ops: unknown[], brand: Brand): EditResult {
  let doc = document;
  const applied: string[] = [];
  ops.forEach((raw, index) => {
    const parsed = EditOp.safeParse(raw);
    if (!parsed.success) {
      throw new EditError(index, raw, parsed.error.issues.map((i) => `${i.path.join('.') || 'op'}: ${i.message}`).join('; '));
    }
    const fail = (message: string): never => { throw new EditError(index, raw, message); };
    const offerOf = (id: string) => doc.offers.find((o) => o.id === id) ?? fail(`no offer "${id}"`);
    const placed = (id: string) => { offerOf(id); return locate(doc, id) ?? fail(`offer "${id}" is not on a page`); };
    const pageOf = (id: string) => doc.pages.find((p) => p.id === id) ?? fail(`no page "${id}"`);
    const op = parsed.data;
    // What a line says, in the words on the page: the product and "side 3", not ids.
    const n = (id: string) => {
      const name = doc.offers.find((o) => o.id === id)?.name ?? id;
      return name.length > 40 ? `${name.slice(0, 38)}…` : name;
    };
    const side = (pageId: string) => `side ${doc.pages.findIndex((p) => p.id === pageId) + 1}`;

    switch (op.op) {
      case 'swap': {
        if (op.offerId === op.withOfferId) fail('an offer cannot swap with itself');
        const a = placed(op.offerId);
        offerOf(op.withOfferId);
        const b = locate(doc, op.withOfferId);
        doc = {
          ...doc,
          pages: doc.pages.map((page) => ({
            ...page,
            placements: page.placements.map((p) => {
              if (p.offerId === op.offerId) {
                return b ? { ...b.placement, slotId: p.slotId } : { ...p, offerId: op.withOfferId, overrides: PlacementOverrides.parse({}) };
              }
              if (b && p.offerId === op.withOfferId) return { ...a.placement, slotId: p.slotId };
              return p;
            }),
          })),
        };
        applied.push(b ? `byttede ${n(op.offerId)} og ${n(op.withOfferId)}` : `${n(op.withOfferId)} tog pladsen fra ${n(op.offerId)}, som gik i reserve`);
        break;
      }
      case 'place':
      case 'lead': {
        const target = op.op === 'place' ? pageOf(op.pageId) : placed(op.offerId).page;
        if (target.kind !== 'offers') fail(`page "${target.id}" is a picture page`);
        const template = pageTemplate(doc, brand, target) ?? fail(`page "${target.id}" has no layout`);
        const slotId = op.op === 'place'
          ? (template.slots.some((s) => s.id === op.slotId) ? op.slotId : fail(`layout "${template.id}" has no slot "${op.slotId}" (has ${template.slots.map((s) => s.id).join(', ')})`))
          : [...template.slots].sort((x, y) => ROLE_RANK[y.role] - ROLE_RANK[x.role])[0]!.id;
        offerOf(op.offerId);
        const from = locate(doc, op.offerId);
        if (from && from.page.id === target.id && from.placement.slotId === slotId) {
          applied.push(`${n(op.offerId)} står der allerede`);
          break;
        }
        const occupant = target.placements.find((p) => p.slotId === slotId);
        const moving = from?.placement ?? { offerId: op.offerId, slotId, overrides: PlacementOverrides.parse({}) };
        doc = {
          ...doc,
          pages: doc.pages.map((page) => {
            let placements = page.placements;
            if (from && page.id === from.page.id) {
              placements = placements.flatMap((p) => {
                if (p.offerId !== op.offerId) return [p];
                // The occupant takes the slot the offer left; without one it just empties.
                return occupant ? [{ ...occupant, slotId: from.placement.slotId }] : [];
              });
            }
            if (page.id === target.id) {
              placements = [...placements.filter((p) => p.slotId !== slotId), { ...moving, slotId }];
            }
            return { ...page, placements };
          }),
        };
        const went = occupant ? (from ? `${n(occupant.offerId)} flyttet til felt ${from.placement.slotId}` : `${n(occupant.offerId)} i reserve`) : '';
        applied.push(`${n(op.offerId)} → ${side(target.id)}, felt ${slotId}${went ? `; ${went}` : ''}`);
        break;
      }
      case 'add': {
        const page = pageOf(op.pageId);
        if (page.kind !== 'offers') fail(`page "${page.id}" is a picture page`);
        offerOf(op.offerId);
        if (page.placements.some((p) => p.offerId === op.offerId)) {
          applied.push(`${n(op.offerId)} står allerede på ${side(page.id)}`);
          break;
        }
        const from = locate(doc, op.offerId);
        if (from) doc = withPage(doc, from.page.id, (entry) => ({ ...entry, placements: entry.placements.filter((p) => p.offerId !== op.offerId) }));
        let target = doc.pages.find((p) => p.id === page.id)!;
        let template = pageTemplate(doc, brand, target) ?? fail(`page "${page.id}" has no layout`);
        let free = template.slots.find((s) => !target.placements.some((p) => p.slotId === s.id));
        let grew = '';
        if (!free) {
          // A full page grows the way an offer grid does: the chain's first layout with one more cell.
          const size = template.slots.length + 1;
          // The document's own layouts first, and the same family before any other: grid-6 grows into grid-7.
          const family = template.id.replace(/-\d+$/, '');
          const sized = [...doc.templates, ...brand.templates].filter((t) => t.slots.length === size);
          const next = sized.find((t) => t.id.replace(/-\d+$/, '') === family) ?? sized[0]
            ?? fail(`page "${page.id}" is full and ${brand.name} has no layout with ${size} slots`);
          target = relayout(target, template, next).page;
          template = next;
          free = next.slots.find((s) => !target.placements.some((p) => p.slotId === s.id))!;
          grew = ` (siden fik layoutet ${next.name})`;
        }
        const slotId = free.id;
        doc = withPage(doc, page.id, () => ({
          ...target,
          placements: [...target.placements, { offerId: op.offerId, slotId, overrides: PlacementOverrides.parse({}) }],
        }));
        applied.push(`${n(op.offerId)} lagt på ${side(page.id)}, felt ${slotId}${grew}`);
        break;
      }
      case 'remove': {
        const at = placed(op.offerId);
        doc = withPage(doc, at.page.id, (page) => ({ ...page, placements: page.placements.filter((p) => p.offerId !== op.offerId) }));
        applied.push(`${n(op.offerId)} taget af siden`);
        break;
      }
      case 'text': {
        placed(op.offerId);
        doc = withOverrides(doc, op.offerId, (o) => {
          if (op.part === 'name') return { ...o, displayName: op.text };
          if (op.part === 'description') return { ...o, description: op.text };
          return { ...o, ...partPatch(o, op.part, { text: op.text }) } as PlacementOverrides;
        });
        applied.push(`${n(op.offerId)}: ${TILE_PART_NAMES[op.part].toLowerCase()} ${op.text === null ? 'tilbage til feedets tekst' : op.text === '' ? 'fjernet' : `→ “${op.text}”`}`);
        break;
      }
      case 'part': {
        placed(op.offerId);
        const limits = partLimits(op.part);
        doc = withOverrides(doc, op.offerId, (o) => {
          const now = partOverride(o, op.part);
          return {
            ...o,
            ...partPatch(o, op.part, {
              offsetX: op.offsetX === undefined ? now.offsetX : clamp(op.offsetX, -limits.reach, limits.reach),
              offsetY: op.offsetY === undefined ? now.offsetY : clamp(op.offsetY, -limits.reach, limits.reach),
              scale: op.scale === undefined ? now.scale : clamp(op.scale, limits.minScale, limits.maxScale),
              ...(op.hidden === undefined || op.part === 'media' ? {} : { hidden: op.hidden }),
            }),
          } as PlacementOverrides;
        });
        applied.push(`${n(op.offerId)}: ${TILE_PART_NAMES[op.part].toLowerCase()} rettet`);
        break;
      }
      case 'pack': {
        placed(op.offerId);
        const limits = packLimits();
        doc = withOverrides(doc, op.offerId, (o) => {
          const now = packOverride(o, op.index);
          const next = {
            offsetX: op.offsetX === undefined ? now.offsetX : clamp(op.offsetX, -limits.reach, limits.reach),
            offsetY: op.offsetY === undefined ? now.offsetY : clamp(op.offsetY, -limits.reach, limits.reach),
            scale: op.scale === undefined ? now.scale : clamp(op.scale, limits.minScale, limits.maxScale),
            rotate: op.rotate === undefined ? now.rotate : clamp(op.rotate, -limits.turn, limits.turn),
            depth: op.depth === undefined ? now.depth : clamp(op.depth, -limits.depth, limits.depth),
            hidden: op.hidden ?? now.hidden,
          };
          // Sparse, like the document keeps it: a product put back where it was leaves no key.
          const { [String(op.index)]: _, ...rest } = o.pack;
          const back = JSON.stringify(next) === JSON.stringify({ ...PACK_DEFAULTS });
          return { ...o, pack: back ? rest : { ...rest, [String(op.index)]: next } };
        });
        applied.push(`${n(op.offerId)}: vare ${op.index + 1} i flisen ${op.hidden ? 'skjult' : 'rettet'}`);
        break;
      }
      case 'adjust': {
        placed(op.offerId);
        const merge = (now: PlacementOverrides['adjust']) => (op.adjust === null ? undefined : tidyAdjust({ ...now, ...op.adjust }));
        doc = withOverrides(doc, op.offerId, (o) => {
          if (op.index === undefined) {
            const { adjust: now, ...rest } = o;
            const next = merge(now);
            return (next ? { ...rest, adjust: next } : rest) as PlacementOverrides;
          }
          const { adjust: now, ...item } = packOverride(o, op.index);
          const next = merge(now);
          const { [String(op.index)]: _, ...others } = o.pack;
          const entry = next ? { ...item, adjust: next } : item;
          const back = JSON.stringify(entry) === JSON.stringify({ ...PACK_DEFAULTS });
          return { ...o, pack: back ? others : { ...others, [String(op.index)]: entry } };
        });
        applied.push(`${n(op.offerId)}: ${op.index === undefined ? 'billedet' : `vare ${op.index + 1}`} ${op.adjust === null ? 'nulstillet' : 'justeret'}`);
        break;
      }
      case 'adjustDecor': {
        const page = pageOf(op.pageId);
        if (!page.decorations.some((d) => d.id === op.decorId)) fail(`page "${page.id}" has no picture "${op.decorId}"`);
        doc = withPage(doc, page.id, (entry) => ({
          ...entry,
          decorations: entry.decorations.map((d) => {
            if (d.id !== op.decorId) return d;
            const { adjust: now, ...rest } = d;
            const next = op.adjust === null ? undefined : tidyAdjust({ ...now, ...op.adjust });
            return next ? { ...rest, adjust: next } : rest;
          }),
        }));
        applied.push(`${side(page.id)}: billede ${op.adjust === null ? 'nulstillet' : 'justeret'}`);
        break;
      }
      case 'arrange':
        placed(op.offerId);
        doc = withOverrides(doc, op.offerId, (o) => ({ ...o, arrangement: op.arrangement }));
        applied.push(`${n(op.offerId)}: opstilling ${op.arrangement ?? 'efter siden'}`);
        break;
      case 'pin':
        placed(op.offerId);
        doc = withOverrides(doc, op.offerId, (o) => ({ ...o, pinned: op.pinned }));
        applied.push(`${n(op.offerId)} ${op.pinned ? 'låst på pladsen' : 'låst op'}`);
        break;
      case 'reset':
        placed(op.offerId);
        doc = withOverrides(doc, op.offerId, (o) => PlacementOverrides.parse({ pinned: o.pinned }));
        applied.push(`${n(op.offerId)}: alle rettelser nulstillet`);
        break;
      case 'price': {
        const offer = offerOf(op.offerId);
        const price = op.price ?? offer.price;
        const prePrice = op.prePrice === undefined ? offer.prePrice : op.prePrice;
        doc = {
          ...doc,
          offers: doc.offers.map((o) => (o.id === op.offerId ? {
            ...o, price, prePrice,
            // A saving follows the two prices it is the difference of.
            savings: prePrice !== null && prePrice > price ? Math.round((prePrice - price) * 100) / 100 : o.savings,
          } : o)),
        };
        applied.push(`${n(op.offerId)}: pris ${price}${prePrice !== null ? ` (før ${prePrice})` : ''}`);
        break;
      }
      case 'pageText': {
        pageOf(op.pageId);
        doc = withPage(doc, op.pageId, (page) => ({
          ...page,
          ...(op.title !== undefined ? { title: op.title } : {}),
          ...(op.subtitle !== undefined ? { subtitle: op.subtitle } : {}),
        }));
        applied.push(`${side(op.pageId)}: overskrift rettet`);
        break;
      }
      case 'layout': {
        const page = pageOf(op.pageId);
        if (page.kind !== 'offers') fail(`page "${page.id}" is a picture page`);
        const next = doc.templates.find((t) => t.id === op.templateId)
          ?? brand.templates.find((t) => t.id === op.templateId)
          ?? fail(`${brand.name} has no layout "${op.templateId}"`);
        const { page: moved, dropped } = relayout(page, pageTemplate(doc, brand, page), next);
        doc = withPage(doc, page.id, () => moved);
        applied.push(`${side(page.id)}: layoutet ${next.name}${dropped > 0 ? `; ${dropped} i reserve` : ''}`);
        break;
      }
      case 'removePage': {
        const page = pageOf(op.pageId);
        const at = side(page.id);
        doc = { ...doc, pages: doc.pages.filter((p) => p.id !== page.id) };
        applied.push(`${at} udeladt${page.placements.length ? `; ${page.placements.length} i reserve` : ''}`);
        break;
      }
      case 'movePage': {
        const page = pageOf(op.pageId);
        const rest = doc.pages.filter((p) => p.id !== page.id);
        const to = Math.min(op.to, rest.length);
        doc = { ...doc, pages: [...rest.slice(0, to), page, ...rest.slice(to)] };
        applied.push(`siden flyttet til plads ${to + 1}`);
        break;
      }
    }
  });
  return { document: doc, applied };
}
