import { describe, expect, it } from 'vitest';
import {
  DESIGN_GROUPS, Offer, OfferRule, STARTER_RULES, VARIANTS, VARIANT_DESIGNS, offerFacts, reshape, resolveLook,
  stickerText, variantFrame, type OfferRuleInput,
} from '../index.js';

const offer = (over: Partial<Offer> = {}): Offer => Offer.parse({
  id: 'o1', name: 'Kaffe', price: 30, quantity: { size: 1, unit: 'pcs' },
  validFrom: '2026-09-21', validTo: '2026-09-27', ...over,
});
const rule = (input: OfferRuleInput) => OfferRule.parse(input);
const green = DESIGN_GROUPS.find((group) => group.id === 'green')!;

describe('offerFacts', () => {
  it('reads what the feed actually fills', () => {
    expect(offerFacts(offer({ imageKind: 'lifestyle' })).lifestyle).toBe(true);
    expect(offerFacts(offer({ priority: 1 })).lead).toBe(true);
    expect(offerFacts(offer({ priority: 0.67 })).lead).toBe(false);
    expect(offerFacts(offer({ campaign: 'Månedens køb' })).campaign).toBe(true);
    expect(offerFacts(offer({ savingsPercent: 25 })).savingsShare).toBeCloseTo(0.25);
    expect(offerFacts(offer({ memberPrice: 25 })).member).toBe(true);
  });

  it('knows where the offer stands only when it is asked on a page', () => {
    expect(offerFacts(offer()).hero).toBe(false);
    expect(offerFacts(offer(), { hero: true }).hero).toBe(true);
  });
});

describe('resolveLook', () => {
  it('chooses the variant, top rule first, and says which rule chose it', () => {
    const both = offer({ memberPrice: 25 });
    const look = resolveLook(both, STARTER_RULES, { hero: true });
    expect(look.variant).toBe('member');
    expect(look.because.variant).toBe('Medlemspris');
    expect(resolveLook(offer(), STARTER_RULES, { hero: true }).variant).toBe('lead');
    expect(resolveLook(offer(), STARTER_RULES, { hero: false }).variant).toBeNull();
  });

  it('turns a condition round, and skips a switched-off rule', () => {
    const packs = rule({ id: 'k', name: 'Pakker', when: [{ fact: 'lifestyle', is: false }], then: { variant: 'normal' } });
    expect(resolveLook(offer(), [packs]).variant).toBe('normal');
    expect(resolveLook(offer({ imageKind: 'lifestyle' }), [packs]).variant).toBeNull();
    expect(resolveLook(offer(), [{ ...packs, enabled: false }]).variant).toBeNull();
  });
});

describe('variants', () => {
  it('draw a sticker only when there is something to say on it', () => {
    expect(stickerText('before', offer())).toBeNull();
    expect(stickerText('before', offer({ prePrice: 40 }))).toBe('Før 40,-');
    expect(stickerText('savings', offer({ savingsPercent: 20 }))).toBe('Spar 20 %');
    expect(stickerText('member', offer({ memberPrice: 25 }))).toBe('Medlemsrabat 5,-');
    expect(variantFrame('normal', green, offer(), 1).frame.stickers).toEqual([]);
    expect(variantFrame('normal', green, offer({ prePrice: 40 }), 1).frame.stickers?.[0]?.text).toBe('Før 40,-');
  });

  it('puts the member price in the figure, and the ordinary one as før', () => {
    const drawn = variantFrame('member', green, offer({ memberPrice: 25 }), 1);
    expect(drawn.offer.price).toBe(25);
    expect(drawn.offer.prePrice).toBe(30);
    expect(drawn.priceShape).toBe('disc');
    expect(drawn.frame.priceFill).toBe(green.disc);
  });

  it('keeps every box inside its cell, in every shape', () => {
    for (const variant of VARIANTS) {
      const design = VARIANT_DESIGNS[variant];
      for (const aspect of [0.5, 1, 2]) {
        const shape = reshape(design.shape, aspect, design.cover);
        for (const box of [shape.media, shape.words, shape.price, ...shape.stickers.map((slot) => slot.rect)]) {
          expect(box.x).toBeGreaterThanOrEqual(0);
          expect(box.y).toBeGreaterThanOrEqual(0);
          expect(box.x + box.w).toBeLessThanOrEqual(1.0001);
          expect(box.y + box.h).toBeLessThanOrEqual(1.0001);
        }
      }
    }
  });
});

describe('recognition — what the offer IS decides how it looks', () => {
  const label = (kind: 'new' | 'saving' | 'custom' | 'multibuy', text: string) => ({ kind, text, image: null, imageOnDark: null });

  it('knows a lowered price by its previous price or by the chain saying so', () => {
    expect(offerFacts(offer({ prePrice: 40 })).reduced).toBe(true);
    expect(offerFacts(offer({ labels: [label('saving', 'Nedsat pris')] })).reduced).toBe(true);
    expect(offerFacts(offer()).reduced).toBe(false);
    // A member price saves, but is not a lowered price.
    expect(offerFacts(offer({ memberPrice: 25 })).reduced).toBe(false);
  });

  it('knows new, tested and warranty from the chain\'s own words', () => {
    expect(offerFacts(offer({ labels: [label('custom', 'Nyhed')] })).isNew).toBe(true);
    expect(offerFacts(offer({ labels: [label('custom', 'Testet')] })).tested).toBe(true);
    expect(offerFacts(offer({ labels: [label('custom', 'Warranty 5')] })).warranty).toBe(true);
  });

  it('gives each its own variant by the starter rules', () => {
    expect(resolveLook(offer({ prePrice: 35 }), STARTER_RULES).variant).toBe('reduced');
    expect(resolveLook(offer({ labels: [label('new', 'Nyhed')] }), STARTER_RULES).variant).toBe('new');
    expect(resolveLook(offer({ prePrice: 80 }), STARTER_RULES).variant).toBe('savings');
    expect(resolveLook(offer({ prePrice: 40, memberPrice: 25 }), STARTER_RULES).variant).toBe('member');
  });

  it('reads "label contains", case aside, and never matches an empty word', () => {
    const tested = rule({ id: 't', name: 'Testet', when: [{ fact: 'label', text: 'testet' }], then: { emphasis: 'more' } });
    expect(resolveLook(offer({ labels: [label('custom', 'Testet af Tænk')] }), [tested]).emphasis).toBeGreaterThan(0);
    expect(resolveLook(offer(), [tested]).emphasis).toBe(0);
    const empty = rule({ id: 'e', name: 'Tom', when: [{ fact: 'label', text: '' }], then: { variant: 'new' } });
    expect(resolveLook(offer({ labels: [label('custom', 'Nyhed')] }), [empty]).variant).toBeNull();
  });

  it('draws the lowered and the new sticker only when there is something to say', () => {
    const drawn = variantFrame('reduced', green, offer({ prePrice: 40 }), 1).frame.stickers!.map((s) => s.text);
    expect(drawn).toEqual(['Nedsat pris', 'Før 40,-']);
    expect(variantFrame('reduced', green, offer(), 1).frame.stickers).toEqual([]);
    expect(variantFrame('new', green, offer({ labels: [label('new', 'Nyhed')] }), 1).frame.stickers!.map((s) => s.text)).toEqual(['Nyhed']);
    // Every variant carries the marks — a Testet offer keeps its mark whatever was chosen.
    for (const variant of VARIANTS) {
      const texts = variantFrame(variant, green, offer({ labels: [label('custom', 'Testet')] }), 1).frame.stickers!.map((s) => s.text);
      expect(texts, variant).toContain('Testet');
    }
  });

  it('rotates: the second offer in a variant is the first one mirrored', () => {
    const a = variantFrame('normal', green, offer(), 1, {}, 0).frame;
    const b = variantFrame('normal', green, offer(), 1, {}, 1).frame;
    expect(b.price!.x).toBeCloseTo(1 - a.price!.x - a.price!.w);
    // A photograph filling the cell is not turned round.
    expect(variantFrame('lifestyle', green, offer(), 1, {}, 1).frame.price).toEqual(variantFrame('lifestyle', green, offer(), 1, {}, 0).frame.price);
  });
});
