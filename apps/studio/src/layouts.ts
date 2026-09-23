import type { PageTemplate, SlotRole, TemplateSlot } from '@incitio/schema';

/**
 * A small, fixed set of layouts that always work.
 *
 * The chain's own list had grown to dozens per count — every grid ever
 * read off a printed page — and many of them had holes, slivers and cells
 * too small for a product. Shown as a menu that is not a choice, it is a
 * trap. These are generated instead, three shapes a leaflet actually
 * uses, and every one fills the page with cells of sensible size:
 *
 *   - even: the products in equal cells;
 *   - lead on top: one big cell across the top, the rest beneath;
 *   - lead on the left: one tall cell, the rest stacked beside it.
 */

const NAMES = 'abcdefghijklmnopqrstuvwxyz';

type Kind = 'even' | 'top' | 'left';

/** A grid of names as `areas` rows, the last short row stretched to fill. */
function rows(cells: string[][]): string[] {
  const width = Math.max(...cells.map((row) => row.length));
  return cells.map((row) => {
    const out = [...row];
    while (out.length < width) out.push(out[out.length - 1]!);
    return out.join(' ');
  });
}

/** `names` laid row by row, `columns` to a row. */
function block(names: string[], columns: number): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < names.length; i += columns) out.push(names.slice(i, i + columns));
  return out;
}

function template(count: number, kind: Kind, areas: string[], lead: boolean): PageTemplate {
  const slots: TemplateSlot[] = NAMES.slice(0, count).split('').map((id, index) => ({
    id,
    role: (lead && index === 0 ? 'hero' : 'standard') as SlotRole,
    bleed: 1,
  }));
  const names: Record<Kind, string> = {
    even: count === 1 ? 'Én stor' : 'Lige store felter',
    top: 'Én stor øverst',
    left: 'Én stor til venstre',
  };
  return { id: `std/${count}/${kind}`, name: names[kind], areas, slots };
}

function even(count: number): PageTemplate {
  const names = NAMES.slice(0, count).split('');
  const columns = count <= 2 ? 1 : count <= 6 ? 2 : 3;
  return template(count, 'even', rows(block(names, columns)), false);
}

function top(count: number): PageTemplate | null {
  if (count < 3) return null;
  const [lead, ...rest] = NAMES.slice(0, count).split('');
  const columns = Math.min(3, rest.length <= 4 ? 2 : 3);
  const below = block(rest, columns);
  // The lead takes as much height as the rest together — half the page.
  const leadRows = Array.from({ length: below.length }, () => Array(columns).fill(lead!));
  return template(count, 'top', rows([...leadRows, ...below]), true);
}

function left(count: number): PageTemplate | null {
  if (count < 2 || count > 4) return null;
  const [lead, ...rest] = NAMES.slice(0, count).split('');
  return template(count, 'left', rest.map((name) => `${lead} ${name}`), true);
}

/** The layouts offered for `count` products, simplest first. */
export function standardLayouts(count: number): PageTemplate[] {
  if (count < 1) return [];
  return [even(count), top(count), left(count)].filter((t): t is PageTemplate => Boolean(t));
}

/** The counts the gallery offers. */
export const STANDARD_COUNTS = [1, 2, 3, 4, 5, 6, 8, 9];
