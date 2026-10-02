import { describe, expect, it } from 'vitest';
import { decorToBox, marginsOf, noteToBox, withField } from '../box.js';

const page = { w: 600, h: 1000 };
const box = { x: 100, y: 200, w: 300, h: 150 };

describe('a box in pixels', () => {
  it('states its distance to every edge', () => {
    expect(marginsOf(box, page)).toEqual({ left: 100, top: 200, right: 200, bottom: 650 });
  });

  it('resizes from the top-left corner, the other side following when locked', () => {
    expect(withField(box, 'w', 600, page, true)).toEqual({ x: 100, y: 200, w: 600, h: 300 });
    expect(withField(box, 'h', 75, page, true)).toEqual({ x: 100, y: 200, w: 150, h: 75 });
    expect(withField(box, 'w', 600, page, false)).toEqual({ x: 100, y: 200, w: 600, h: 150 });
  });

  it('a right or bottom margin moves the box and keeps its size', () => {
    expect(withField(box, 'right', 20, page, true)).toEqual({ x: 280, y: 200, w: 300, h: 150 });
    expect(withField(box, 'bottom', 0, page, true)).toEqual({ x: 100, y: 850, w: 300, h: 150 });
  });

  it('a picture becomes a measured box, its nudge folded in', () => {
    expect(decorToBox(box, page)).toEqual({ rect: { x: 1 / 6, y: 0.2, w: 0.5, h: 0.15 }, offsetX: 0, offsetY: 0, scale: 0.5 });
  });

  it('free text takes a height only when it has a backing', () => {
    expect(noteToBox({ h: null, background: null, image: null }, box, page)).toEqual({ x: 1 / 6, y: 0.2, w: 0.5 });
    expect(noteToBox({ h: 0.1, background: '#fff', image: null }, box, page)).toMatchObject({ h: 0.15 });
  });
});
