import { describe, expect, it } from 'vitest';
import { Brand, brandCssVars, pageGround } from '../brand.js';

const base = {
  id: 'x',
  name: 'X',
  tokens: {
    brand: '#e2001a', accent: '#ffe88a', ground: '#fff1b8',
    ink: '#1a1a1a', priceInk: '#ffffff',
    headingFont: 'Inter', bodyFont: 'Inter',
  },
  templates: [{
    id: 'x/one', name: 'One',
    areas: ['a'],
    slots: [{ id: 'a', role: 'hero' as const }],
  }],
};

describe('pageGround', () => {
  it('uses the single ground token when no palette is set', () => {
    const brand = Brand.parse(base);
    expect(pageGround(brand, 0)).toBe('#fff1b8');
    expect(pageGround(brand, 7)).toBe('#fff1b8');
  });

  it('rotates through the palette, one ground per page', () => {
    const brand = Brand.parse({ ...base, groundTints: ['#aaaaaa', '#bbbbbb', '#cccccc'] });
    expect([0, 1, 2, 3].map((i) => pageGround(brand, i)))
      .toEqual(['#aaaaaa', '#bbbbbb', '#cccccc', '#aaaaaa']);
  });

  it('handles a negative index rather than returning undefined', () => {
    const brand = Brand.parse({ ...base, groundTints: ['#aaaaaa', '#bbbbbb'] });
    expect(pageGround(brand, -1)).toBe('#bbbbbb');
  });

  it('puts the page ground on the custom property, not the brand token', () => {
    const brand = Brand.parse({ ...base, groundTints: ['#aaaaaa', '#bbbbbb'] });
    expect(brandCssVars(brand, 1)['--ground']).toBe('#bbbbbb');
  });
});
