import { z } from 'zod';
import type { Offer } from './offer.js';
import { VARIANTS, type Variant } from './designs.js';

/**
 * Which layout an offer gets, decided by rules the chain writes itself.
 *
 * Incito chooses an offer's DESIGN — the whole arrangement of picture,
 * words, price and sticker in its cell — by the offer's priority, its
 * price type and whether its picture is a packshot or a photograph.
 * Nothing moves the price on its own: the layout places everything.
 * This is the same model, as data a person in a store can set:
 *
 *   1. `offerFacts` reads what an offer IS, once, from the fields the
 *      feed actually fills — `MotivType`, `Priority`, `SavePercentage`,
 *      `ManusType`, `OfferType`, a member price.
 *   2. `OfferRule` says "when these facts hold, use this layout" — see
 *      `OFFER_LAYOUTS` — and how much the offer pulls towards the big
 *      cells, and whether it wears the member mark.
 *   3. `resolveLook` runs the list top to bottom. The first rule to say
 *      something decides it, and every decision names its rule.
 */

/* ------------------------------------------------------------ facts */

export interface OfferFacts {
  /** It stands in the page's lead zone — incito's A offer. Known only on a page. */
  hero: boolean;
  /** The offer has a picture to put in an image box. */
  image: boolean;
  /** The picture is a photograph of the product in use, not a packshot. */
  lifestyle: boolean;
  /** The feed ranks it among the page's leads — SuperBrugsen `Priority` 2. */
  lead: boolean;
  /** A member price is on it — the feed's number or its "Medlemspris" label. */
  member: boolean;
  /** It states a saving: a percentage, a previous price, or an amount. */
  savings: boolean;
  /** The saving as a share of the previous price, 0..1; 0 when none is stated. */
  savingsShare: number;
  /** "3 for 2", "2 stk. 30,-" — a multibuy. */
  multibuy: boolean;
  /** Run under a campaign — "Månedens køb". */
  campaign: boolean;
  /** Several products under one price. */
  group: boolean;
  organic: boolean;
  isNew: boolean;
  /** The figure is the lowest of several prices ("fra 49,-"). */
  from: boolean;
  /**
   * The price is lowered: a previous price above it, or the chain says
   * so ("Nedsat pris" — Bilka's `offerCustomLabel2`). Not the same as
   * `savings`: a member price or a multibuy saves without being lowered.
   */
  reduced: boolean;
  /** Tested and approved — "Testet", "Testvinder", "Bedst i test". */
  tested: boolean;
  /** A warranty is stated — "2 års garanti", "Warranty 5". */
  warranty: boolean;
  /** Every label's words, lower case — what a "label contains" condition reads. */
  words: string[];
}

/** Above this feed priority an offer is one of the page's leads. */
export const LEAD_PRIORITY = 0.9;

/** Where the offer stands, when a rule is asked on a page. */
export interface OfferPlace {
  hero: boolean;
}

/** The chain's own words for a lowered price, a test and a warranty. */
const REDUCED = /\bnedsat\b|\bprisnedsat|\bnu kun\b|\bny pris\b/i;
const TESTED = /\btest(et|vinder)?\b|bedst i test/i;
const WARRANTY = /garanti|warranty/i;

export function offerFacts(offer: Offer, place: OfferPlace = { hero: false }): OfferFacts {
  const has = (kind: string) => offer.labels.some((label) => label.kind === kind);
  const says = (pattern: RegExp) => offer.labels.some((label) => pattern.test(label.text));
  const before = offer.prePrice !== null && offer.prePrice > offer.price
    ? offer.prePrice
    : offer.savings !== null && offer.savings > 0 ? offer.price + offer.savings : null;
  const derived = before !== null && before > 0 ? (before - offer.price) / before : 0;
  const stated = (offer.savingsPercent ?? 0) / 100;
  const share = Math.max(derived, stated);
  return {
    hero: place.hero,
    image: Boolean(offer.imageUrl),
    lifestyle: offer.imageKind === 'lifestyle',
    lead: offer.priority !== null && offer.priority >= LEAD_PRIORITY,
    member: offer.memberPrice !== null || has('member'),
    // A saving the chain states in words ("Du sparer 29,80") is a saving even without the numbers.
    savings: share > 0 || has('saving'),
    savingsShare: share,
    multibuy: has('multibuy'),
    campaign: offer.campaign.trim() !== '',
    group: offer.members.length > 1 || offer.imagePack.length > 1,
    organic: has('organic'),
    isNew: has('new') || says(/\bnyhed\b|^ny$/i),
    from: offer.priceFrom,
    reduced: (offer.prePrice !== null && offer.prePrice > offer.price) || says(REDUCED),
    tested: says(TESTED),
    warranty: says(WARRANTY),
    words: offer.labels.map((label) => label.text.toLowerCase()),
  };
}

/* ------------------------------------------------------------ rules */

/** The facts a rule can ask about, in the order the editor lists them. */
export const RULE_FACTS = [
  'image', 'hero', 'lifestyle', 'lead', 'member', 'reduced', 'savings', 'savingsShare', 'multibuy', 'campaign', 'group',
  'organic', 'isNew', 'tested', 'warranty', 'from', 'label',
] as const;
export type RuleFact = (typeof RULE_FACTS)[number];

export const RuleCondition = z.object({
  fact: z.enum(RULE_FACTS),
  is: z.boolean().default(true),
  /** Only read by `savingsShare`, as a whole percentage. */
  atLeast: z.number().min(0).max(100).nullable().default(null),
  /**
   * Only read by `label`: the words one of the offer's labels contains,
   * case aside — incito's `offerCustomLabel1 contains "Nyhed"`.
   */
  text: z.string().max(60).nullable().default(null),
});
export type RuleCondition = z.infer<typeof RuleCondition>;

/** How much the offer pulls towards the page's big cells. */
export const EMPHASES = ['auto', 'less', 'normal', 'more', 'most'] as const;

/**
 * What a rule decides. `auto` (and `null`) mean "this rule has nothing
 * to say about it" — a later rule, or the page, decides.
 */
export const RuleLook = z.object({
  /** An offer design TAG — "Rød, sort, hvid - Uden billede". Null: the page's. See `OfferDesign`. */
  design: z.string().max(120).nullable().default(null),
  /** Which of the design group's variants the offer is drawn in — see `VARIANT_DESIGNS`. */
  variant: z.enum(['auto', ...VARIANTS]).default('auto'),
  emphasis: z.enum(EMPHASES).default('auto'),
  /** The member sticker's own words, when the chain has them — "Kun for medlemmer". */
  memberBadgeText: z.string().max(40).nullable().default(null),
});
export type RuleLook = z.infer<typeof RuleLook>;

export const OfferRule = z.object({
  id: z.string().min(1).max(60),
  name: z.string().min(1).max(80),
  enabled: z.boolean().default(true),
  /** All must hold. None at all makes the rule apply to every offer. */
  when: z.array(RuleCondition).max(6).default([]),
  then: RuleLook.default({}),
});
export type OfferRule = z.infer<typeof OfferRule>;
export type OfferRuleInput = z.input<typeof OfferRule>;

export const OfferRules = z.array(OfferRule).max(40);
export type OfferRules = z.infer<typeof OfferRules>;

export function meets(facts: OfferFacts, condition: RuleCondition): boolean {
  const wanted = (condition.text ?? '').trim().toLowerCase();
  const holds = condition.fact === 'savingsShare'
    ? facts.savings && facts.savingsShare * 100 >= (condition.atLeast ?? 0) - 1e-9
    : condition.fact === 'label'
      ? wanted !== '' && facts.words.some((words) => words.includes(wanted))
      : facts[condition.fact];
  return condition.is ? holds : !holds;
}

export function ruleMatches(rule: OfferRule, facts: OfferFacts): boolean {
  return rule.enabled && rule.when.every((condition) => meets(facts, condition));
}

/* ------------------------------------------------------------- look */

export interface TileLook {
  /** The design tag the rules chose, or null: the page's. */
  design: string | null;
  /** The variant the rules chose, or null: none said — the page decides. */
  variant: Variant | null;
  /** Added to the offer's weight when the page is laid out. */
  emphasis: number;
  memberBadgeText: string | null;
  /** Rule name per decision, for "why does it look like this?". */
  because: Partial<Record<keyof RuleLook, string>>;
}

export const PLAIN_LOOK: TileLook = { design: null, variant: null, emphasis: 0, memberBadgeText: null, because: {} };

/*
 * Sized against `offerImportance`, which runs 0..1 and gives a deep cut
 * about +0.5: "more" is worth a good discount, "most" beats nearly
 * anything the feed alone can say.
 */
const WEIGHT: Record<(typeof EMPHASES)[number], number> = {
  auto: 0, less: -0.2, normal: 0, more: 0.2, most: 0.45,
};

export function resolveLook(offer: Offer, rules: readonly OfferRule[] | undefined, place?: OfferPlace): TileLook {
  if (!rules || rules.length === 0) return PLAIN_LOOK;
  const facts = offerFacts(offer, place);
  const look: TileLook = { ...PLAIN_LOOK, because: {} };
  const said = new Set<keyof RuleLook>();
  for (const rule of rules) {
    if (!ruleMatches(rule, facts)) continue;
    const then = rule.then;
    const claim = (key: keyof RuleLook, speaks: boolean, apply: () => void) => {
      if (!speaks || said.has(key)) return;
      said.add(key);
      look.because[key] = rule.name;
      apply();
    };
    claim('design', then.design !== null && then.design.trim() !== '', () => { look.design = then.design!.trim(); });
    claim('variant', then.variant !== 'auto', () => { look.variant = then.variant as Variant; });
    claim('emphasis', then.emphasis !== 'auto', () => { look.emphasis = WEIGHT[then.emphasis]; });
    claim('memberBadgeText', then.memberBadgeText !== null && then.memberBadgeText.trim() !== '', () => {
      look.memberBadgeText = then.memberBadgeText!.trim();
    });
  }
  return look;
}

/** The weight the rules add to an offer — see `EMPHASES`. */
export function ruleEmphasis(offer: Offer, rules: readonly OfferRule[] | undefined): number {
  return rules && rules.length > 0 ? resolveLook(offer, rules).emphasis : 0;
}

/**
 * The rules a chain starts from, when it has written none: incito's own
 * logic, stated. First match wins, so the order is the precedence.
 */
export const STARTER_RULES: readonly OfferRule[] = [
  { id: 'start-lifestyle', name: 'Livsstilsbillede', enabled: true, when: [{ fact: 'lifestyle', is: true, atLeast: null, text: null }], then: { design: null, variant: 'lifestyle', emphasis: 'auto', memberBadgeText: null } },
  { id: 'start-member', name: 'Medlemspris', enabled: true, when: [{ fact: 'member', is: true, atLeast: null, text: null }], then: { design: null, variant: 'member', emphasis: 'more', memberBadgeText: null } },
  { id: 'start-hero', name: 'Hovedpladsen', enabled: true, when: [{ fact: 'hero', is: true, atLeast: null, text: null }], then: { design: null, variant: 'lead', emphasis: 'auto', memberBadgeText: null } },
  { id: 'start-savings', name: 'Stor besparelse', enabled: true, when: [{ fact: 'savingsShare', is: true, atLeast: 25, text: null }], then: { design: null, variant: 'savings', emphasis: 'more', memberBadgeText: null } },
  { id: 'start-reduced', name: 'Nedsat pris', enabled: true, when: [{ fact: 'reduced', is: true, atLeast: null, text: null }], then: { design: null, variant: 'reduced', emphasis: 'auto', memberBadgeText: null } },
  { id: 'start-new', name: 'Nyhed', enabled: true, when: [{ fact: 'isNew', is: true, atLeast: null, text: null }], then: { design: null, variant: 'new', emphasis: 'auto', memberBadgeText: null } },
];
