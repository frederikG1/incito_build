/**
 * Where the products stand on a page that was published as a picture —
 * read off the pixels, with no model and at no cost.
 *
 * A leaflet page is paper and things printed on it. The paper is the
 * colour most of the page is (a flat field, or a field with a faint
 * pattern in two or three shades), and everything else is ink. The page
 * is laid out on a grid, so the offers are what the gutters leave: runs
 * of paper down the page split it into columns, runs of paper across a
 * column split it into offers (`gridCells`).
 *
 * It is a measurement, not a reading: it says where, never what. A
 * headline is ink too and becomes a cell like any other — harmless,
 * since a cell is only a place a product may be put. A page with no
 * grid at all (a collage, a cover photograph) yields few or no cells,
 * and cells are made and corrected by hand in "Rediger layout".
 */

export interface Pixels {
  width: number;
  height: number;
  /** RGBA, row by row. */
  data: Uint8ClampedArray | Uint8Array;
}

export interface CellBox { x0: number; y0: number; x1: number; y1: number }

type Rgb = [number, number, number];

const distance = (a: Rgb, b: Rgb) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/**
 * The paper's colours: the commonest few along the page's edges, each
 * at least a twentieth of them. The edges because that is where a
 * leaflet is paper — a page whose products are mostly dark would
 * otherwise elect its packshots as the paper. A flat field is one
 * colour; Netto's yellow with its flowers is two or three.
 */
export function paperColours(pixels: Pixels): Rgb[] {
  const counts = new Map<number, { n: number; r: number; g: number; b: number }>();
  const { data, width, height } = pixels;
  const edge = Math.max(2, Math.round(Math.min(width, height) * 0.04));
  let sampled = 0;
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      if (x >= edge && x < width - edge && y >= edge && y < height - edge) continue;
      const at = (y * width + x) * 4;
      const r = data[at]!; const g = data[at + 1]!; const b = data[at + 2]!;
      const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
      const entry = counts.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
      entry.n += 1; entry.r += r; entry.g += g; entry.b += b;
      counts.set(key, entry);
      sampled += 1;
    }
  }
  const colours: Rgb[] = [];
  for (const entry of [...counts.values()].sort((a, b) => b.n - a.n)) {
    if (entry.n < sampled * 0.05 || colours.length >= 4) break;
    const colour: Rgb = [entry.r / entry.n, entry.g / entry.n, entry.b / entry.n];
    if (!colours.some((known) => distance(known, colour) < 12)) colours.push(colour);
  }
  return colours;
}

/** Paper or ink, a grid step at a time — shared by the readers above and below. */
export function inkGrid(pixels: Pixels, step: number, tolerance = 44, fill = 0.15, known?: Rgb[]) {
  const paper = known ?? paperColours(pixels);
  const cols = Math.floor(pixels.width / step);
  const rows = Math.floor(pixels.height / step);
  const ink = new Uint8Array(cols * rows);
  if (paper.length === 0) return { ink: ink.fill(1), cols, rows };
  const { data, width } = pixels;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      let inked = 0;
      for (let y = row * step; y < (row + 1) * step; y += 1) {
        for (let x = col * step; x < (col + 1) * step; x += 1) {
          const at = (y * width + x) * 4;
          const colour: Rgb = [data[at]!, data[at + 1]!, data[at + 2]!];
          if (!paper.some((known) => distance(known, colour) < tolerance)) inked += 1;
        }
      }
      if (inked / (step * step) > fill) ink[row * cols + col] = 1;
    }
  }
  return { ink, cols, rows };
}

/**
 * Columns first, then rows inside each column — the way a leaflet is
 * drawn.
 *
 * A column gutter is a run of x where most of the page's height is
 * paper; a row gutter is a run of y where a column is paper all the way
 * across. Two follow-ups make the cells offers rather than slices: the
 * words under a packshot, cut off by a gap as wide as a gutter, join the
 * packshot above them; and a hero laid across two columns, whose ink
 * crosses the gutter between them, is one cell again.
 */
export function gridCells(
  pixels: Pixels,
  options: { step?: number; gutter?: number; column?: number; row?: number; cross?: number; short?: number; tolerance?: number; fill?: number } = {},
  paper?: Rgb[],
): CellBox[] {
  const step = options.step ?? 4;
  const { ink, cols, rows } = inkGrid(pixels, step, options.tolerance ?? 44, options.fill ?? 0.15, paper);
  const at = (x: number, y: number) => ink[y * cols + x]!;
  const gutter = Math.max(2, Math.round((pixels.width * (options.gutter ?? 0.014)) / step));

  // Runs along one axis where the paper share passes a bar.
  const runs = (share: number[], bar: number, min: number) => {
    const found: { from: number; to: number }[] = [];
    let start = -1;
    for (let i = 0; i <= share.length; i += 1) {
      const clear = i < share.length && share[i]! >= bar;
      if (clear && start < 0) start = i;
      if (!clear && start >= 0) { if (i - start >= min) found.push({ from: start, to: i }); start = -1; }
    }
    return found;
  };
  const split = (length: number, gaps: { from: number; to: number }[]) => {
    const parts: { from: number; to: number }[] = [];
    let from = 0;
    for (const gap of gaps) { if (gap.from > from) parts.push({ from, to: gap.from }); from = gap.to; }
    if (from < length) parts.push({ from, to: length });
    return parts;
  };

  // Columns: where most of the page's height is paper.
  const colPaper = Array.from({ length: cols }, (_, x) => {
    let n = 0; for (let y = 0; y < rows; y += 1) n += at(x, y) ? 0 : 1; return n / rows;
  });
  const bands = split(cols, runs(colPaper, options.column ?? 0.6, gutter));

  const cells: (CellBox & { band: number })[] = [];
  // Every band's stretches of ink, top to bottom.
  const parts = bands.map((band) => {
    const width = band.to - band.from;
    const rowPaper = Array.from({ length: rows }, (_, y) => {
      let n = 0; for (let x = band.from; x < band.to; x += 1) n += at(x, y) ? 0 : 1; return n / width;
    });
    return split(rows, runs(rowPaper, options.row ?? 0.93, gutter))
      .filter((part) => {
        for (let y = part.from; y < part.to; y += 1) for (let x = band.from; x < band.to; x += 1) if (at(x, y)) return true;
        return false;
      });
  });
  /*
   * The words under a packshot, cut off from it by a gap as wide as a
   * gutter, are short beside the page's offers: they join what stands
   * just above them. Only upwards and only across a narrow gap — a
   * headline has nothing above it, and a product below a wide stretch
   * of paper is a product of its own.
   */
  const heights = parts.flat().map((part) => part.to - part.from).sort((a, b) => a - b);
  const typical = heights[Math.floor(heights.length / 2)] ?? rows;
  for (const list of parts) {
    for (let i = 1; i < list.length; i += 1) {
      const part = list[i]!;
      const above = list[i - 1]!;
      if (part.to - part.from < typical * (options.short ?? 0.5) && part.from - above.to <= gutter * 3) {
        above.to = part.to;
        list.splice(i, 1);
        i -= 1;
      }
    }
  }
  bands.forEach((band, index) => {
    for (const part of parts[index]!) {
      // Trim to the ink inside.
      let x0 = band.to; let x1 = band.from; let y0 = part.to; let y1 = part.from; let n = 0;
      for (let y = part.from; y < part.to; y += 1) {
        for (let x = band.from; x < band.to; x += 1) {
          if (!at(x, y)) continue;
          n += 1; x0 = Math.min(x0, x); x1 = Math.max(x1, x + 1); y0 = Math.min(y0, y); y1 = Math.max(y1, y + 1);
        }
      }
      if (n === 0) continue;
      cells.push({ x0, y0, x1, y1, band: index });
    }
  });

  // A hero across two columns crosses the gutter between them: join its halves.
  const cross = options.cross ?? 0.3;
  let joined = true;
  while (joined) {
    joined = false;
    for (let i = 0; i < cells.length && !joined; i += 1) {
      for (let j = 0; j < cells.length && !joined; j += 1) {
        const a = cells[i]!; const b = cells[j]!;
        if (b.band !== a.band + 1) continue;
        const top = Math.max(a.y0, b.y0); const bottom = Math.min(a.y1, b.y1);
        if (bottom - top < Math.min(a.y1 - a.y0, b.y1 - b.y0) * 0.5) continue;
        const gap = bands[a.band]!.to;
        const next = bands[b.band]!.from;
        let crossing = 0;
        for (let y = top; y < bottom; y += 1) {
          let solid = true;
          for (let x = gap; x < next; x += 1) if (!at(x, y)) { solid = false; break; }
          if (solid) crossing += 1;
        }
        if (crossing / (bottom - top) >= cross) {
          cells[i] = { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1), band: b.band };
          cells.splice(j, 1);
          joined = true;
        }
      }
    }
  }

  const page = cols * rows;
  return cells
    .filter((c) => (c.x1 - c.x0) * (c.y1 - c.y0) > page * 0.01 && (c.x1 - c.x0) > cols * 0.08 && (c.y1 - c.y0) > rows * 0.04)
    .map((c) => ({ x0: c.x0 * step, y0: c.y0 * step, x1: Math.min(pixels.width, c.x1 * step), y1: Math.min(pixels.height, c.y1 * step) }))
    .sort((a, b) => (Math.abs(a.y0 - b.y0) < pixels.height * 0.04 ? a.x0 - b.x0 : a.y0 - b.y0));
}

/**
 * The page cut across first where a gutter runs the whole width — a hero
 * spanning the page under two products side by side — and each band
 * then read by `gridCells`. Without it, the wide product fills the
 * column gutter above it and the two products over it read as one.
 */
export function bandedCells(pixels: Pixels, options: { tolerance?: number; fill?: number } = {}): CellBox[] {
  const step = 4;
  const tolerance = options.tolerance ?? 44;
  const fill = options.fill ?? 0.15;
  const { ink, cols, rows } = inkGrid(pixels, step, tolerance, fill, paperColours(pixels));
  const gutter = Math.max(3, Math.round((pixels.width * 0.02) / step));
  const bands: { from: number; to: number }[] = [];
  let from = 0;
  let clear = 0;
  for (let y = 0; y <= rows; y += 1) {
    let n = 0;
    if (y < rows) for (let x = 0; x < cols; x += 1) n += ink[y * cols + x]!;
    if (y < rows && n <= cols * 0.02) { clear += 1; continue; }
    if (clear >= gutter && y - clear > from) { bands.push({ from, to: y - clear }); from = y; }
    clear = 0;
  }
  if (from < rows) bands.push({ from, to: rows });
  if (bands.length <= 1) return gridCells(pixels, { tolerance, fill });
  const cells = bands.flatMap((band) => {
    const top = band.from * step;
    const height = Math.min(pixels.height, band.to * step) - top;
    if (height < pixels.height * 0.05) return [];
    const slice = {
      width: pixels.width,
      height,
      data: pixels.data.subarray(top * pixels.width * 4, (top + height) * pixels.width * 4),
    };
    return gridCells(slice, { tolerance, fill }, paperColours(pixels)).map((box) => ({ ...box, y0: box.y0 + top, y1: box.y1 + top }));
  });
  /*
   * A row of names cut from its row of packshots by a clean gutter is
   * short beside the page's offers: each short cell joins the one right
   * above it, as the words under a packshot do inside a column.
   */
  const heights = cells.map((cell) => cell.y1 - cell.y0).sort((a, b) => a - b);
  const typical = heights[Math.floor(heights.length / 2)] ?? pixels.height;
  const reach = pixels.width * 0.05;
  for (let i = cells.length - 1; i >= 0; i -= 1) {
    const cell = cells[i]!;
    if (cell.y1 - cell.y0 >= typical * 0.5) continue;
    const above = cells
      .filter((other) => other !== cell && other.y1 <= cell.y0 + 2 && cell.y0 - other.y1 <= reach
        && Math.min(other.x1, cell.x1) - Math.max(other.x0, cell.x0) >= (cell.x1 - cell.x0) * 0.5)
      .sort((a, b) => b.y1 - a.y1)[0];
    if (!above) continue;
    above.x0 = Math.min(above.x0, cell.x0); above.x1 = Math.max(above.x1, cell.x1);
    above.y1 = Math.max(above.y1, cell.y1);
    cells.splice(i, 1);
  }
  return cells;
}

/** The commonest colour in a thin ring just outside a box — the paper a product stands on. */
export function ringColour(pixels: Pixels, box: CellBox): string {
  const counts = new Map<number, { n: number; r: number; g: number; b: number }>();
  const { data, width, height } = pixels;
  const bump = (x: number, y: number) => {
    const px = Math.round(Math.min(width - 1, Math.max(0, x)));
    const py = Math.round(Math.min(height - 1, Math.max(0, y)));
    const at = (py * width + px) * 4;
    const r = data[at]!; const g = data[at + 1]!; const b = data[at + 2]!;
    const key = (Math.round(r / 24) << 16) | (Math.round(g / 24) << 8) | Math.round(b / 24);
    const entry = counts.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    entry.n += 1; entry.r += r; entry.g += g; entry.b += b;
    counts.set(key, entry);
  };
  for (const inset of [-6, -3, 1]) {
    const x0 = box.x0 + inset; const x1 = box.x1 - inset;
    const y0 = box.y0 + inset; const y1 = box.y1 - inset;
    for (let x = x0; x <= x1; x += 2) { bump(x, y0); bump(x, y1); }
    for (let y = y0; y <= y1; y += 2) { bump(x0, y); bump(x1, y); }
  }
  const best = [...counts.values()].sort((a, b) => b.n - a.n)[0];
  const hex = (c: number) => Math.min(255, Math.max(0, Math.round(c))).toString(16).padStart(2, '0');
  return best ? `#${hex(best.r / best.n)}${hex(best.g / best.n)}${hex(best.b / best.n)}` : '#ffffff';
}

/** A page picture's cells and paper, ready for `pagedPage`. */
export function findPageCells(pixels: Pixels): { cells: { box: CellBox; paper: string }[]; paper?: string } {
  const colours = paperColours(pixels);
  const hex = (c: number) => Math.min(255, Math.max(0, Math.round(c))).toString(16).padStart(2, '0');
  const paper = colours[0] ? `#${colours[0].map(hex).join('')}` : undefined;
  const page = pixels.width * pixels.height;
  const cells = bandedCells(pixels)
    // Half the page in one cell is a page the grid did not explain.
    .filter((box) => (box.x1 - box.x0) * (box.y1 - box.y0) < page * 0.45)
    .map((box) => ({ box, paper: ringColour(pixels, box) }));
  return { cells, ...(paper ? { paper } : {}) };
}
