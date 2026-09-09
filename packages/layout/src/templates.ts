import type { PageTemplate, SlotRole, TemplateLibrary, TemplateSlot } from '@incitio/schema';

function slot(
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  role: SlotRole,
  preferredAspect: number,
  textCapacity: number,
  promotesTo: string[] = [],
): TemplateSlot {
  return { id, x, y, w, h, role, preferredAspect, textCapacity, promotesTo };
}

function authored(
  id: string,
  name: string,
  cols: number,
  rows: number,
  slots: TemplateSlot[],
): PageTemplate {
  return {
    id,
    name,
    grid: { cols, rows, gutter: 0.06 },
    slots,
    provenance: { source: 'authored', catalogId: '', pageNumber: 0 },
  };
}

/**
 * A deliberately small hand-authored library covering the page shapes that
 * appear in nearly every retail leaflet: a dominant hero with supporting
 * tiles, and even grids at three densities.
 *
 * This exists so the pipeline can be built and verified before any mining
 * has run (M0). At M2 the mined library supersedes it — see loadLibrary.
 */
export const AUTHORED_TEMPLATES: PageTemplate[] = [
  authored('authored/hero-left', 'Hero left with three below', 12, 12, [
    slot('hero', 0, 0, 7, 7, 'hero', 1.0, 64, []),
    slot('side-top', 7, 0, 5, 3, 'standard', 1.4, 38, ['hero']),
    slot('side-bottom', 7, 3, 5, 4, 'standard', 1.1, 38, ['hero']),
    slot('foot-a', 0, 7, 4, 5, 'standard', 0.85, 34, []),
    slot('foot-b', 4, 7, 4, 5, 'standard', 0.85, 34, []),
    slot('foot-c', 8, 7, 4, 5, 'standard', 0.85, 34, []),
  ]),

  authored('authored/hero-top', 'Full-width hero banner', 12, 12, [
    slot('hero', 0, 0, 12, 5, 'hero', 2.2, 72, []),
    slot('mid-a', 0, 5, 4, 4, 'standard', 1.0, 36, ['hero']),
    slot('mid-b', 4, 5, 4, 4, 'standard', 1.0, 36, ['hero']),
    slot('mid-c', 8, 5, 4, 4, 'standard', 1.0, 36, ['hero']),
    slot('low-a', 0, 9, 4, 3, 'filler', 1.3, 28, ['mid-a']),
    slot('low-b', 4, 9, 4, 3, 'filler', 1.3, 28, ['mid-b']),
    slot('low-c', 8, 9, 4, 3, 'filler', 1.3, 28, ['mid-c']),
  ]),

  authored('authored/hero-right', 'Hero right with stacked left', 12, 12, [
    slot('hero', 5, 0, 7, 7, 'hero', 1.0, 64, []),
    slot('side-top', 0, 0, 5, 4, 'standard', 1.2, 38, ['hero']),
    slot('side-bottom', 0, 4, 5, 3, 'standard', 1.4, 38, ['hero']),
    slot('foot-a', 0, 7, 6, 5, 'standard', 1.15, 40, []),
    slot('foot-b', 6, 7, 6, 5, 'standard', 1.15, 40, []),
  ]),

  authored('authored/grid-4', 'Four large tiles', 12, 12, [
    slot('a', 0, 0, 6, 6, 'standard', 1.0, 48, []),
    slot('b', 6, 0, 6, 6, 'standard', 1.0, 48, []),
    slot('c', 0, 6, 6, 6, 'standard', 1.0, 48, []),
    slot('d', 6, 6, 6, 6, 'standard', 1.0, 48, []),
  ]),

  authored('authored/grid-6', 'Six tiles, two columns', 12, 12, [
    slot('a', 0, 0, 6, 4, 'standard', 1.3, 40, []),
    slot('b', 6, 0, 6, 4, 'standard', 1.3, 40, []),
    slot('c', 0, 4, 6, 4, 'standard', 1.3, 40, []),
    slot('d', 6, 4, 6, 4, 'standard', 1.3, 40, []),
    slot('e', 0, 8, 6, 4, 'standard', 1.3, 40, []),
    slot('f', 6, 8, 6, 4, 'standard', 1.3, 40, []),
  ]),

  authored('authored/grid-9', 'Nine tiles, dense', 12, 12, [
    slot('a', 0, 0, 4, 4, 'standard', 1.0, 30, []),
    slot('b', 4, 0, 4, 4, 'standard', 1.0, 30, []),
    slot('c', 8, 0, 4, 4, 'standard', 1.0, 30, []),
    slot('d', 0, 4, 4, 4, 'standard', 1.0, 30, []),
    slot('e', 4, 4, 4, 4, 'standard', 1.0, 30, []),
    slot('f', 8, 4, 4, 4, 'standard', 1.0, 30, []),
    slot('g', 0, 8, 4, 4, 'filler', 1.0, 30, []),
    slot('h', 4, 8, 4, 4, 'filler', 1.0, 30, []),
    slot('i', 8, 8, 4, 4, 'filler', 1.0, 30, []),
  ]),
];

export const AUTHORED_LIBRARY: TemplateLibrary = {
  version: '0.1.0-authored',
  templates: AUTHORED_TEMPLATES,
};

/** Templates able to hold exactly `count` offers, cheapest lookup for the paginator. */
export function templatesForCount(library: TemplateLibrary, count: number): PageTemplate[] {
  return library.templates.filter((t) => t.slots.length === count);
}
