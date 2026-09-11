import { z } from 'zod';

/**
 * What a slot is *for*, not how big it is. The curator reasons in roles
 * ("this offer leads the page"), the template decides what a role looks
 * like, and the stylesheet decides how it is drawn. Keeping the three
 * apart is what lets one brand render a hero as a full-bleed photo and
 * another as a plain large tile without either touching the curator.
 */
export const SlotRole = z.enum(['hero', 'feature', 'standard', 'compact']);
export type SlotRole = z.infer<typeof SlotRole>;

export const TemplateSlot = z.object({
  /** Also the CSS grid-area name, so `areas` below can refer to it. */
  id: z.string().min(1).regex(/^[a-z][a-z0-9]*$/, 'must be a CSS ident'),
  role: SlotRole,
  /**
   * How far this slot's artwork may overrun its own cell, as a scale
   * factor. 1 keeps it inside; 1.25 lets it print a quarter larger and
   * over its neighbours.
   *
   * This is the difference between a generated page and a designed one.
   * Published leaflets do not confine every product to a rectangle: on
   * a Coop page a tray of pålæg sits visibly in front of the pizza
   * above it, and the size difference is what says which offer matters.
   * A grid alone can only ever produce tidy boxes.
   *
   * DELIBERATE, never incidental — it is declared per slot by whoever
   * drew the template, and only the artwork moves. Text and price marks
   * stay in the cell, because a headline printed over a neighbour's
   * headline is not a design, it is a collision.
   */
  bleed: z.number().min(1).max(1.6).default(1),
});
export type TemplateSlot = z.infer<typeof TemplateSlot>;

/**
 * One page layout, expressed as a CSS grid.
 *
 * `areas` is literally what goes into `grid-template-areas` — one string
 * per row, cell names separated by spaces. That makes a template
 * something a designer can read and edit, and it makes the renderer a
 * thin translation rather than a second layout engine: no pixel maths,
 * no solver, no scoring. The browser does the layout, which is also what
 * makes the same markup print correctly to PDF.
 */
export const PageTemplate = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  areas: z.array(z.string().min(1)).min(1),
  slots: z.array(TemplateSlot).min(1),
});
export type PageTemplate = z.infer<typeof PageTemplate>;

/** How many offers a template holds. Derived, never stored. */
export function templateCapacity(template: PageTemplate): number {
  return template.slots.length;
}

/**
 * Checks a template against its own grid before it can be used.
 *
 * A template is data, so it can be wrong: a slot with no cell is invisible
 * and a cell naming no slot throws off the whole grid. Both are silent at
 * runtime — the page just renders short — so they are caught at load.
 */
export function validateTemplate(template: PageTemplate): string[] {
  const problems: string[] = [];
  const width = template.areas[0]!.trim().split(/\s+/).length;

  template.areas.forEach((row, index) => {
    const cells = row.trim().split(/\s+/).length;
    if (cells !== width) {
      problems.push(`row ${index} has ${cells} cells, expected ${width}`);
    }
  });

  const named = new Set(template.areas.flatMap((row) => row.trim().split(/\s+/)));
  named.delete('.');
  const declared = new Set(template.slots.map((s) => s.id));

  for (const slot of declared) {
    if (!named.has(slot)) problems.push(`slot "${slot}" has no cell in the grid`);
  }
  for (const cell of named) {
    if (!declared.has(cell)) problems.push(`grid cell "${cell}" has no slot`);
  }
  return problems;
}

/**
 * How eagerly a slot wants the strongest offer. Assignment walks the
 * slots in this order and hands out offers in the order the plan gave
 * them, so the page's lead offer lands in the page's lead slot without
 * any scoring, search or geometry.
 */
const ROLE_ORDER: Record<SlotRole, number> = {
  hero: 0,
  feature: 1,
  standard: 2,
  compact: 3,
};

/**
 * Slots in assignment order.
 *
 * Sorted by role, then by where the slot appears in the template's own
 * declaration — which is reading order, since a template is authored as
 * its grid drawing. That keeps a page's second-strongest offer in the
 * top-left standard slot rather than wherever the array happened to put
 * it.
 *
 * It lives here rather than in the composer because the editor re-seats
 * pages too: changing a page's layout by hand has to put the offers
 * back in the same order the composer would have, or the same page
 * would rank its offers one way when generated and another way when
 * someone picked the identical template from a menu.
 */
export function slotAssignmentOrder(template: PageTemplate): TemplateSlot[] {
  return template.slots
    .map((slot, index) => ({ slot, index }))
    .sort((a, b) => {
      const byRole = ROLE_ORDER[a.slot.role] - ROLE_ORDER[b.slot.role];
      return byRole !== 0 ? byRole : a.index - b.index;
    })
    .map((entry) => entry.slot);
}
