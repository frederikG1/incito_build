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

/**
 * A box on the sheet, in shares of it: 0.5 is half the page across.
 *
 * Shares and not points, because everything else in this repo already
 * is — a page is drawn from a thumbnail to A4 out of the same numbers,
 * and a rectangle in the publisher's own units would be the one thing
 * that did not scale with it.
 *
 * Only artwork uses this — see `PageDecoration.rect`. The offers are
 * placed by the grid, deliberately: a template is a layout somebody
 * can fill again, and a page of rectangles read off one printed sheet
 * is not.
 */
export const MeasuredRect = z.object({
  x: z.number().min(-0.5).max(1.5),
  y: z.number().min(-0.5).max(1.5),
  w: z.number().min(0.01).max(2),
  h: z.number().min(0.01).max(2),
});
export type MeasuredRect = z.infer<typeof MeasuredRect>;

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

/** Where one slot sits in its template's grid, and how that cell reads. */
export interface SlotCell {
  /** Grid columns and rows the slot spans. */
  columns: number;
  rows: number;
  /**
   * The cell's width over its height on the printed page, so 2 is a
   * cell twice as wide as it is tall. Ideal rather than measured — it
   * ignores the grid's gap and the page's padding, which shift it by a
   * few percent and never across a threshold.
   */
  aspect: number;
  /**
   * The cell's width as a share of the page's, so 0.25 is a quarter of
   * the sheet.
   *
   * Handed to CSS because type has to know how wide the cell it is set
   * in actually is. `cqw` is the PAGE's width — every measurement in
   * the stylesheet is, deliberately, see the note below — so a price
   * mark sized in `cqh` is the same size in a half-page hero and in a
   * column a sixth of the page wide, where it eats the sentence beside
   * it. This is the missing half of that sum.
   */
  width: number;
  /** Which edges of the grid this cell touches. */
  edges: { top: boolean; right: boolean; bottom: boolean; left: boolean };
}

/**
 * Every slot's cell geometry, derived from the grid drawing.
 *
 * This is static: a template states its own proportions, so the shape
 * of a cell is known before anything is laid out. That matters because
 * the obvious alternative does not work. Asking the browser with a
 * container query means `container-type` on the slot, and a slot that
 * is a size container becomes the nearest container for everything
 * inside it — so every `cqh`/`cqw` in the stylesheet, which is every
 * measurement in the stylesheet, would resolve against the tile rather
 * than against the page. Measured in Chromium: `10cqh` inside a
 * 100px slot on a 566px page goes from 56.6px to 10px. The whole book
 * would shrink to fit its own tiles.
 *
 * So the query is answered here, from the data, and handed to CSS as an
 * attribute. It is also the better answer for print: the value cannot
 * depend on when layout ran.
 */
export function slotCells(template: PageTemplate, pageAspect: number): Map<string, SlotCell> {
  const rows = template.areas.map((row) => row.split(' '));
  const columnCount = rows[0]!.length;
  const rowCount = rows.length;

  const bounds = new Map<string, { x0: number; x1: number; y0: number; y1: number }>();
  rows.forEach((row, y) => row.forEach((id, x) => {
    if (id === '.') return;
    const box = bounds.get(id);
    if (!box) bounds.set(id, { x0: x, x1: x, y0: y, y1: y });
    else {
      box.x0 = Math.min(box.x0, x); box.x1 = Math.max(box.x1, x);
      box.y0 = Math.min(box.y0, y); box.y1 = Math.max(box.y1, y);
    }
  }));

  const cells = new Map<string, SlotCell>();
  for (const [id, box] of bounds) {
    const columns = box.x1 - box.x0 + 1;
    const slotRows = box.y1 - box.y0 + 1;
    cells.set(id, {
      columns,
      rows: slotRows,
      aspect: ((columns / columnCount) * pageAspect) / (slotRows / rowCount),
      width: columns / columnCount,
      edges: {
        top: box.y0 === 0,
        right: box.x1 === columnCount - 1,
        bottom: box.y1 === rowCount - 1,
        left: box.x0 === 0,
      },
    });
  }
  return cells;
}

/**
 * Which way a cell's artwork is allowed to overrun, per side.
 *
 * 1 means "grow this way", 0 means "do not" — read by `.tile__media`,
 * which spends the overrun as a negative margin on the artwork's box.
 *
 * It used to be a transform origin, because the overrun used to be a
 * uniform `scale` on the image. That scale is gone: it grew the artwork
 * downward onto the tile's own product name and upward onto the
 * previous row's, on every cell of every page. See `.tile__media`.
 *
 * Only the horizontal sides, because only they have a choice: an
 * overrun downward always lands on this tile's own product name and an
 * overrun upward on the previous row's, so the vertical growth is the
 * page's alley everywhere and is not a per-cell decision at all.
 *
 * A cell touching the left edge grows right, and vice versa. One
 * touching both is full width and has nowhere to go, so it grows evenly
 * and the page trims it evenly — which is what a printed edge-to-edge
 * photograph does anyway.
 */
export function artworkGrowth(cell: SlotCell | undefined): { left: 0 | 1; right: 0 | 1 } {
  if (!cell) return { left: 1, right: 1 };
  /*
   * A cell taller than one row grows sideways into nothing.
   *
   * Sideways is normally the free direction: the tile beside this one
   * is a tile of the same height, so its artwork band lines up with
   * ours and its words are below both of us. A cell spanning two rows
   * breaks that — it stands beside a whole extra tile, and that tile's
   * product name sits squarely in the band this one's artwork occupies.
   * Measured on three imported pages: a two-row lead printed 9px into
   * its neighbour's headline, on every one of them.
   */
  if (cell.rows > 1) return { left: 0, right: 0 };
  /*
   * A cell touching both rims is already the full width of the grid.
   * Growing it sideways cannot reveal more product — `.page` clips, so
   * the only thing past the rim is trim. Measured on a full-page offer:
   * 45px of packshot cut off each side for nothing.
   */
  const { left, right } = cell.edges;
  if (left && right) return { left: 0, right: 0 };
  if (!left && !right) return { left: 1, right: 1 };
  return { left: left ? 0 : 1, right: right ? 0 : 1 };
}

/**
 * Above this a cell is wide enough to print as a band — artwork on the
 * left, words stacked beside it.
 *
 * Measured across 21 layouts read off SuperBrugsen's own week-37 book
 * (`npm run derive:templates`): of 97 slots only the `feature` ones
 * ever fall outside what the stylesheet draws, and they split cleanly.
 * The two genuine bands sit at 2.12; the next widest thing the chain
 * calls a feature is a half-width panel at 1.41, and it goes down to a
 * 0.24 column running the full height of the page beside three
 * offers. 1.6 is the gap between those two groups.
 */
export const BAND_ASPECT = 1.6;

/** How a slot's cell should be drawn: a wide band, or an upright panel. */
export function slotShape(cell: SlotCell | undefined): 'band' | 'panel' {
  return (cell?.aspect ?? 1) >= BAND_ASPECT ? 'band' : 'panel';
}

/**
 * Under this share of the sheet's width a cell cannot carry its price
 * mark beside the words.
 *
 * Half the sheet, and the line was moved out to here twice. At a third
 * a disc left "Den Grønne Slagter pålæg eller kalkunbacon" two
 * characters to a line. At a half — a nemlig hero, 367px wide and 698
 * tall — the mark and its "SPAR 5,00" took 48% of the width and set
 * "Vindheks - Calocephalus" as "Vind- heks -…". Both were measured on
 * the render, not reasoned about: what a mark costs the words is its
 * own width against the cell's, and only the second number is known
 * here.
 *
 * Above this the two stand side by side and end on one line; below it
 * the mark stands ON the words instead, which costs the sentence
 * nothing because it leans over the artwork. Either way they are one
 * block — see `.tile__info`.
 */
export const LOCKUP_WIDTH = 0.55;

/**
 * Whether this cell has room for the number BESIDE the words.
 *
 * Aspect says whether a cell is wide FOR ITS HEIGHT; this says whether
 * it is wide at all, and they are not the same question — a band a
 * quarter of the page wide is still a quarter of the page wide. See
 * `.tile__info`, which lays the two arrangements out.
 */
export function slotRoom(cell: SlotCell | undefined): 'wide' | 'tight' {
  return (cell?.width ?? 1) >= LOCKUP_WIDTH ? 'wide' : 'tight';
}
