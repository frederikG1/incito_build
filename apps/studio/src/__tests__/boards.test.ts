import { describe, expect, it } from 'vitest';
import { CatalogDocument, Offer } from '@incitio/schema';
import type { Finding } from '../findings.js';
import { lanesOf, seenOf } from '../approvals.js';
import { signoffOf } from '../signoff-model.js';
import { findOnPages, liveStatus, standIns } from '../live-model.js';
import { kr, when } from '../format.js';

const offer = (over: Partial<Offer> & { id: string }): Offer => Offer.parse({
  name: `vare ${over.id}`,
  price: 20,
  quantity: { size: 1, unit: 'pcs' },
  validFrom: '2026-09-21',
  validTo: '2026-09-27',
  ...over,
});

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

const stop = (id: string, kind: Finding['kind'] = 'plads'): Finding =>
  ({ id, kind, said: id, pageId: 'p1', pageNumber: 1, offerId: null, weight: 'stop' });

const four = [offer({ id: 'x' }), offer({ id: 'y', brand: 'Arla' }), offer({ id: 'z' }), offer({ id: 'w' })];

describe('Godkend as data', () => {
  it('lists only checks with something to do, and folds the rest into one line each', () => {
    const d = doc(four, [['x', 'y']]);
    const model = signoffOf(d, [stop('tom plads')], lanesOf(d), []);
    expect(model.open.map((b) => b.key)).toEqual(['tryk']);
    expect(model.clean.map((b) => b.key)).toEqual(['pris', 'solgt', 'ændret']);
    expect(model.waiting).toBe(1);
  });

  it('says why publishing is off: stops before signatures', () => {
    const d = doc(four, [['x']]);
    expect(signoffOf(d, [stop('a')], lanesOf(d), []).blockedBy).toBe('1 skal rettes først');
    expect(signoffOf(d, [], lanesOf(d), []).blockedBy).toMatch(/^Mangler /);
  });

  it('lets a print check go: it stops nothing and waits, folded away, to be taken back', () => {
    const d = { ...doc(four, [['x']]), ignored: ['a'] };
    const model = signoffOf(d, [stop('a'), stop('b')], lanesOf(d), []);
    expect(model.blockedBy).toBe('1 skal rettes først');
    const tryk = model.listed.find((b) => b.key === 'tryk')!;
    expect(tryk.lines.map((l) => l.id)).toEqual(['b']);
    expect(tryk.ignored.map((l) => l.id)).toEqual(['a']);
    const quiet = signoffOf(d, [stop('a')], lanesOf(d), []);
    expect(quiet.clean.find((b) => b.key === 'tryk')!.clean).toBe('1 ignoreret, resten er i orden');
    expect(quiet.listed.map((b) => b.key)).toEqual(['tryk']);
  });

  it('lets an avis with every signature and no stops go out', () => {
    const d = doc(four, [['x']]);
    const at = '2026-09-20T08:00:00.000Z';
    const signedDoc = { ...d, approvals: lanesOf(d).map((lane) => ({ role: lane.role, who: 'Ida', at, seen: seenOf(d) })) };
    expect(signoffOf(signedDoc, [], lanesOf(signedDoc), []).blockedBy).toBeNull();
  });
});

describe('Live as data', () => {
  const at = '2026-09-22T10:00:00.000Z';
  const event = (over: Record<string, unknown>) => ({ id: String(Math.random()), at, substituteId: null, before: null, after: null, who: '', ...over });

  it('marks a sold-out without a stand-in, and the stand-in instead of the one it covers', () => {
    const d = doc(four, [['x', 'y']], {
      live: [event({ kind: 'udsolgt', offerId: 'x' }), event({ kind: 'udsolgt', offerId: 'y', substituteId: 'z' })] as never,
    });
    const { soldOut, marks } = liveStatus(d);
    expect([...soldOut].sort()).toEqual(['x', 'y']);
    expect(marks.get('x')).toBe('Udsolgt');
    expect(marks.has('y')).toBe(false);
    expect(marks.get('z')).toBe('I stedet for vare y');
  });

  it('clears both when the product is back', () => {
    const d = doc(four, [['y']], {
      live: [event({ kind: 'udsolgt', offerId: 'y', substituteId: 'z' }), event({ kind: 'tilbage', offerId: 'y' })] as never,
    });
    const { soldOut, marks } = liveStatus(d);
    expect(soldOut.size).toBe(0);
    expect(marks.size).toBe(0);
  });

  it('finds only products on a page, and offers only the reserve as stand-ins', () => {
    const d = doc(four, [['x', 'y']]);
    expect(findOnPages(d, 'arla').map((o) => o.id)).toEqual(['y']);
    expect(findOnPages(d, 'vare w')).toEqual([]);
    expect(standIns(d, four[0]!, new Set()).map((o) => o.id).sort()).toEqual(['w', 'z']);
  });
});

describe('format', () => {
  it('prints prices and days as the boards say them', () => {
    expect(kr(25)).toBe('25,-');
    expect(kr(37.95)).toBe('37,95');
    expect(when('2026-09-22T09:14:00', new Date('2026-09-22T18:00:00'))).toMatch(/^i dag /);
    expect(when('2026-09-21T09:14:00', new Date('2026-09-22T18:00:00'))).toMatch(/^i går /);
  });
});
