import { describe, expect, it } from 'vitest';
import type { PageTemplate } from '@incitio/schema';
import { slotAspect, slotArea, slotRect, slotsOverlap, validateTemplate } from '../geometry.js';
import { AUTHORED_TEMPLATES } from '../templates.js';

function template(slots: PageTemplate['slots']): PageTemplate {
  return {
    id: 't',
    name: 't',
    grid: { cols: 12, rows: 12, gutter: 0 },
    slots,
    provenance: { source: 'authored', catalogId: '', pageNumber: 0 },
  };
}

const slot = (id: string, x: number, y: number, w: number, h: number) => ({
  id, x, y, w, h,
  role: 'standard' as const,
  preferredAspect: 1,
  textCapacity: 40,
  promotesTo: [] as string[],
});

describe('slotAspect', () => {
  // The page's own proportions have to enter the calculation, or every
  // aspect-fit score on a portrait page is wrong by a constant factor.
  it('accounts for the page aspect ratio', () => {
    const t = template([slot('a', 0, 0, 6, 6)]);
    expect(slotAspect(t.slots[0]!, t, 0.707)).toBeCloseTo(0.707, 5);
  });

  it('reports a wide slot as wide', () => {
    const t = template([slot('a', 0, 0, 12, 4)]);
    expect(slotAspect(t.slots[0]!, t, 0.707)).toBeCloseTo(2.121, 3);
  });
});

describe('slotArea', () => {
  it('reports the fraction of the page covered', () => {
    const t = template([slot('a', 0, 0, 6, 6)]);
    expect(slotArea(t.slots[0]!, t)).toBeCloseTo(0.25, 6);
  });
});

describe('slotRect', () => {
  it('spans the full page when the slot fills the grid and there is no gutter', () => {
    const t = template([slot('a', 0, 0, 12, 12)]);
    expect(slotRect(t.slots[0]!, t)).toEqual({ left: 0, top: 0, width: 100, height: 100 });
  });

  it('insets each edge by half a gutter so neighbours share the gap', () => {
    const t = { ...template([slot('a', 0, 0, 6, 12)]), grid: { cols: 12, rows: 12, gutter: 0.04 } };
    const rect = slotRect(t.slots[0]!, t);
    // Half of 0.04 cell-widths, one cell being 100/12 %.
    expect(rect.left).toBeCloseTo(0.1667, 3);
    expect(rect.width).toBeCloseTo(49.667, 3);
  });
});

describe('slotsOverlap', () => {
  it('does not treat shared edges as overlap', () => {
    expect(slotsOverlap(slot('a', 0, 0, 6, 6), slot('b', 6, 0, 6, 6))).toBe(false);
  });

  it('detects real overlap', () => {
    expect(slotsOverlap(slot('a', 0, 0, 6, 6), slot('b', 5, 5, 6, 6))).toBe(true);
  });
});

describe('validateTemplate', () => {
  it('rejects a slot extending past the grid', () => {
    const errors = validateTemplate(template([slot('a', 8, 0, 6, 6)]));
    expect(errors[0]).toContain('outside');
  });

  it('rejects overlapping slots', () => {
    const errors = validateTemplate(template([slot('a', 0, 0, 6, 6), slot('b', 3, 3, 6, 6)]));
    expect(errors.some((e) => e.includes('overlap'))).toBe(true);
  });

  it('rejects a promotion target that does not exist', () => {
    const t = template([{ ...slot('a', 0, 0, 6, 6), promotesTo: ['nope'] }]);
    expect(validateTemplate(t).some((e) => e.includes('unknown slot'))).toBe(true);
  });

  // The library is data, and broken data here produces silently ugly
  // pages rather than a crash — so it is asserted rather than trusted.
  it.each(AUTHORED_TEMPLATES.map((t) => [t.id, t] as const))(
    'authored template %s is internally consistent',
    (_id, t) => {
      expect(validateTemplate(t)).toEqual([]);
    },
  );
});
