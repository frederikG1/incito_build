import { describe, expect, it } from 'vitest';
import { sharing } from '../LayoutEditor.js';

// Four cells in two by two, one alley apart — the page in the recording.
const cells = [
  { id: 'a', rect: { x: 0.03, y: 0.03, w: 0.46, h: 0.46 } },
  { id: 'b', rect: { x: 0.504, y: 0.03, w: 0.466, h: 0.46 } },
  { id: 'c', rect: { x: 0.03, y: 0.504, w: 0.46, h: 0.466 } },
  { id: 'd', rect: { x: 0.504, y: 0.504, w: 0.466, h: 0.466 } },
];
const others = (id: string) => cells.filter((c) => c.id !== id);
const rect = (id: string) => cells.find((c) => c.id === id)!.rect;

describe('an edge two cells share', () => {
  it('is the neighbour across the alley, beside the cell, not past its corner', () => {
    expect(sharing(rect('d'), 'w', others('d'))).toEqual(['c']);
    expect(sharing(rect('d'), 'n', others('d'))).toEqual(['b']);
    expect(sharing(rect('c'), 'e', others('c'))).toEqual(['d']);
    expect(sharing(rect('a'), 's', others('a'))).toEqual(['c']);
  });

  it('is nobody on the page\'s outer edge', () => {
    expect(sharing(rect('d'), 'e', others('d'))).toEqual([]);
    expect(sharing(rect('d'), 's', others('d'))).toEqual([]);
  });

  it('is every cell along it when one cell spans two', () => {
    const tall = { x: 0.03, y: 0.03, w: 0.46, h: 0.94 };
    expect(sharing(tall, 'e', [cells[1]!, cells[3]!]).sort()).toEqual(['b', 'd']);
  });
});
