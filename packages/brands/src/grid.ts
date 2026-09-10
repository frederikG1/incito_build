import { PageTemplate, SlotRole, validateTemplate } from '@incitio/schema';

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
