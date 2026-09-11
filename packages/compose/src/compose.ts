import type {
  Brand,
  CatalogDocument,
  CatalogPage,
  Offer,
  Placement,
} from '@incitio/schema';
import { slotAssignmentOrder } from '@incitio/schema';
import { resolveTemplate } from '@incitio/brands';
import {
  chooseTemplate,
  RECENT_TEMPLATE_MEMORY,
  seededRandom,
  type CataloguePlan,
} from './plan.js';

export interface ComposeOptions {
  id: string;
  name: string;
  brand: Brand;
  /** Seed for template substitution. Defaults to the catalogue id. */
  seed?: string;
}

export interface ComposeResult {
  document: CatalogDocument;
  /** Offers the plan named that the feed does not contain. */
  unknown: string[];
  /** Offers dropped because their page's template had no room. */
  overflow: string[];
  /** Pages whose planned template was replaced, and why. */
  substitutions: { pageId: string; asked: string; used: string; reason: string }[];
}

/**
 * Plan in, catalogue out.
 *
 * Deliberately dull. Every interesting decision was made upstream — the
 * curator chose the grouping and the layout, the brand owns the
 * templates — so this function only has to be correct: resolve the
 * template within the brand, seat the offers, and report anything it
 * could not place. Nothing here scores, searches or guesses.
 */
export function composeCatalog(
  plan: CataloguePlan,
  offers: Offer[],
  options: ComposeOptions,
): ComposeResult {
  const { brand } = options;
  const byId = new Map(offers.map((offer) => [offer.id, offer]));
  const random = seededRandom(`${options.seed ?? options.id}:compose`);
  const recent: string[] = [];

  const pages: CatalogPage[] = [];
  const unknown: string[] = [];
  const overflow: string[] = [];
  const substitutions: ComposeResult['substitutions'] = [];
  const used = new Set<string>();

  plan.pages.forEach((planned, index) => {
    const pageId = `page-${index + 1}`;

    // Offers first: the template has to fit the page, not the reverse.
    const pageOffers: Offer[] = [];
    for (const offerId of planned.offerIds) {
      const offer = byId.get(offerId);
      if (!offer) { unknown.push(offerId); continue; }
      // A curator that names one offer twice would otherwise print it
      // twice; ids are the join key, so this has to be enforced here.
      if (used.has(offerId)) continue;
      pageOffers.push(offer);
    }
    if (pageOffers.length === 0) return;

    /*
     * The planned template, if the brand owns one by that id and it has
     * room. Both checks matter and for different reasons: a curator can
     * hallucinate an id, and it can also put six offers on a four-slot
     * layout. Falling back to a template of the right size loses the
     * model's stylistic choice but keeps every offer on the page, which
     * is the trade a print deadline wants.
     */
    let template = resolveTemplate(brand, planned.templateId);
    let reason = '';
    if (!template) {
      reason = `"${planned.templateId}" findes ikke i ${brand.name}s skabeloner`;
    } else if (template.slots.length < pageOffers.length) {
      reason = `${planned.templateId} har ${template.slots.length} pladser til ${pageOffers.length} tilbud`;
      template = undefined;
    }

    if (!template) {
      const fallbackId = chooseTemplate(brand, pageOffers.length, recent, random);
      template = resolveTemplate(brand, fallbackId)!;
      substitutions.push({ pageId, asked: planned.templateId, used: template.id, reason });
    }

    recent.push(template.id);
    if (recent.length > RECENT_TEMPLATE_MEMORY) recent.shift();

    const slots = slotAssignmentOrder(template);
    const placements: Placement[] = [];

    pageOffers.forEach((offer, position) => {
      const slot = slots[position];
      if (!slot) { overflow.push(offer.id); return; }
      used.add(offer.id);
      placements.push({
        offerId: offer.id,
        slotId: slot.id,
        overrides: {
          pinned: false,
          displayName: null,
          description: null,
          imageScale: 1,
          imageOffsetX: 0,
          imageOffsetY: 0,
          parts: {},
        },
      });
    });

    pages.push({
      id: pageId,
      templateId: template.id,
      title: planned.title,
      subtitle: planned.subtitle,
      placements,
      rationale: planned.rationale,
    });
  });

  const now = new Date().toISOString();
  return {
    unknown,
    overflow,
    substitutions,
    document: {
      id: options.id,
      schemaVersion: 2,
      name: options.name,
      brandId: brand.id,
      pages,
      // Only what actually reached a page: a document carrying the whole
      // feed would grow without bound and would let a deleted offer come
      // back on the next edit.
      offers: offers.filter((offer) => used.has(offer.id)),
      createdAt: now,
      updatedAt: now,
    },
  };
}
