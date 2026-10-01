/**
 * How a CMS publication becomes pages.
 *
 * A config section names a section design by tag. The design is a sheet
 * of layers — backdrop, headings, pictures — and one or more offer boxes,
 * each saying which offer design draws its offers and how many it takes
 * ("Avis priskasse 2 × 1", "Design 1 × 5"). A box with no count takes the
 * rest. When a section has more offers than its design's boxes hold, the
 * rest spill onto the overflow design ("Primary - Overflow"), page after
 * page.
 *
 * Wolt builds every section from a category of its feed (the "cohort");
 * Løvbjerg names its designs after their grid ("1prio+3+3 V": one lead
 * and two rows of three). Both read the same way here.
 */
import { offerKey, sectionDesigns, type CmsPublication, type CmsSectionDesign, type CmsSectionLayer } from './types.js';

export type Box = [number, number, number, number];

export interface OfferBox {
  /** The offer design tag the box draws in. */
  tag: string;
  /** How many offers it takes; null is "the rest". */
  max: number | null;
  box: Box;
}

export interface PlannedPage {
  /** The section design this page is drawn with — the main one, then the overflow. */
  design: string;
  overflow: boolean;
  offers: string[];
}

export interface SectionPlan {
  id: string;
  title: string;
  cohort: string | null;
  design: string;
  overflowDesign: string | null;
  /** Offer boxes of the main design, top to bottom, left to right. */
  boxes: OfferBox[];
  /** What the main design holds; Infinity when a box takes the rest. */
  capacity: number;
  /** Offer keys (item numbers), in the section's order. */
  offers: string[];
  aOffers: string[];
  pages: PlannedPage[];
  /** The offer design most of the section's offers are drawn in. */
  offerTag: string | null;
  /** The design's whole-sheet picture and colour, when it has them. */
  background: { url: string; fit: 'cover' | 'contain' } | null;
  ground: string | null;
  /** Several designs share the tag: the CMS uses them in turn. */
  alternatives: number;
  /** The tag names no design in the publication's own list. */
  missing: boolean;
}

const visible = (layer: CmsSectionLayer) => !layer.is_hidden && (layer.opacity ?? 100) > 0;
const area = (l: CmsSectionLayer) => Math.max(0, Math.min(l.x2, 1) - Math.max(l.x1, 0)) * Math.max(0, Math.min(l.y2, 1) - Math.max(l.y1, 0));

export function offerBoxes(design: CmsSectionDesign | undefined): OfferBox[] {
  if (!design) return [];
  return design.layers
    .filter((l) => visible(l) && l.offers_tag)
    .map((l) => ({ tag: l.offers_tag!, max: l.offers_max_count ?? null, box: [l.x1, l.y1, l.x2, l.y2] as Box }))
    .sort((a, b) => a.box[1] - b.box[1] || a.box[0] - b.box[0]);
}

export function capacityOf(boxes: readonly OfferBox[]): number {
  if (boxes.length === 0) return 0;
  return boxes.some((b) => b.max === null) ? Infinity : boxes.reduce((n, b) => n + b.max!, 0);
}

/** `rgb(255, 234, 153)` → `#ffea99`; anything else → null. */
function hex(color: string | null | undefined): string | null {
  const m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(color ?? '');
  if (!m) return null;
  return `#${[m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, '0')).join('')}`;
}

function backdrop(design: CmsSectionDesign | undefined): Pick<SectionPlan, 'background' | 'ground'> {
  if (!design) return { background: null, ground: null };
  const full = design.layers.filter((l) => visible(l) && !l.offers_tag && area(l) >= 0.9);
  // Layers are listed top first, so the bottom-most full-sheet layer is the backdrop.
  const picture = [...full].reverse().find((l) => l.bg_image_url?.signed);
  const colour = [...full].reverse().find((l) => hex(l.bg_color));
  // Wolt sets its offers on a panel — the offer box's own colour — over most of the sheet; they stand on that.
  const panel = design.layers.find((l) => visible(l) && l.offers_tag && hex(l.bg_color) && area(l) >= 0.5);
  return {
    background: picture && !panel ? { url: picture.bg_image_url!.signed!, fit: picture.bg_image_size === 'contain' ? 'contain' : 'cover' } : null,
    ground: hex(panel?.bg_color) ?? hex(colour?.bg_color),
  };
}

/** Offers onto pages: the main design's capacity first, then the overflow design's, page after page. */
function paginate(offers: string[], main: string, capacity: number, overflow: string | null, overflowCapacity: number): PlannedPage[] {
  const first = Number.isFinite(capacity) ? offers.slice(0, capacity) : offers;
  const pages: PlannedPage[] = [{ design: main, overflow: false, offers: first }];
  let rest = offers.slice(first.length);
  if (rest.length > 0 && overflow && overflowCapacity > 0) {
    while (rest.length > 0) {
      const take = Number.isFinite(overflowCapacity) ? rest.slice(0, overflowCapacity) : rest;
      pages.push({ design: overflow, overflow: true, offers: take });
      rest = rest.slice(take.length);
    }
  } else if (rest.length > 0) {
    // No overflow design: the CMS lets the last box grow, so the offers stay on the page.
    pages[0]!.offers.push(...rest);
  }
  return pages;
}

export function planSections(publication: CmsPublication): SectionPlan[] {
  const designs = sectionDesigns(publication.designs);
  const byTag = new Map<string, CmsSectionDesign[]>();
  for (const d of designs) byTag.set(d.tag, [...(byTag.get(d.tag) ?? []), d]);
  const keyOf = new Map(publication.offers.map((o) => [o.id, offerKey(o)]));

  return publication.config.sections.map((section) => {
    const main = byTag.get(section.design_tag)?.[0];
    const overflowTag = section.secondary_design_tag || null;
    const overflow = overflowTag ? byTag.get(overflowTag)?.[0] : undefined;
    const boxes = offerBoxes(main);
    const capacity = capacityOf(boxes);
    const offers = section.offer_ids.map((id) => keyOf.get(id) ?? id);
    const slots = new Map<string, number>();
    for (const b of boxes) slots.set(b.tag, (slots.get(b.tag) ?? 0) + (b.max ?? 1));
    return {
      id: section.id,
      title: section.title,
      cohort: section.group_label || null,
      design: section.design_tag,
      overflowDesign: overflowTag,
      boxes,
      capacity,
      offers,
      aOffers: section.a_offer_ids.map((id) => keyOf.get(id) ?? id),
      pages: paginate(offers, section.design_tag, capacity, overflowTag, capacityOf(offerBoxes(overflow))),
      offerTag: [...slots.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
      ...backdrop(main),
      alternatives: byTag.get(section.design_tag)?.length ?? 0,
      missing: !main,
    };
  });
}
