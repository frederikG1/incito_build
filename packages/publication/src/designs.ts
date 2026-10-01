/**
 * A chain's offer designs, read back out of what it published.
 *
 * A CMS offer design is a set of layers placed in fractions of the offer
 * cell (image here, price there, text below). The renderer fills one
 * design per offer and writes the result into the incito as positioned
 * views — so every offer tile in a published incito is a design with a
 * product poured into it. Group the tiles by where their layers stand
 * and each group is one design.
 *
 * What survives the round trip, and what does not:
 *   - text, image and logo layers are drawn at the design's own box, so
 *     their boxes come back exactly;
 *   - the price splash is a fixed-size picture SCALED to fit its box
 *     (`transform_scale`, origin top-left, anchored right/bottom). One
 *     tile shows only the box's width or its height; the union over
 *     tiles of different cell shapes gives the whole box back;
 *   - a layer whose field is empty is not drawn at all, so a design is
 *     only as complete as the data that went through it;
 *   - the rules that chose the design (tag, A/B, offer type) are not in
 *     the output — only their result is.
 *
 * Pure and deterministic: no network, no model. The views come from
 * `readIncito`'s input or from the CMS section preview — both are the
 * same incito view tree.
 */
import type { OfferDesign } from '@incitio/schema';

type View = Record<string, unknown> & { child_views?: View[] };

export type SeenKind = 'image' | 'text' | 'price' | 'label' | 'logos';

/** Left, top, right, bottom as fractions of the offer cell. */
export type Box = [number, number, number, number];

export interface SeenText {
  text: string;
  color: string | null;
  /** `h1`, `body` … — the incito font slot the paragraph is set in. */
  font: string | null;
  size: number | null;
}

export interface SeenLayer {
  kind: SeenKind;
  box: Box;
  /** Drawn scaled to fit its box rather than at it. */
  fitted: boolean;
  /** Carries a nested layer (savings in the price) that stretches its box. */
  nested: boolean;
  texts: SeenText[];
}

export interface SeenTile {
  offerId: string;
  name: string;
  /** Pixel size of the cell the layers are placed in. */
  cell: { w: number; h: number };
  layers: SeenLayer[];
}

export interface RebuiltLayer {
  kind: SeenKind;
  box: Box;
  fitted: boolean;
  /** Tiles that drew this layer, out of the design's tiles. */
  seen: number;
  /** The box so far comes only from tiles where a nested layer stretched it. */
  stretched: boolean;
  colors: string[];
}

export interface RebuiltDesign {
  id: string;
  tiles: string[];
  layers: RebuiltLayer[];
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function walk(view: View, visit: (v: View) => void): void {
  visit(view);
  for (const child of view.child_views ?? []) walk(child, visit);
}

function texts(view: View): SeenText[] {
  const out: SeenText[] = [];
  const read = (v: View, style: string) => {
    const own = typeof v['style'] === 'string' ? (v['style'] as string) : '';
    const merged = own || style;
    if (v['view_name'] === 'TextView' && typeof v['text'] === 'string' && v['text'].trim()) {
      const color = /(?:^|;)\s*color:\s*([^;]+)/.exec(merged)?.[1]?.replace(/\s+/g, '') ?? null;
      const font = /font-family:\s*incito-([a-z0-9]+)/.exec(merged)?.[1] ?? null;
      const size = /font-size:\s*([\d.]+)px/.exec(merged)?.[1];
      out.push({ text: v['text'].trim(), color, font, size: size ? Number(size) : null });
    }
    for (const c of v.child_views ?? []) read(c, merged);
  };
  read(view, '');
  return out;
}

function hasImageView(view: View): boolean {
  let found = false;
  walk(view, (v) => { if (v['view_name'] === 'ImageView') found = true; });
  return found;
}

function hasBackground(view: View): boolean {
  let found = false;
  walk(view, (v) => { if (typeof v['background_image'] === 'string') found = true; });
  return found;
}

/*
 * A price stands alone on its line: "22,-", "125,-", or "2995" — the
 * renderer sets the øre as superscript, so 29,95 reaches the tree as one
 * run of digits. A line with words in it ("Pris ikke-medlemmer 19.95")
 * is a label that happens to mention a price.
 */
const PRICE = /^\d[\d.]*(?:,-|,\d{2})?$/;
/** The savings bubble the CMS nests inside the price layer. */
const SAVING = /^spar\b/i;

function kindOf(layer: View, name: string): SeenKind | null {
  const lines = texts(layer);
  if (lines.length > 0) {
    if (lines.some((l) => l.text === name) || (!hasBackground(layer) && !lines.some((l) => PRICE.test(l.text)))) return 'text';
    if (lines.some((l) => PRICE.test(l.text))) return 'price';
    return 'label';
  }
  if (hasImageView(layer)) return 'logos';
  if (hasBackground(layer)) return 'image';
  return null;
}

/** Every offer tile in a view tree, with its layers measured. */
export function readTiles(root: View): SeenTile[] {
  const tiles: SeenTile[] = [];
  walk(root, (v) => {
    if (v['role'] !== 'offer') return;
    /*
     * The offer view holds one padded cell and the design is placed in
     * it. The cell's own size is not always that space (a wide design
     * can come with a half-width wrapper and layers past its edge), so
     * the space is the offer minus the padding on both sides.
     */
    const cell = v.child_views?.[0];
    const ow = num(v['layout_width']);
    const oh = num(v['layout_height']);
    const padX = num(cell?.['layout_left']) ?? 0;
    const padY = num(cell?.['layout_top']) ?? 0;
    const w = ow !== null ? ow - 2 * padX : num(cell?.['layout_width']);
    const h = oh !== null ? oh - 2 * padY : num(cell?.['layout_height']);
    if (!cell || !w || !h || w <= 0 || h <= 0) return;
    const label = typeof v['accessibility_label'] === 'string' ? (v['accessibility_label'] as string) : '';
    const name = label.replace(/, DKK [\d.,]+$/, '');
    const layers: SeenLayer[] = [];
    for (const layer of cell.child_views ?? []) {
      const kind = kindOf(layer, name);
      if (!kind) continue;
      const left = num(layer['layout_left']) ?? 0;
      const top = num(layer['layout_top']) ?? 0;
      const lw = num(layer['layout_width']);
      const lh = num(layer['layout_height']);
      if (lw === null || lh === null) continue;
      const scale = num(layer['transform_scale']) ?? 1;
      layers.push({
        kind,
        box: [left / w, top / h, (left + lw * scale) / w, (top + lh * scale) / h],
        fitted: Math.abs(scale - 1) > 1e-6,
        nested: kind === 'price' && texts(layer).some((t) => SAVING.test(t.text)),
        texts: texts(layer),
      });
    }
    tiles.push({ offerId: String(v['id'] ?? ''), name, cell: { w, h }, layers });
  });
  return tiles;
}

const TOLERANCE = 0.012;
const near = (a: Box, b: Box) => a.every((v, i) => Math.abs(v - b[i]!) <= TOLERANCE);

/** A fitted layer only ever shows part of its box; a fixed one shows all of it. */
function fits(tile: SeenLayer, design: RebuiltLayer): boolean {
  if (!tile.fitted || !design.fitted) return near(tile.box, design.box);
  /*
   * A fitted picture fills its box along one axis and sits against one
   * edge along the other (the price splash right/bottom, a label
   * left/top). So at least one vertical and one horizontal edge are the
   * design's own.
   */
  const at = (i: number) => Math.abs(tile.box[i]! - design.box[i]!) <= TOLERANCE;
  return (at(0) || at(2)) && (at(1) || at(3));
}

const colorsOf = (layer: SeenLayer) => layer.texts.map((t) => t.color ?? '?');

const fresh = (l: SeenLayer): RebuiltLayer => ({
  kind: l.kind, box: [...l.box] as Box, fitted: l.fitted, seen: 1, stretched: l.nested, colors: colorsOf(l),
});

/**
 * Tiles → designs. A tile joins the first design whose layers it agrees
 * with wherever both have a layer of the same kind; otherwise it starts a
 * new one. Fitted boxes grow to the union of what their tiles showed.
 */
export function rebuildDesigns(tiles: readonly SeenTile[]): RebuiltDesign[] {
  const designs: RebuiltDesign[] = [];
  for (const tile of tiles) {
    const home = designs.find((design) => {
      let shared = 0;
      for (const layer of tile.layers) {
        const twin = design.layers.find((l) => l.kind === layer.kind);
        if (!twin) continue;
        if (!fits(layer, twin)) return false;
        if (layer.kind === 'text' && colorsOf(layer)[0] !== twin.colors[0]) return false;
        shared += 1;
      }
      return shared > 0;
    });
    if (!home) {
      designs.push({
        id: `d${designs.length + 1}`,
        tiles: [tile.offerId],
        layers: tile.layers.map(fresh),
      });
      continue;
    }
    home.tiles.push(tile.offerId);
    for (const layer of tile.layers) {
      const twin = home.layers.find((l) => l.kind === layer.kind);
      if (!twin) {
        home.layers.push(fresh(layer));
        continue;
      }
      twin.seen += 1;
      // A box stretched by a nested layer says nothing about the layer's own box.
      if (layer.nested) continue;
      if (twin.stretched) {
        twin.box = [...layer.box] as Box;
        twin.stretched = false;
        continue;
      }
      if (twin.fitted) {
        twin.box = [
          Math.min(twin.box[0], layer.box[0]), Math.min(twin.box[1], layer.box[1]),
          Math.max(twin.box[2], layer.box[2]), Math.max(twin.box[3], layer.box[3]),
        ];
      }
    }
  }
  return designs;
}

/* ------------------------------------------------ against the CMS */

/** Which CMS layer types a seen layer can be. */
const TYPES: Record<SeenKind, RegExp> = {
  image: /^offer_image$/,
  text: /^offer_text$/,
  price: /^offer_(price|membership_price|membership_relative_savings|relative_savings)$/,
  label: /^offer_(custom|comment)_label_\d$/,
  logos: /^offer_logos$/,
};

export function iou(a: Box, b: Box): number {
  const ix = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
  const iy = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const inter = ix * iy;
  const union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter;
  return union > 0 ? inter / union : 0;
}

export interface LayerScore { kind: SeenKind; type: string | null; iou: number; rebuilt: Box; truth: Box | null }

export interface DesignMatch {
  rebuilt: string;
  tiles: number;
  /** Mean IoU over the rebuilt layers; a layer the design lacks scores 0. */
  score: number;
  /** Every CMS design that scores the best — identical layouts tie. */
  best: { id: string; tag: string; priority: string | null; offerType: string | null }[];
  layers: LayerScore[];
  /** Layers the CMS design has that no tile drew — empty fields, mostly. */
  unseen: string[];
}

function scoreAgainst(design: RebuiltDesign, truth: OfferDesign): { score: number; layers: LayerScore[]; unseen: string[] } {
  // Top-level layers only: a nested layer (savings inside price) is placed in its parent.
  const top = truth.layers.filter((l) => l.parent_id == null && !l.is_hidden);
  const used = new Set<unknown>();
  const layers: LayerScore[] = design.layers.map((layer) => {
    let best: { l: (typeof top)[number]; v: number } | null = null;
    for (const l of top) {
      if (used.has(l.id) || !l.type || !TYPES[layer.kind].test(l.type)) continue;
      const v = iou(layer.box, [l.x1, l.y1, l.x2, l.y2]);
      if (!best || v > best.v) best = { l, v };
    }
    if (best) used.add(best.l.id);
    return {
      kind: layer.kind,
      type: best?.l.type ?? null,
      iou: best?.v ?? 0,
      rebuilt: layer.box,
      truth: best ? [best.l.x1, best.l.y1, best.l.x2, best.l.y2] : null,
    };
  });
  const score = layers.length ? layers.reduce((s, l) => s + l.iou, 0) / layers.length : 0;
  const unseen = truth.layers.filter((l) => !used.has(l.id) && !l.is_hidden).map((l) => l.type ?? String(l.id));
  return { score, layers, unseen };
}

/** Each rebuilt design against every CMS design; the best wins, ties kept. */
export function matchDesigns(rebuilt: readonly RebuiltDesign[], truth: readonly OfferDesign[]): DesignMatch[] {
  return rebuilt.map((design) => {
    const scored = truth.map((t) => ({ t, ...scoreAgainst(design, t) }));
    const top = Math.max(...scored.map((s) => s.score));
    const winners = scored.filter((s) => s.score >= top - 1e-9);
    return {
      rebuilt: design.id,
      tiles: design.tiles.length,
      score: top,
      best: winners.map((w) => ({
        id: w.t.id, tag: w.t.tag, priority: w.t.offer_priority ?? null, offerType: w.t.offer_type ?? null,
      })),
      layers: winners[0]!.layers,
      unseen: winners[0]!.unseen,
    };
  });
}
