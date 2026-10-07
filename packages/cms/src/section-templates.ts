/**
 * CMS section designs → the studio's sections.
 *
 * A section design in the Tjek CMS is a sheet of layers: a backdrop,
 * a logo, a heading, panels of colour — and one or more offer boxes,
 * each naming the offer design that draws its offers and how many it
 * takes. That is exactly what a section in the studio is: a page with
 * its look and its cells, waiting for this week's products. So each
 * design becomes one, with its cells measured where the CMS would put
 * them and everything that is not an offer kept as the page's own
 * pictures, panels and words.
 *
 * Only this file and `types.ts` are imported by the studio (see the
 * package's `./section-templates` export), so it stays free of the
 * feed and edition machinery the rest of the package pulls in.
 */
import {
  PageTemplate, CatalogPage, PageNote, PageDecoration,
  type MeasuredRect, type TemplateSlot,
} from '@incitio/schema';
import { CmsSectionDesign, sectionDesigns, type CmsSectionLayer } from './types.js';

/** The CMS lays a publication out on a 600 × 1000 sheet; type sizes are in its pixels. */
const SHEET_W = 600;
const SHEET_H = 1000;
/** Between two offers in a box, as the CMS leaves it: two pixels or so. */
const GUTTER = 0.004;
/** What a box that takes "the rest" is set up with — the CMS's own preview most often shows four. */
export const REST_DEFAULT = 4;

const visible = (l: CmsSectionLayer) => !l.is_hidden && (l.opacity ?? 100) > 0;
const area = (l: CmsSectionLayer) => Math.max(0, Math.min(l.x2, 1) - Math.max(l.x1, 0)) * Math.max(0, Math.min(l.y2, 1) - Math.max(l.y1, 0));
const rectOf = (l: CmsSectionLayer): MeasuredRect => ({
  x: clamp(l.x1, -0.5, 1.5), y: clamp(l.y1, -0.5, 1.5),
  w: clamp(l.x2 - l.x1, 0.01, 2), h: clamp(l.y2 - l.y1, 0.01, 2),
});
function clamp(v: number, lo: number, hi: number) { return Math.min(hi, Math.max(lo, v)); }

/** `rgb(255, 234, 153)` → `#ffea99`; anything else → null. */
export function hexOf(color: unknown): string | null {
  const m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?/.exec(typeof color === 'string' ? color : '');
  if (!m || (m[4] !== undefined && Number(m[4]) === 0)) return null;
  return `#${[m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Every CMS section design in whatever was pasted or loaded: the
 * clipboard's `incito_designs:[…]`, a bare list, `{ incito_designs }`,
 * `{ designs }` (one publication's capture) or a capture whose `designs`
 * is a table of lists. Offer designs in the same paste are left out.
 */
export function readCmsSectionDesigns(input: string | unknown): CmsSectionDesign[] {
  let parsed: unknown = input;
  if (typeof input === 'string') {
    const trimmed = input.trim();
    parsed = JSON.parse(trimmed.startsWith('incito_designs:') ? trimmed.slice('incito_designs:'.length) : trimmed);
  }
  const lists: unknown[][] = [];
  const take = (value: unknown) => {
    if (Array.isArray(value)) lists.push(value);
    else if (value && typeof value === 'object') for (const v of Object.values(value)) if (Array.isArray(v)) lists.push(v);
  };
  if (Array.isArray(parsed)) lists.push(parsed);
  else if (parsed && typeof parsed === 'object') {
    const o = parsed as Record<string, unknown>;
    take(o['incito_designs']);
    take(o['designs']);
  }
  const seen = new Set<string>();
  return lists.flatMap((list) => sectionDesigns(list)).filter((d) => !seen.has(d.id) && Boolean(seen.add(d.id)));
}

export interface CellRect extends MeasuredRect { span: boolean }

/**
 * `n` offers in one box, the way the CMS packs them.
 *
 * Measured off its own previews: columns of equal width, as many rows as
 * it takes, and when the count does not divide, the FIRST cell spans
 * the gap — five in a tall box is one wide offer over two pairs. The
 * number of columns is the one that gives cells nearest a slightly tall
 * shape, which is what a packshot over a price wants.
 */
export function packBox(box: MeasuredRect, n: number): CellRect[] {
  if (n <= 0) return [];
  const pw = box.w * SHEET_W;
  const ph = box.h * SHEET_H;
  let best = { cols: 1, cost: Infinity };
  for (let cols = 1; cols <= Math.min(n, 5); cols++) {
    const rows = Math.ceil(n / cols);
    const aspect = (pw / cols) / (ph / rows);
    const empty = rows * cols - n;
    const cost = Math.abs(Math.log(aspect / 0.85)) + empty * 0.08;
    if (cost < best.cost) best = { cols, cost };
  }
  const { cols } = best;
  const rows = Math.ceil(n / cols);
  const spare = rows * cols - n;
  const cw = box.w / cols;
  const rh = box.h / rows;
  const g = GUTTER / 2;
  const cells: CellRect[] = [];
  let index = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      // The first cell takes the spare columns of the first row.
      if (r === 0 && c > 0 && c <= spare) continue;
      const span = r === 0 && c === 0 && spare > 0;
      const w = span ? cw * (spare + 1) : cw;
      cells.push({ x: box.x + c * cw + g, y: box.y + r * rh + g, w: w - 2 * g, h: rh - 2 * g, span });
      if (++index === n) return cells;
    }
  }
  return cells;
}

export interface SectionTemplate {
  design: CmsSectionDesign;
  /** The design's tag — what the CMS calls it. */
  name: string;
  /** How many offers the page takes. */
  capacity: number;
  /** The offer design tag most of its cells draw in, if any. */
  offerTag: string | null;
  template: PageTemplate;
  /** The page, empty of offers, with the design's backdrop, pictures, panels and words. */
  page: CatalogPage;
  /** What the CMS draws that the page cannot — said, not hidden. */
  left: string[];
}

const slug = (s: string) => s.toLowerCase().replace(/æ/g, 'ae').replace(/ø/g, 'o').replace(/å/g, 'aa')
  .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'sektion';

/** One CMS section design as a studio section: a measured template and a page that looks like the design. */
export function sectionTemplate(design: CmsSectionDesign, options: { rest?: number } = {}): SectionTemplate {
  const layers = design.layers.filter(visible);
  const left: string[] = [];

  // Offer boxes, top to bottom, left to right — the order the CMS fills them in.
  const boxes = layers.filter((l) => l.offers_tag)
    .sort((a, b) => a.y1 - b.y1 || a.x1 - b.x1);
  const slots: TemplateSlot[] = [];
  const tagCount = new Map<string, number>();
  /*
   * A box with no count takes "the rest". Alone on the sheet (Wolt's one
   * big grid) that is a handful; among boxes that each say how many
   * (Løvbjerg's 1prio+2+3, one box per offer) it is the last single cell.
   */
  const counted = boxes.some((b) => b.offers_max_count != null);
  for (const box of boxes) {
    const n = box.offers_max_count ?? (counted ? 1 : options.rest ?? REST_DEFAULT);
    if (box.offers_max_count == null && !counted) left.push(`«${box.name || box.offers_tag}» tager resten i CMS'et — sat op med ${n}`);
    const cells = packBox(rectOf(box), n);
    tagCount.set(box.offers_tag!, (tagCount.get(box.offers_tag!) ?? 0) + cells.length);
    for (const cell of cells) {
      const { span, ...rect } = cell;
      slots.push({
        id: `c${slots.length + 1}`,
        role: cells.length === 1 || span ? 'hero' : 'standard',
        bleed: 1,
        rect,
        design: box.offers_tag!,
      });
    }
  }
  const offerTag = [...tagCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  const id = `cms/${slug(design.tag)}-${slug(design.id).slice(0, 12)}`;
  const template = PageTemplate.parse(slots.length
    ? { id, name: design.tag, areas: [slots.map((s) => s.id).join(' ')], slots }
    // A design with no offers — an intro, an outro — is still a page: one cell nobody has to fill.
    : { id, name: design.tag, areas: ['a'], slots: [{ id: 'a', role: 'hero', rect: { x: 0.4, y: 0.4, w: 0.2, h: 0.2 } }] });

  // Layers are listed top first; the bottom-most full-sheet layer is the backdrop.
  const full = layers.filter((l) => !l.offers_tag && area(l) >= 0.9);
  const picture = [...full].reverse().find((l) => l.bg_image_url?.signed);
  const colour = [...full].reverse().find((l) => hexOf(l.bg_color));
  const backdrop = new Set([picture, colour].filter(Boolean));

  /*
   * Above or under the products. The CMS lists layers top first, so a
   * picture listed after an offer box it overlaps lies UNDER that box's
   * offers — a photograph the products stand on — and one listed before
   * it (a sticker, a logo) lies over them.
   */
  const order = new Map(design.layers.map((l, i) => [l, i]));
  const overlaps = (a: CmsSectionLayer, b: CmsSectionLayer) => a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;
  const over = (layer: CmsSectionLayer) => boxes
    .filter((box) => overlaps(layer, box))
    .every((box) => order.get(layer)! < order.get(box)!);

  const decorations: PageDecoration[] = [];
  const notes: PageNote[] = [];
  // Bottom first, so what the CMS lists on top is drawn last.
  for (const layer of [...layers].reverse()) {
    if (backdrop.has(layer)) continue;
    const rect = rectOf(layer);
    const fill = hexOf(layer.bg_color);
    // An offer box's own colour is the panel its offers stand on.
    if (layer.offers_tag) {
      if (fill) notes.push(PageNote.parse({ id: `n${notes.length + 1}`, text: '', x: rect.x, y: rect.y, w: rect.w, h: rect.h, background: fill, behind: true }));
      continue;
    }
    const url = layer.bg_image_url?.signed;
    if (url) {
      if (decorations.length < 12) {
        decorations.push(PageDecoration.parse({
          id: `cms-${slug(String(layer.id))}-${decorations.length}`,
          imageUrl: url, subject: layer.name || 'CMS-billede', anchor: 'top-left', rect, front: over(layer),
          scale: clamp(rect.w, 0.05, 0.6),
        }));
      } else left.push(`billedet «${layer.name}» — siden har plads til tolv`);
      continue;
    }
    const words = layer.paragraphs
      .map((p) => String(p.text_content ?? ''))
      .filter((t) => t.trim());
    const isLiquid = (t: string) => t.includes('{{') || t.includes('{%');
    const liquid = words.filter(isLiquid);
    if (liquid.length) left.push(`«${layer.name || 'tekst'}» udfyldes af CMS'et (${liquid[0]!.trim().split('\n')[0]!.slice(0, 40)}) og udelades`);
    const text = words.filter((t) => !isLiquid(t)).join('\n').trim();
    if (!text && !fill) continue;
    const first = (layer.paragraphs[0] ?? {}) as Record<string, unknown>;
    const align = first['text_align'] === 'left' || first['text_align'] === 'right' ? first['text_align'] : 'center';
    const weight = String(first['text_weight'] ?? '');
    if (notes.length >= 24) { left.push(`teksten «${text.slice(0, 30)}» — siden har plads til 24`); continue; }
    notes.push(PageNote.parse({
      id: `n${notes.length + 1}`,
      text: text.slice(0, 400),
      x: rect.x, y: rect.y, w: rect.w,
      size: clamp(Number(first['text_size'] ?? 24) / SHEET_W, 0.005, 0.3),
      color: hexOf(first['text_color']) ?? '#16181d',
      bold: weight === 'bold' || Number(weight) >= 600 || first['text_level'] === 'h1',
      align,
      rotate: clamp(Number(layer['rotate'] ?? 0), -180, 180),
      background: fill,
      h: fill ? rect.h : null,
      behind: !text,
    }));
  }

  const page = CatalogPage.parse({
    id: `cms-${slug(design.id)}`,
    kind: 'offers',
    templateId: template.id,
    title: '',
    subtitle: '',
    placements: [],
    rationale: `CMS: ${design.tag}`,
    // The CMS's sheet is white until a layer colours it; the chain's own ground would show between the panels.
    ground: hexOf(colour?.bg_color) ?? '#ffffff',
    motif: false,
    decorations,
    notes,
    background: picture ? {
      imageUrl: picture.bg_image_url!.signed!, subject: picture.name || design.tag,
      fit: picture.bg_image_size === 'contain' ? 'contain' : 'cover', opacity: 1,
    } : null,
    ...(offerTag ? { design: { group: 'standard', tag: offerTag, zones: {} } } : {}),
  });

  return { design, name: design.tag, capacity: slots.length, offerTag, template, page, left };
}
