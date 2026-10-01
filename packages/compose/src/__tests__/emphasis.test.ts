import { describe, expect, it } from 'vitest';
import { Offer, OfferRule } from '@incitio/schema';
import { byImportance, offerImportance } from '../importance.js';

const offer = (id: string, over: Partial<Offer> = {}): Offer => Offer.parse({
  id, name: id, price: 20, quantity: { size: 1, unit: 'pcs' }, validFrom: '2026-09-21', validTo: '2026-09-27', ...over,
});

describe('"fokus på siden" from the chain\'s rules', () => {
  const rules = [OfferRule.parse({ id: 'm', name: 'Medlemspris', when: [{ fact: 'member' }], then: { emphasis: 'most' } })];
  const deal = offer('deal', { prePrice: 40 });
  const member = offer('member', { memberPrice: 18 });

  it('changes nothing without rules', () => {
    expect([member, deal].sort(byImportance())[0]!.id).toBe('deal');
    expect(offerImportance(member, [])).toBe(offerImportance(member));
  });

  it('moves a member offer ahead of a deeper discount when the chain says so', () => {
    expect(offerImportance(member, rules)).toBeGreaterThan(offerImportance(member));
    expect([deal, member].sort(byImportance(rules))[0]!.id).toBe('member');
  });
});
