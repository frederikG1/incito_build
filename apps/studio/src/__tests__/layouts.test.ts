import { describe, expect, it } from 'vitest';
import { validateTemplate } from '@incitio/schema';
import { STANDARD_COUNTS, standardLayouts } from '../layouts.js';

describe('the standard layouts', () => {
  for (const count of STANDARD_COUNTS) {
    it(`gives ${count} products one to three clean shapes`, () => {
      const layouts = standardLayouts(count);
      expect(layouts.length).toBeGreaterThanOrEqual(1);
      expect(layouts.length).toBeLessThanOrEqual(3);
      for (const layout of layouts) {
        expect(validateTemplate(layout)).toEqual([]);
        expect(layout.slots).toHaveLength(count);
        // No holes: every cell of the grid belongs to a product.
        expect(layout.areas.join(' ').split(' ')).not.toContain('.');
      }
    });
  }

  it('gives the lead of a lead-on-top layout half the page', () => {
    const top = standardLayouts(5).find((t) => t.id.endsWith('/top'))!;
    const leadRows = top.areas.filter((row) => row.split(' ').every((cell) => cell === 'a')).length;
    expect(leadRows * 2).toBe(top.areas.length);
  });
});
