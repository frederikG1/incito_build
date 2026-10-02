import { describe, expect, it } from 'vitest';
import { Brand, CatalogDocument, Offer, PageTemplate } from '@incitio/schema';
import { getBrand } from '@incitio/brands';
import { changesSince, familiarity, lanesOf, seenOf, signed, unsigned } from '../approvals.js';
import { priceRuleFindings, priceVerdicts } from '../pricerules.js';
import { bookingFindings, slotShares, slotsOf } from '../inventory.js';
import { orderFor } from '../audience.js';
import { HOUSEHOLDS, normalPrice, priceHistory, slotSignal } from '../signals.js';

const template = PageTemplate.parse({
  id: 't3',
  name: 'tre op',
  areas: ['a a', 'b c'],
  slots: [{ id: 'a', role: 'hero' }, { id: 'b', role: 'standard' }, { id: 'c', role: 'standard' }],
});
const brand = Brand.parse({ ...getBrand('superbrugsen').brand, templates: [template] });

const offer = (over: Partial<Offer> & { id: string }): Offer => Offer.parse({
  name: `vare ${over.id}`,
  price: 20,
  quantity: { size: 1, unit: 'pcs' },
  validFrom: '2026-09-21',
  validTo: '2026-09-27',
  ...over,
});

/** Pages of three cells, filled in order from the offers handed over. */
const doc = (offers: Offer[], pages: string[][], extra: Partial<CatalogDocument> = {}): CatalogDocument =>
  CatalogDocument.parse({
    id: 'c1',
    schemaVersion: 2,
    name: 'SuperBrugsen · uge 39',
    brandId: 'superbrugsen',
    week: { year: 2026, week: 39 },
    offers,
    pages: pages.map((ids, index) => ({
      id: `p${index + 1}`,
      templateId: 't3',
      placements: ids.map((offerId, slot) => ({ offerId, slotId: 'abc'[slot]! })),
    })),
    createdAt: '2026-09-20T00:00:00.000Z',
    updatedAt: '2026-09-20T00:00:00.000Z',
    ...extra,
  });

const three = [offer({ id: 'x' }), offer({ id: 'y' }), offer({ id: 'z' }), offer({ id: 'w' })];

describe('changes since a signature', () => {
  it('is empty on the avis that was signed', () => {
    const d = doc(three, [['x', 'y'], ['z']]);
    expect(changesSince(seenOf(d), d)).toEqual([]);
  });

  it('states a price change as before → after, on the page it is on', () => {
    const before = doc(three, [['x', 'y'], ['z']]);
    const after = { ...before, offers: before.offers.map((o) => (o.id === 'z' ? { ...o, price: 18.5 } : o)) };
    const changes = changesSince(seenOf(before), after);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ kind: 'pris', pageId: 'p2', offerId: 'z' });
    expect(changes[0]!.said).toContain('20,- → 18,50');
  });

  it('says what came in, what went out and what moved', () => {
    const before = doc(three, [['x', 'y'], ['z']]);
    const after = doc(three, [['y', 'w'], ['x']]);
    const kinds = changesSince(seenOf(before), after).map((c) => `${c.kind}:${c.offerId ?? c.id}`);
    expect(kinds).toContain('vare:w'); // in
    expect(kinds).toContain('vare:ud:z'); // out, no page to stand on
    expect(kinds).toContain('flyt:x'); // page 1 → page 2
    expect(kinds).toContain('flyt:y'); // same page, other place
  });

  it('notices page order without reporting every page after an inserted one', () => {
    const before = doc(three, [['x'], ['y'], ['z']]);
    const swapped = { ...before, pages: [before.pages[1]!, before.pages[0]!, before.pages[2]!] };
    expect(changesSince(seenOf(before), swapped).map((c) => c.id)).toEqual(['rækkefølge']);

    const inserted = { ...before, pages: [before.pages[0]!, { ...before.pages[0]!, id: 'ny', placements: [] }, ...before.pages.slice(1)] };
    expect(changesSince(seenOf(before), inserted).map((c) => c.id)).toEqual(['side+ny']);
  });

  it('shows each role only the changes it answers for', () => {
    const before = doc(three, [['x', 'y'], ['z']]);
    let d = signed(signed(before, 'marketing', 'A', 't'), 'pris', 'B', 't');
    // A new page title: marketing's business, not pricing's.
    d = { ...d, pages: d.pages.map((p) => (p.id === 'p1' ? { ...p, title: 'Grill' } : p)) };
    const lanes = Object.fromEntries(lanesOf(d).map((lane) => [lane.role, lane]));
    expect(lanes['marketing']!.state).toBe('forældet');
    expect(lanes['pris']!.state).toBe('godkendt');
    expect(lanes['indkob']!.state).toBe('mangler');
    expect(lanesOf(unsigned(d, 'marketing')).find((l) => l.role === 'marketing')!.state).toBe('mangler');
  });

  it('counts familiar pages by position and title', () => {
    const last = doc(three, [['x'], ['y'], ['z']]);
    const titled = (d: CatalogDocument, titles: string[]) => ({ ...d, pages: d.pages.map((p, i) => ({ ...p, title: titles[i] ?? '' })) });
    expect(familiarity(titled(last, ['Forside', 'Kød', 'Vin']), titled(last, ['Forside', 'Vin', 'Kød']))).toEqual({ same: 1, of: 3 });
  });
});

describe('price rules', () => {
  it('catches a saving that is not the difference between the prices', () => {
    const d = doc([offer({ id: 'x', price: 35, prePrice: 49, savings: 10 })], [['x']]);
    expect(priceRuleFindings(d).map((f) => f.id)).toContain('spar:x');
  });

  it('catches a "before" that is not above the price', () => {
    const d = doc([offer({ id: 'x', price: 35, prePrice: 35 })], [['x']]);
    expect(priceRuleFindings(d).map((f) => f.id)).toContain('førlav:x');
  });

  it('leaves a member-only offer alone and flags a member price above the price', () => {
    const same = doc([offer({ id: 'x', price: 22, memberPrice: 22 })], [['x']]);
    const above = doc([offer({ id: 'x', price: 22, memberPrice: 25 })], [['x']]);
    expect(priceRuleFindings(same)).toEqual([]);
    expect(priceRuleFindings(above).map((f) => f.weight)).toEqual(['se']);
  });

  it('holds the claimed price against the lowest of the last 30 days', () => {
    // Enough offers that the stand-in history gives some a recent campaign.
    const offers = Array.from({ length: 80 }, (_, i) => offer({ id: `o${i}`, price: 30, prePrice: 40 }));
    const ids = offers.map((o) => o.id);
    const d = doc(offers, Array.from({ length: Math.ceil(ids.length / 3) }, (_, i) => ids.slice(i * 3, i * 3 + 3)));
    const verdicts = priceVerdicts(d);
    expect(verdicts).toHaveLength(80);
    for (const v of verdicts) expect(v.ok).toBe(v.claimed <= v.lowest + 0.005);
    const broken = verdicts.filter((v) => !v.ok);
    expect(broken.length).toBeGreaterThan(0);
    // Every broken claim is a stop with the two prices in it.
    const said = priceRuleFindings(d).filter((f) => f.id.startsWith('førpris:'));
    expect(said).toHaveLength(broken.length);
    expect(said.every((f) => f.weight === 'stop')).toBe(true);
  });

  it('reads the claimed price from a percentage when that is all there is', () => {
    expect(normalPrice(offer({ id: 'x', price: 30, savingsPercent: 25 }))).toBe(40);
    expect(normalPrice(offer({ id: 'x', price: 30 }))).toBeNull();
    expect(priceHistory(offer({ id: 'x', price: 30 }))).toBeNull();
  });
});

describe('places as inventory', () => {
  it('shares a page by its cells', () => {
    const shares = slotShares(template);
    expect(shares.get('a')).toBeCloseTo(0.5);
    expect(shares.get('b')).toBeCloseTo(0.25);
  });

  it('values the front page above a page inside, and the big place above a small one', () => {
    const at = (pageIndex: number, share: number) => slotSignal({ brandId: 'b', pageIndex, pageCount: 8, share, role: 'standard', slotId: 's' }).views;
    expect(at(0, 0.25)).toBeGreaterThan(at(3, 0.25));
    expect(at(3, 0.5)).toBeGreaterThan(at(3, 0.125));
  });

  it('ranks every place 0..1 for the heat map', () => {
    const slots = slotsOf(doc(three, [['x', 'y', 'z'], ['w']]), brand);
    expect(slots).toHaveLength(6);
    expect(Math.min(...slots.map((s) => s.warmth))).toBe(0);
    expect(Math.max(...slots.map((s) => s.warmth))).toBe(1);
    expect(slots.find((s) => s.warmth === 1)!.pageId).toBe('p1');
  });

  it('stops a sold place that is empty or shows another product', () => {
    const at = '2026-09-20T00:00:00.000Z';
    const sold = (slotId: string, offerId: string | null) => ({ id: `b-${slotId}`, pageId: 'p1', slotId, supplier: 'Carlsberg', offerId, price: 1000, note: '', at });
    const d = doc(three, [['x', 'y']], { bookings: [sold('a', 'x'), sold('b', 'z'), sold('c', null)] });
    const ids = bookingFindings(d).map((f) => f.id);
    expect(ids).toEqual(['solgt:b-b:vare', 'solgt:b-c:tom']);
  });
});

describe('a household\'s order', () => {
  it('keeps the front page first and puts what they buy before what they do not', () => {
    const offers = [
      offer({ id: 'forside', name: 'Kaffe' }),
      offer({ id: 'vin', name: 'Rødvin', category: 'vin' }),
      offer({ id: 'maelk', name: 'Letmælk', category: 'mejeri' }),
    ];
    const d = doc(offers, [['forside'], ['vin'], ['maelk']]);
    const family = HOUSEHOLDS.find((h) => h.id === 'familie')!;
    expect(orderFor(d, family).map((p) => p.id)).toEqual(['p1', 'p3', 'p2']);
    expect(orderFor(d, null).map((p) => p.id)).toEqual(['p1', 'p2', 'p3']);
  });
});
