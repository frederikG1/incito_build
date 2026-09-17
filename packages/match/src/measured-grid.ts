/**
 * The reference's grid, measured instead of estimated.
 *
 * A chain's leaflet arrives as a vector PDF, and the grid under it is
 * stated in that file: every product, every price mark and every line of
 * fine print is a box with coordinates. `@incitio/reference` reads them
 * and fits the lattice; this is the adapter that puts the answer in
 * front of the model.
 *
 * What changes for the model is what it is asked FOR. Reading a grid off
 * a picture is the part of this job it is worst at — counting columns on
 * a page where the lead artwork bleeds over two of them is exactly the
 * kind of estimate that comes back different on the second run — and it
 * is the part a file can answer exactly. What is left is the half a
 * model is good at and a file knows nothing about: which offer belongs
 * in which cell, how prominent each one is, and what the page is called.
 *
 * Null whenever the measurement does not hold up: an image rather than a
 * PDF, a page whose blocks sit on no common lattice, a fit so loose that
 * the grid was fitted rather than read. In every one of those the old
 * path runs unchanged and the model reads the picture, which is the
 * point — this is evidence when there is evidence, never a new
 * requirement.
 */
import type { Block, GridReading, PdfjsLike } from '@incitio/reference';
import { gridOf, readPage } from '@incitio/reference';
import { isPdf } from './page-image.js';

export interface MeasuredCell {
  id: string;
  /** What the printed page has in this cell, for the model to match against. */
  text: string;
  images: number;
  /** The largest type in the cell, in points — a lead is set bigger. */
  maxTextSize: number;
  /** Share of the sheet, so the model can see which cell is the big one. */
  area: number;
}

export interface MeasuredGrid {
  columns: number;
  rows: number;
  areas: string[];
  /** The alley between two cells, as a share of the sheet. */
  gutter: { x: number; y: number };
  /** How far the worst block edge sat from its lattice line. */
  fit: number;
  cells: MeasuredCell[];
}

/**
 * How loose a fit is still a reading.
 *
 * A leaflet's lead artwork runs past its own cell on purpose, so one
 * edge on a page is expected to sit wide — that is what `bleedPercent`
 * records. Past a tenth of the sheet the lattice is no longer explaining
 * the page, and a grid nobody can see is worse than asking the model to
 * look.
 */
const MAX_FIT = 0.1;

export async function measureGrid(
  file: Buffer, pageNumber: number,
): Promise<MeasuredGrid | null> {
  if (!isPdf(file)) return null;

  let reading: (GridReading & { blocks: Block[] }) | null;
  try {
    /*
     * pdf.js is loaded here, and the legacy build is the one that runs
     * in Node without a DOM. Dynamic, because this is the only path in
     * the package that parses a PDF outside the browser — the raster
     * lane serves pdf.js TO Chromium instead — and a failure to load it
     * must cost a measurement, never the rebuild.
     */
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs') as unknown as PdfjsLike;
    // A copy: pdf.js transfers the array it is handed to its worker, and
    // the caller still has to rasterise these very bytes.
    const page = await readPage(pdfjs, { data: new Uint8Array(file) }, pageNumber);
    reading = gridOf(page);
  } catch {
    return null;
  }

  if (!reading || reading.fit > MAX_FIT) return null;
  // One cell is not a grid; it is a page the reader could not divide.
  if (reading.slots.length < 2) return null;

  return {
    columns: reading.columns,
    rows: reading.rows,
    areas: reading.areas,
    gutter: reading.gutter,
    fit: reading.fit,
    cells: reading.slots.map((slot) => ({
      id: slot.id,
      text: slot.block.text.slice(0, 120),
      images: slot.block.images,
      maxTextSize: Math.round(slot.block.maxTextSize),
      area: Number((slot.rect.w * slot.rect.h).toFixed(3)),
    })),
  };
}

/**
 * The measured grid, written for the model.
 *
 * Its own function because it is a contract with the prompt: the model
 * is told the ids it must use and the shape it must return, and the
 * code below the call then holds it to exactly that. A change here
 * without a change there is a page whose slots name cells that do not
 * exist.
 */
export function describeGrid(grid: MeasuredGrid): string {
  return [
    'THE GRID OF THIS PAGE, MEASURED FROM THE PDF ITSELF — not estimated, not',
    'from the picture. Use it exactly as given:',
    '',
    ...grid.areas.map((row) => `    "${row}"`),
    '',
    `${grid.columns} columns, ${grid.rows} rows. What the printed page has in each cell:`,
    '',
    ...grid.cells.map((cell) => `    ${cell.id} — ${
      [
        `${Math.round(cell.area * 100)}% of the sheet`,
        cell.images > 0 ? `${cell.images} image${cell.images > 1 ? 's' : ''}` : 'no image',
        `largest type ${cell.maxTextSize}pt`,
        cell.text ? `"${cell.text}"` : '',
      ].filter(Boolean).join(', ')
    }`),
    '',
    'Return these `areas` unchanged, and give every slot the id it has here.',
    'Do not re-count the columns, do not merge or split a cell, and do not',
    'invent an id: a slot naming a cell this grid does not have is dropped.',
    'Spend your attention on the casting instead — which offer belongs in',
    'which cell, and how prominent each one is. The cell sizes above are',
    'what the chain gave each offer; the `role` you return should follow',
    'them.',
  ].join('\n');
}
