import { OFFER_GRID_PREFIX, offerGridTemplates, PageTemplate, SlotRole, validateTemplate, type PageTemplateLike } from '@incitio/schema';

/**
 * A slot's role, optionally with how far its artwork may overrun the
 * cell: `'hero'`, or `['hero', 1.25]` to let it print over neighbours.
 */
export type SlotSpec = SlotRole | [SlotRole, number];

/**
 * Author a page template from its grid drawing.
 *
 * `areas` is the drawing itself — one string per row — so a template is
 * legible as the thing it produces:
 *
 *     ['hero hero a',
 *      'hero hero b',
 *      'c    d    e']
 *
 * `roles` names every cell and says what it is for. The two are checked
 * against each other at module load, so a template with a stray cell or
 * an unplaced slot fails on startup rather than rendering a short page.
 */
export function template(
  id: string,
  name: string,
  areas: string[],
  roles: Record<string, SlotSpec>,
): PageTemplate {
  const built = PageTemplate.parse({
    id,
    name,
    // Collapse authoring whitespace: templates are written with the cells
    // aligned in columns to make the shape readable in source.
    areas: areas.map((row) => row.trim().replace(/\s+/g, ' ')),
    slots: Object.entries(roles).map(([slotId, spec]) => (
      Array.isArray(spec)
        ? { id: slotId, role: spec[0], bleed: spec[1] }
        : { id: slotId, role: spec }
    )),
  });

  const problems = validateTemplate(built);
  if (problems.length > 0) {
    throw new Error(`template "${id}" is malformed: ${problems.join('; ')}`);
  }
  return built;
}

/**
 * The CMS's offer grids as one chain's own layouts.
 *
 * For a chain whose pages are made in Tjek's CMS the section designs
 * decide where offers stand, and an offer grid is the closest
 * CSS-grid shape. Renamed into the chain's namespace — one chain's
 * templates never appear in another's set — and the lead layouts let
 * their A offer break out of its cell, as a "1prio" box does.
 */
export function cmsGridTemplates(brandId: string): PageTemplateLike[] {
  return offerGridTemplates(1, 8).map((t) => ({
    ...t,
    id: t.id.replace(OFFER_GRID_PREFIX, `${brandId}/`),
    slots: t.slots.map((s) => (s.role === 'hero' && t.id.includes('lead') ? { ...s, bleed: 1.06 } : s)),
  }));
}
