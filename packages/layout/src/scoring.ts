import type { ImageProfile, Offer, PageTemplate, TemplateSlot } from '@incitio/schema';
import { slotArea, slotAspect } from './geometry.js';

/**
 * Every weight the layout engine uses, in one place. These are the dials
 * that get tuned against the eval set; keeping them as data rather than
 * inline constants is what makes that tuning possible without edits
 * scattered through the scorer.
 */
export interface ScoringWeights {
  aspectFit: number;
  roleFit: number;
  textFit: number;
  imageQuality: number;
  lifestyleSize: number;
  colorClash: number;
  brandRepeat: number;
}

export const DEFAULT_WEIGHTS: ScoringWeights = {
  aspectFit: 1.0,
  roleFit: 1.6,
  textFit: 0.7,
  imageQuality: 0.9,
  lifestyleSize: 0.8,
  colorClash: 0.5,
  brandRepeat: 0.35,
};

/**
 * How much editorial weight an offer deserves, 0..1. A feed-supplied
 * priority always wins; otherwise it is derived from discount depth,
 * because in leaflet practice the deepest cut is the page's draw.
 */
export function offerImportance(offer: Offer): number {
  if (offer.priority !== null) return offer.priority;

  let score = 0.3;
  if (offer.prePrice !== null && offer.prePrice > offer.price) {
    const depth = (offer.prePrice - offer.price) / offer.prePrice;
    score += Math.min(depth * 1.4, 0.5);
  } else if (offer.savings !== null && offer.savings > 0) {
    const denominator = offer.price + offer.savings;
    if (denominator > 0) score += Math.min((offer.savings / denominator) * 1.4, 0.5);
  }
  // Multibuy and member deals are the mechanics retailers push hardest.
  if (offer.labels.some((l) => l.kind === 'multibuy' || l.kind === 'member')) score += 0.12;

  return Math.max(0, Math.min(1, score));
}

/**
 * Total ordering of offers by editorial weight, strongest first.
 *
 * The id tie-break is load-bearing, not cosmetic: `offerImportance`
 * saturates, so distinct offers routinely share an exact score. Without a
 * final tie-break the result depends on the order rows happened to appear
 * in the feed, which makes regeneration shuffle pages at random and makes
 * golden-file tests meaningless.
 */
export function compareByImportance(a: Offer, b: Offer): number {
  const diff = offerImportance(b) - offerImportance(a);
  if (Math.abs(diff) > 1e-9) return diff;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

const ROLE_TARGET: Record<TemplateSlot['role'], number> = {
  hero: 0.85,
  standard: 0.5,
  filler: 0.25,
};

/** 1 when the two aspects match, decaying with the log of their ratio. */
function aspectAgreement(a: number, b: number): number {
  if (a <= 0 || b <= 0) return 0.5;
  const ratio = Math.log(a / b);
  return Math.exp(-(ratio * ratio) * 1.5);
}

export interface FitContext {
  template: PageTemplate;
  pageAspect: number;
  profiles: Map<string, ImageProfile>;
  weights: ScoringWeights;
}

/**
 * Score one offer in one slot, 0..1-ish per term, summed by weight.
 * Deliberately soft: every term is a penalty gradient rather than a veto,
 * so the solver degrades gracefully on feeds where nothing fits well —
 * hard requirements belong in `constraints.ts`, not here.
 */
export function placementScore(offer: Offer, slot: TemplateSlot, ctx: FitContext): number {
  const { template, pageAspect, profiles, weights } = ctx;
  const area = slotArea(slot, template);
  const profile = profiles.get(offer.id);
  let score = 0;

  // Does the image's shape suit the hole it goes in?
  const targetAspect = slotAspect(slot, template, pageAspect);
  const imageAspect = profile?.aspect ?? slot.preferredAspect;
  score += weights.aspectFit * aspectAgreement(imageAspect, targetAspect);

  // Does the offer's importance match the slot's editorial role?
  const importance = offerImportance(offer);
  const roleGap = Math.abs(importance - ROLE_TARGET[slot.role]);
  score += weights.roleFit * (1 - roleGap);

  // Will the product name fit, or will it clip?
  const nameLength = offer.name.length + (offer.brand ? offer.brand.length + 1 : 0);
  const overflow = nameLength / slot.textCapacity;
  score += weights.textFit * (overflow <= 1 ? 1 : Math.max(0, 1 - (overflow - 1) * 1.2));

  if (profile) {
    // A soft image gets exposed by a big tile, so quality matters in
    // proportion to how much of the page the tile occupies.
    score += weights.imageQuality * (1 - area * (1 - profile.qualityScore) * 2.5);

    // Scene photography needs room; in a small tile it reads as noise.
    if (profile.kind === 'lifestyle') {
      score += weights.lifestyleSize * Math.min(1, area / 0.15);
    } else {
      score += weights.lifestyleSize;
    }
  } else {
    // No profile yet (pre-M3). Award the neutral middle rather than zero,
    // so scores stay comparable whether or not the sidecar has run.
    score += weights.imageQuality * 0.6 + weights.lifestyleSize * 0.6;
  }

  return score;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Euclidean RGB distance, normalised 0..1. Crude but adequate for adjacency. */
export function colorDistance(a: string, b: string): number {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  const d = Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
  return Math.min(1, d / 441.67);
}
