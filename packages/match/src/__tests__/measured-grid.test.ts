import { describe, expect, it } from 'vitest';
import { describeGrid, measureGrid, type MeasuredGrid } from '../measured-grid.js';

/**
 * The contract between the measurement and the prompt.
 *
 * `describeGrid` promises the model three things — these ids, this
 * shape, nothing invented — and `matchPage` holds it to exactly those:
 * a slot naming a cell the grid does not have is dropped, and the
 * measured `areas` are used rather than the model's copy of them. The
 * two halves are in different files and nothing but this test connects
 * them, so a promise quietly removed here is a page whose slots name
 * cells that do not exist.
 *
 * Reading a real PDF is the other lane: `npm run reference -- <fil.pdf>
 * --overlay` draws what was measured onto the page it was measured
 * from, which is the only way to see that a reading is right rather
 * than merely consistent.
 */
const grid: MeasuredGrid = {
  columns: 4,
  rows: 3,
  areas: ['. a a a', '. a a a', 'b c d e'],
  gutter: { x: 0.02, y: 0.015 },
  fit: 0.049,
  cells: [
    { id: 'a', text: 'Ugens køb 10,- Coop kartofler', images: 3, maxTextSize: 82, area: 0.23 },
    { id: 'b', text: '12,- Den Grønne Slagter pålæg', images: 1, maxTextSize: 35, area: 0.05 },
    { id: 'c', text: '20,- Änglamark økologiske bananer', images: 1, maxTextSize: 35, area: 0.04 },
    { id: 'd', text: '49,- Xtra! hel kylling', images: 1, maxTextSize: 35, area: 0.05 },
    { id: 'e', text: '9,- Änglamark vådservietter', images: 1, maxTextSize: 42, area: 0.05 },
  ],
};

describe('the grid handed to the model', () => {
  const said = describeGrid(grid);

  it('gives it the grid verbatim', () => {
    for (const row of grid.areas) expect(said).toContain(`"${row}"`);
  });

  it('names every cell it may fill', () => {
    // The ids are the link between the file's measurement and the
    // model's answer. `matchPage` drops a slot naming anything else,
    // so a cell left out here is a cell that can never be cast.
    for (const cell of grid.cells) expect(said).toMatch(new RegExp(`\\b${cell.id} —`));
  });

  it('says the grid is measured, and not to re-read it', () => {
    expect(said).toContain('MEASURED FROM THE PDF');
    expect(said).toContain('unchanged');
    expect(said).toMatch(/do not re-count/i);
  });

  it('tells it what each cell holds, so it can cast against the page', () => {
    // Size, artwork and words: the three things that decide which offer
    // stands in for what the chain printed there. Without them the
    // model is filling anonymous boxes.
    expect(said).toContain('23% of the sheet');
    expect(said).toContain('3 images');
    expect(said).toContain('largest type 82pt');
    expect(said).toContain('Coop kartofler');
  });
});

describe('measuring', () => {
  it('measures nothing that is not a PDF', async () => {
    // A photograph of a page has no content stream to read, and the
    // model reads the picture exactly as it did before this existed.
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    await expect(measureGrid(png, 1)).resolves.toBeNull();
  });
});
