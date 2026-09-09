import type { ImageProfile, Offer, PageTemplate, TemplateSlot } from '@incitio/schema';
import { slotArea } from './geometry.js';

/**
 * Hard rules — the things that make a page wrong rather than ugly.
 * The solver will never return a layout that violates one, and the editor
 * refuses human edits that would introduce one. This is where the
 * retailer's non-negotiables (price-display law, minimum logo size,
 * mandatory unit price) get encoded as the project acquires them.
 */
export interface ConstraintContext {
  template: PageTemplate;
  profiles: Map<string, ImageProfile>;
}

export interface Violation {
  offerId: string;
  slotId: string;
  rule: string;
  message: string;
}

/** Below this share of the page, a tile cannot legibly carry a price badge. */
const MIN_AREA_FOR_LABELS = 0.045;
/** A hero tile magnifies a weak image; this is the floor for the big slots. */
const MIN_QUALITY_FOR_HERO = 0.45;

export function checkPlacement(
  offer: Offer,
  slot: TemplateSlot,
  ctx: ConstraintContext,
): Violation[] {
  const violations: Violation[] = [];
  const area = slotArea(slot, ctx.template);

  if (offer.labels.length > 0 && area < MIN_AREA_FOR_LABELS) {
    violations.push({
      offerId: offer.id,
      slotId: slot.id,
      rule: 'label-legibility',
      message: `offer carries ${offer.labels.length} label(s) but the slot is too small to render them`,
    });
  }

  // Unit price is mandatory wherever it is derivable, so a slot that
  // cannot show it may not hold an offer that requires it.
  if (offer.comparison !== null && area < MIN_AREA_FOR_LABELS) {
    violations.push({
      offerId: offer.id,
      slotId: slot.id,
      rule: 'comparison-price-required',
      message: 'slot too small to display the required unit price',
    });
  }

  const profile = ctx.profiles.get(offer.id);
  if (slot.role === 'hero' && profile && profile.qualityScore < MIN_QUALITY_FOR_HERO) {
    violations.push({
      offerId: offer.id,
      slotId: slot.id,
      rule: 'hero-image-quality',
      message: `image quality ${profile.qualityScore.toFixed(2)} is below the hero threshold`,
    });
  }

  return violations;
}

export function isPlacementLegal(
  offer: Offer,
  slot: TemplateSlot,
  ctx: ConstraintContext,
): boolean {
  return checkPlacement(offer, slot, ctx).length === 0;
}
