import type { PageDecoration, PageNote } from '@incitio/schema';

/**
 * Pixel-exact placement — the arithmetic behind the "Mål" panel.
 *
 * A page is measured in the pixels the chain's CMS uses: 600 wide, as
 * the publications are set (an imported publication in its own sheet's
 * points, which are the same 600 × 1000). Everything that can be placed
 * — a picture, free text, an element of a published page, a box in a
 * tile — is read as one box in those pixels and written back from one.
 *
 * Pure: the DOM is read in `Measure.tsx`; this is what is done with it.
 */

/** The width a page is measured in when it has no sheet of its own. */
export const PAGE_PX = 600;

export interface Box { x: number; y: number; w: number; h: number }
export interface PagePx { w: number; h: number }

/** The four distances to the page's edges — what the CMS calls the margin. */
export function marginsOf(box: Box, page: PagePx): { left: number; top: number; right: number; bottom: number } {
  return { left: box.x, top: box.y, right: page.w - box.x - box.w, bottom: page.h - box.y - box.h };
}

export type Field = 'x' | 'y' | 'w' | 'h' | 'right' | 'bottom';

/**
 * The box after one field is set to a value.
 *
 * Width and height keep the top-left corner where it is, as in every
 * image editor; with the ratio locked the other side follows. The right
 * and bottom margins move the box and keep its size — "20 px from the
 * right edge" is a place, not a size.
 */
export function withField(box: Box, field: Field, value: number, page: PagePx, locked: boolean): Box {
  const ratio = box.h > 0 ? box.w / box.h : 1;
  switch (field) {
    case 'x': return { ...box, x: value };
    case 'y': return { ...box, y: value };
    case 'right': return { ...box, x: page.w - box.w - value };
    case 'bottom': return { ...box, y: page.h - box.h - value };
    case 'w': {
      const w = Math.max(1, value);
      return { ...box, w, h: locked ? w / ratio : box.h };
    }
    case 'h': {
      const h = Math.max(1, value);
      return { ...box, h, w: locked ? h * ratio : box.w };
    }
  }
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * A picture on the page, set to a box.
 *
 * Written as a measured `rect` — the form a picture read off a printed
 * page already has — with the nudge folded in, so the box is exactly
 * where the numbers say whatever corner it was pinned to before. The
 * renderer fits the picture inside the box, so a box of the picture's
 * own proportions is the picture.
 */
export function decorToBox(box: Box, page: PagePx): Partial<PageDecoration> {
  return {
    rect: {
      x: clamp(box.x / page.w, -0.5, 1.5),
      y: clamp(box.y / page.h, -0.5, 1.5),
      w: clamp(box.w / page.w, 0.01, 2),
      h: clamp(box.h / page.h, 0.01, 2),
    },
    offsetX: 0,
    offsetY: 0,
    scale: clamp(box.w / page.w, 0.05, 0.6),
  };
}

/** Free text set to a box. Its height only when it has a backing; otherwise the words decide it. */
export function noteToBox(note: Pick<PageNote, 'h' | 'background' | 'image'>, box: Box, page: PagePx): Partial<PageNote> {
  const boxed = note.h !== null && (note.background !== null || note.image !== null);
  return {
    x: clamp(box.x / page.w, -0.5, 1.5),
    y: clamp(box.y / page.h, -0.5, 1.5),
    w: clamp(box.w / page.w, 0.02, 2),
    ...(boxed ? { h: clamp(box.h / page.h, 0.01, 2) } : {}),
  };
}

/** Whether two boxes are the same to the half pixel — when a correction may stop. */
export function sameBox(a: Box, b: Box, within = 0.5): boolean {
  return Math.abs(a.x - b.x) < within && Math.abs(a.y - b.y) < within
    && Math.abs(a.w - b.w) < within && Math.abs(a.h - b.h) < within;
}
