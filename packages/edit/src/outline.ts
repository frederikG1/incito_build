import { tileArranged, type Brand, type CatalogDocument, type Offer } from '@incitio/schema';
import { pageTemplate } from './apply.js';

/**
 * A catalogue as an editor needs to see it, and nothing more.
 *
 * The document itself is the wrong thing to hand a model: it carries
 * every offer's full feed record, every layout's grid and every page's
 * decorations, and a 20-page book runs to hundreds of kilobytes. What an
 * edit needs is which offer stands where, what the layouts are called,
 * and what is waiting in reserve — the ids `EditOp` takes, beside the
 * words a person would use for them.
 */
export interface Outline {
  id: string;
  name: string;
  week: string | null;
  pages: {
    pageId: string;
    number: number;
    kind: 'offers' | 'image';
    title: string;
    subtitle: string;
    templateId: string;
    slots: { slotId: string; role: string; offerId: string | null; offer: string | null; pinned: boolean; tweaked: boolean }[];
  }[];
  reserve: { offerId: string; offer: string }[];
  /** The layouts the chain owns, by how many offers they hold. */
  layouts: { templateId: string; name: string; slots: number }[];
}

const kr = (value: number) => (Number.isInteger(value) ? `${value},-` : value.toFixed(2).replace('.', ','));

export function describeOffer(offer: Offer): string {
  const before = offer.prePrice !== null && offer.prePrice > offer.price ? `, før ${kr(offer.prePrice)}` : '';
  const brand = offer.brand && !offer.name.toLowerCase().includes(offer.brand.toLowerCase()) ? `${offer.brand} ` : '';
  return `${brand}${offer.name} — ${kr(offer.price)}${before}`;
}

export function outline(document: CatalogDocument, brand: Brand): Outline {
  const offers = new Map(document.offers.map((o) => [o.id, o]));
  const placed = new Set(document.pages.flatMap((p) => p.placements.map((x) => x.offerId)));
  return {
    id: document.id,
    name: document.name,
    week: document.week ? `${document.week.week} ${document.week.year}` : null,
    pages: document.pages.map((page, index) => {
      const template = pageTemplate(document, brand, page);
      const slotIds = template?.slots.map((s) => s.id) ?? page.placements.map((p) => p.slotId);
      return {
        pageId: page.id,
        number: index + 1,
        kind: page.kind,
        title: page.title,
        subtitle: page.subtitle,
        templateId: page.templateId,
        slots: slotIds.map((slotId) => {
          const placement = page.placements.find((p) => p.slotId === slotId);
          const offer = placement ? offers.get(placement.offerId) : undefined;
          const o = placement?.overrides;
          return {
            slotId,
            role: template?.slots.find((s) => s.id === slotId)?.role ?? 'standard',
            offerId: placement?.offerId ?? null,
            offer: offer ? describeOffer(offer) : null,
            pinned: o?.pinned ?? false,
            tweaked: o ? tileArranged(o) || o.displayName !== null || o.description !== null || o.imageScale !== 1 : false,
          };
        }),
      };
    }),
    reserve: document.offers.filter((o) => !placed.has(o.id)).map((o) => ({ offerId: o.id, offer: describeOffer(o) })),
    layouts: [...brand.templates, ...document.templates.filter((t) => !brand.templates.some((b) => b.id === t.id))]
      .map((t) => ({ templateId: t.id, name: t.name, slots: t.slots.length })),
  };
}

/** The outline as lines of text — about a tenth of its JSON. */
export function outlineText(o: Outline, options: { reserve?: number } = {}): string {
  const lines = [`${o.name} (${o.id})${o.week ? `, uge ${o.week}` : ''}`];
  for (const page of o.pages) {
    const head = page.kind === 'image' ? '[billedside]' : `${page.title || '(ingen overskrift)'}${page.subtitle ? ` / ${page.subtitle}` : ''}`;
    lines.push('', `side ${page.number} pageId=${page.pageId} layout=${page.templateId}: ${head}`);
    for (const slot of page.slots) {
      const flags = [slot.pinned ? 'låst' : '', slot.tweaked ? 'rettet' : ''].filter(Boolean).join(',');
      lines.push(`  ${slot.slotId} (${slot.role}) ${slot.offerId ? `${slot.offerId}: ${slot.offer}` : '— tom'}${flags ? ` [${flags}]` : ''}`);
    }
  }
  const cap = options.reserve ?? 150;
  lines.push('', `reserve (${o.reserve.length}${o.reserve.length > cap ? `, first ${cap}` : ''}):`);
  for (const r of o.reserve.slice(0, cap)) lines.push(`  ${r.offerId}: ${r.offer}`);
  lines.push('', 'layouts:');
  for (const l of o.layouts) lines.push(`  ${l.templateId} (${l.slots} felter) ${l.name}`);
  return lines.join('\n');
}
