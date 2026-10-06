import { describe, expect, it } from 'vitest';
import { formatRoute, parseRoute } from '../route.js';

describe('route', () => {
  it('round-trips a page link', () => {
    const route = { brandId: 'superbrugsen', docId: 'superbrugsen-2026-u40', view: 'side' as const, pageId: 'p 6' };
    expect(formatRoute(route)).toBe('#/superbrugsen/superbrugsen-2026-u40/side/p%206');
    expect(parseRoute(formatRoute(route))).toEqual(route);
  });

  it('reads the front page, a bare avis and nonsense', () => {
    expect(parseRoute('#/netto')).toEqual({ brandId: 'netto', docId: null, view: 'hjem', pageId: null });
    expect(parseRoute('#/netto/n1')).toMatchObject({ docId: 'n1', view: 'bog' });
    expect(parseRoute('#/netto/n1/whatever/x')).toMatchObject({ view: 'bog', pageId: null });
    expect(parseRoute('')).toEqual({ brandId: null, docId: null, view: null, pageId: null });
  });

  it('writes the front page without an avis', () => {
    expect(formatRoute({ brandId: 'netto', docId: 'n1', view: 'hjem', pageId: null })).toBe('#/netto');
  });

  it('addresses the chain’s designs without an avis', () => {
    expect(parseRoute('#/superbrugsen/varedesigns')).toEqual({ brandId: 'superbrugsen', docId: null, view: 'varedesigns', pageId: null, designId: null });
    const one = { brandId: 'superbrugsen', docId: null, view: 'varedesigns' as const, pageId: null, designId: 'UHXU-5i5' };
    expect(formatRoute(one)).toBe('#/superbrugsen/varedesigns/UHXU-5i5');
    expect(parseRoute(formatRoute(one))).toEqual(one);
  });
});
