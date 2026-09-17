/**
 * Making room on a page for one more product.
 *
 * The editor used to change how many offers a page carries in exactly
 * one way: pick a number, and the chain's own layout at that number
 * replaces the one the page is on. That is right for a page sitting on
 * a shape somebody drew for the chain, and it is no help at all for the
 * two kinds of page this studio now also makes — one read off a
 * published leaflet, one read off a drawing — because their layouts
 * describe ONE sheet and the chain has nothing else at that count.
 *
 * So there is a second way, used only when the first cannot apply: the
 * page's own grid grows a cell. A template that came with the document
 * is the document's to edit; the chain's own set is never touched.
 *
 * Pure functions on plain data, in their own file, because this is the
 * part of "add a product" that is arithmetic and the part worth having
 * tests for.
 */
import {
  slotAssignmentOrder, validateTemplate,
  type CatalogPage, type PageTemplate, type SlotRole, type TemplateSlot,
} from '@incitio/schema';

/** Grid names, and the order new ones are handed out in. */
const NAMES = 'abcdefghijklmnopqrstuvwxyz';

/**
 * A ceiling on how tall a grown grid may get.
 *
 * Rows are `1fr`, so every row added makes every tile on the page
 * shorter. Past this the page has stopped being a leaflet page and the
 * honest answer is another page, not another row.
 */
export const MAX_ROWS = 14;

/** Slots this template has that no placement is sitting in. */
export function freeSlots(page: CatalogPage, template: PageTemplate): TemplateSlot[] {
  const taken = new Set(page.placements.map((placement) => placement.slotId));
  // Assignment order, so the first product added lands in the most
  // prominent empty cell rather than in whichever one was declared first.
  return slotAssignmentOrder(template).filter((slot) => !taken.has(slot.id));
}

/** The first cell in reading order that no slot has claimed. */
function firstFree(grid: string[][]): { row: number; column: number } | null {
  for (let row = 0; row < grid.length; row += 1) {
    for (let column = 0; column < grid[row]!.length; column += 1) {
      if (grid[row]![column] === '.') return { row, column };
    }
  }
  return null;
}

/** The next unused grid name — `a`, `b`, … then `a1`, `b1`, … */
function nextName(used: Set<string>): string {
  for (let round = 0; round < 40; round += 1) {
    for (const letter of NAMES) {
      const id = round === 0 ? letter : `${letter}${round}`;
      if (!used.has(id)) return id;
    }
  }
  throw new Error('siden har ikke flere pladsnavne');
}

/**
 * What a cell added by hand is FOR.
 *
 * `standard` — one of the others, until somebody says otherwise. A role
 * is a claim about prominence, and adding a product to a page is not a
 * claim about it; promoting one is a separate, deliberate act, and the
 * inspector has a button for it ("Sæt i fokus").
 *
 * Especially not `feature`. That is a chain's editorial band rather
 * than a size — SuperBrugsen prints it as a red panel with inverted
 * type — and a cell that got it for being large enough put a red box
 * around a product nobody had made an editorial decision about.
 */
const NEW_CELL_ROLE: SlotRole = 'standard';

/**
 * The same template with `extra` more cells, and the ids of the new ones.
 *
 * One cell at a time, in reading order, and a new row only when there is
 * no free cell left. Deliberately not "find the largest empty rectangle
 * and take it": on a page with one hole that rule gives the newcomer the
 * hole, and on an empty row it gives one product the entire row. A
 * single cell is the answer that is the same every time and the one a
 * person can predict before they click.
 *
 * Null when the grid would have to grow past what a sheet can carry.
 */
export function growTemplate(
  template: PageTemplate,
  extra: number,
  id: string,
): { template: PageTemplate; added: string[] } | null {
  const grid = template.areas.map((row) => row.trim().split(/\s+/));
  const columns = grid[0]?.length ?? 0;
  if (columns === 0 || extra <= 0) return null;

  const used = new Set(grid.flat().filter((cell) => cell !== '.'));
  const slots = [...template.slots];
  const added: string[] = [];

  for (let n = 0; n < extra; n += 1) {
    let at = firstFree(grid);
    if (!at) {
      if (grid.length >= MAX_ROWS) return null;
      grid.push(new Array<string>(columns).fill('.'));
      at = firstFree(grid)!;
    }
    const name = nextName(used);
    used.add(name);
    added.push(name);
    grid[at.row]![at.column] = name;
    slots.push({ id: name, role: NEW_CELL_ROLE, bleed: 1 });
  }

  const grown: PageTemplate = {
    id,
    name: `${template.name} +${extra}`,
    areas: grid.map((row) => row.join(' ')),
    slots,
  };
  // A grid that would not render is not an improvement on a full page.
  return validateTemplate(grown).length === 0 ? { template: grown, added } : null;
}

/**
 * A template id that is this page's own.
 *
 * Grown templates are document data — see `CatalogDocument.templates` —
 * so the id has to be unique within the document and stable enough that
 * growing twice does not collide. The count is in the name because it is
 * the thing that changed.
 */
export function grownId(pageId: string, slots: number): string {
  return `grown/${pageId}/${slots}`;
}
