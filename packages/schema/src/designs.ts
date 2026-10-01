import { z } from 'zod';
import type { Offer } from './offer.js';
import type { MeasuredRect, TileFrame } from './template.js';

/**
 * How a page is designed, the way incito's offer designs work.
 *
 * Three layers, each deciding one thing:
 *
 *   1. ZONES — the page's cells. Each says who stands in it ("the lead",
 *      "a member price first", "the rest in order"), which is incito's
 *      A offer made explicit. See `PageDesign.zones`.
 *   2. A DESIGN GROUP — "Grøn", "Rød" — for the page: the colours of
 *      the price disc and the stickers. Incito's design tag.
 *   3. VARIANTS within the group — Normal, Hovedvare, Medlemspris,
 *      Spar %, Livsstil. Each is a whole arrangement of the cell: where
 *      the picture, the words and the price stand, which lines are said,
 *      which stickers there are and what the price mark shows. The
 *      chain's rules choose the variant (`OfferRule.then.variant`).
 *
 * A sticker is only drawn when there is something to say on it — "Før
 * 29,-" needs a previous price — so no variant ever prints an empty box,
 * and nothing is written in a template language.
 */

/* ---------------------------------------------------------- variants */

export const VARIANTS = ['normal', 'lead', 'member', 'savings', 'reduced', 'new', 'lifestyle'] as const;
export type Variant = (typeof VARIANTS)[number];

/** What a sticker can say, in the order a slot tries them. */
export type StickerKind = 'before' | 'member' | 'savings' | 'reduced' | 'multibuy' | 'campaign' | 'new' | 'tested' | 'warranty';

export interface StickerSlot {
  /** Tried in order; the first with something to say is drawn. */
  kinds: StickerKind[];
  rect: MeasuredRect;
  /** The group's accent colour, or dark. */
  tone: 'accent' | 'dark';
}

/** A variant's arrangement in a square cell — see `reshape` for the others. */
export interface VariantShape {
  media: MeasuredRect;
  words: MeasuredRect;
  price: MeasuredRect;
  stickers: StickerSlot[];
  wordsAlign: 'start' | 'end';
}

export interface VariantDesign {
  name: string;
  hint: string;
  shape: VariantShape;
  /** The price as numerals on the paper, or on the group's disc. */
  priceShape: 'plain' | 'disc';
  /** The mark shows the member price, with the ordinary one as "før". */
  memberPrice?: boolean;
  /** The picture fills the cell, under white words. */
  cover?: boolean;
  priceScale?: number;
  /** The lines said, besides the name. */
  says: { brand: boolean; description: boolean; comparison: boolean };
}

const r = (x: number, y: number, w: number, h: number): MeasuredRect => ({ x, y, w, h });
const BEFORE: StickerSlot = { kinds: ['before', 'multibuy', 'campaign'], rect: r(0, 0, 0.24, 0.2), tone: 'accent' };
/**
 * The chain's marks, as Bilka's designs place them: one slot beside the
 * picture that says Nyhed, Testet or the warranty — whichever the offer
 * has — and nothing at all when it has none. Every variant carries it,
 * so a mark is never lost because a rule chose another arrangement.
 */
const MARK: StickerSlot = { kinds: ['new', 'tested', 'warranty'], rect: r(0.76, 0, 0.24, 0.16), tone: 'dark' };
/** Bilka's "Nedsat pris" sticker: at the picture's lower left, over the fold to the words. */
const LOWERED: StickerSlot = { kinds: ['reduced'], rect: r(0, 0.44, 0.3, 0.14), tone: 'accent' };

/**
 * The variants, drawn after 365discount's "Offer A" design: an ordinary
 * offer has its picture on top and a large bare price beside a narrow
 * column of words; the page's lead has a larger picture and its price
 * on the group's disc, leaning into the picture; a member price stands
 * on the disc with the member sticker over it.
 */
export const VARIANT_DESIGNS: Record<Variant, VariantDesign> = {
  normal: {
    name: 'Normal',
    hint: 'Billedet øverst, en smal tekstkolonne og en stor pris uden skilt',
    priceShape: 'plain',
    says: { brand: false, description: true, comparison: true },
    shape: {
      media: r(0.13, 0.02, 0.74, 0.6), words: r(0.03, 0.62, 0.4, 0.36), price: r(0.44, 0.6, 0.54, 0.38),
      stickers: [BEFORE, LOWERED, MARK], wordsAlign: 'end',
    },
  },
  lead: {
    name: 'Hovedvare',
    hint: 'Stort billede, prisen på skiltet ind over billedet',
    priceShape: 'disc',
    says: { brand: true, description: true, comparison: true },
    shape: {
      media: r(0.14, 0, 0.72, 0.78), words: r(0.03, 0.58, 0.38, 0.4), price: r(0.48, 0.44, 0.5, 0.54),
      stickers: [BEFORE, MARK], wordsAlign: 'end',
    },
  },
  member: {
    name: 'Medlemspris',
    hint: 'Medlemsprisen på skiltet, medlemsmærket over den',
    priceShape: 'disc',
    memberPrice: true,
    says: { brand: false, description: true, comparison: true },
    shape: {
      media: r(0.04, 0.02, 0.92, 0.6), words: r(0.03, 0.62, 0.38, 0.36), price: r(0.46, 0.46, 0.52, 0.52),
      stickers: [
        { kinds: ['member'], rect: r(0.42, 0.34, 0.3, 0.16), tone: 'dark' },
        { kinds: ['before', 'multibuy', 'campaign'], rect: r(0, 0, 0.24, 0.2), tone: 'accent' },
        MARK,
      ],
      wordsAlign: 'end',
    },
  },
  savings: {
    name: 'Spar %',
    hint: 'Besparelsen i procent som mærke, prisen på skiltet',
    priceShape: 'disc',
    says: { brand: false, description: true, comparison: true },
    shape: {
      media: r(0.04, 0.02, 0.92, 0.66), words: r(0.03, 0.62, 0.38, 0.36), price: r(0.5, 0.5, 0.48, 0.48),
      stickers: [
        { kinds: ['savings'], rect: r(0, 0, 0.36, 0.2), tone: 'accent' },
        { kinds: ['before'], rect: r(0.03, 0.5, 0.3, 0.1), tone: 'dark' },
        MARK,
      ],
      wordsAlign: 'end',
    },
  },
  reduced: {
    name: 'Nedsat pris',
    hint: '«Nedsat pris» ved billedet, førprisen over den nye pris på skiltet',
    priceShape: 'disc',
    says: { brand: false, description: true, comparison: true },
    shape: {
      media: r(0.1, 0.02, 0.8, 0.6), words: r(0.03, 0.62, 0.4, 0.36), price: r(0.46, 0.5, 0.52, 0.48),
      stickers: [
        { kinds: ['reduced', 'savings'], rect: r(0, 0.46, 0.34, 0.13), tone: 'accent' },
        { kinds: ['before'], rect: r(0.62, 0.38, 0.36, 0.1), tone: 'dark' },
        { kinds: ['multibuy', 'campaign'], rect: r(0, 0, 0.24, 0.2), tone: 'accent' },
        MARK,
      ],
      wordsAlign: 'end',
    },
  },
  new: {
    name: 'Nyhed',
    hint: '«Nyhed» som mærke øverst til venstre, billedet stort, prisen uden skilt',
    priceShape: 'plain',
    says: { brand: true, description: true, comparison: true },
    shape: {
      media: r(0.08, 0.04, 0.84, 0.58), words: r(0.03, 0.62, 0.42, 0.36), price: r(0.46, 0.6, 0.52, 0.38),
      stickers: [
        { kinds: ['new'], rect: r(0, 0, 0.26, 0.2), tone: 'accent' },
        { kinds: ['before', 'multibuy', 'campaign'], rect: r(0.74, 0, 0.26, 0.16), tone: 'dark' },
        { kinds: ['tested', 'warranty'], rect: r(0, 0.46, 0.3, 0.12), tone: 'dark' },
      ],
      wordsAlign: 'end',
    },
  },
  lifestyle: {
    name: 'Livsstil',
    hint: 'Fotoet fylder feltet, prisen og teksten står ovenpå',
    priceShape: 'disc',
    cover: true,
    says: { brand: false, description: true, comparison: false },
    shape: {
      media: r(0, 0, 1, 1), words: r(0.04, 0.05, 0.62, 0.28), price: r(0.02, 0.36, 0.44, 0.4),
      stickers: [
        { kinds: ['before', 'multibuy', 'campaign'], rect: r(0.76, 0, 0.24, 0.2), tone: 'accent' },
        { kinds: ['reduced', 'new', 'tested', 'warranty'], rect: r(0.02, 0.78, 0.3, 0.12), tone: 'accent' },
      ],
      wordsAlign: 'start',
    },
  },
};

/**
 * The square arrangement, for a cell of another shape: in a wide cell
 * the picture goes left and the words and price stack in the right-hand
 * column; in a tall one everything stacks. A photograph filling the cell
 * keeps its arrangement.
 */
export function reshape(shape: VariantShape, aspect: number, cover = false): VariantShape {
  if (cover || (aspect > 0.72 && aspect < 1.35)) return shape;
  if (aspect >= 1.35) {
    // Kept wide enough to say "Nedsat pris" on one line, and inside the picture's half.
    const stickers = shape.stickers.map((slot) => {
      const w = Math.min(0.5, slot.rect.w * 0.8);
      return { ...slot, rect: r(Math.min(slot.rect.x * 0.55, 0.56 - w), slot.rect.y, w, slot.rect.h) };
    });
    return {
      media: r(0.02, 0.04, 0.54, 0.92), words: r(0.58, 0.06, 0.4, 0.42), price: r(0.58, 0.5, 0.4, 0.46),
      stickers, wordsAlign: 'start',
    };
  }
  return {
    media: r(0.05, 0.04, 0.9, 0.52), words: r(0.05, 0.58, 0.9, 0.2), price: r(0.05, 0.78, 0.7, 0.2),
    stickers: shape.stickers.map((slot) => ({ ...slot, rect: r(slot.rect.x, slot.rect.y * 0.6, slot.rect.w, slot.rect.h * 0.6) })),
    wordsAlign: 'start',
  };
}

/**
 * The same arrangement turned round: price on the left, words on the
 * right. Incito rotates the designs that share a tag evenly down a page
 * so no two neighbours are twins; this is that rotation, and it never
 * moves a box out of the cell or changes what is said.
 */
export function mirror(shape: VariantShape): VariantShape {
  const flip = (box: MeasuredRect): MeasuredRect => ({ ...box, x: 1 - box.x - box.w });
  return {
    media: flip(shape.media),
    words: flip(shape.words),
    price: flip(shape.price),
    stickers: shape.stickers.map((slot) => ({ ...slot, rect: flip(slot.rect) })),
    wordsAlign: shape.wordsAlign === 'end' ? 'start' : 'end',
  };
}

/* ------------------------------------------------------------ groups */

export interface DesignGroup {
  id: string;
  name: string;
  /** The price disc, and what is written on it. */
  disc: string;
  discInk: string;
  /** The "Før-pris" and "Spar" stickers. */
  accent: string;
  accentInk: string;
}

export const DESIGN_GROUPS: readonly DesignGroup[] = [
  { id: 'standard', name: 'Kædens farver', disc: 'var(--brand)', discInk: '#fff', accent: 'var(--ink)', accentInk: '#fff' },
  { id: 'green', name: 'Grøn', disc: '#00553a', discInk: '#fff', accent: '#00a139', accentInk: '#fff' },
  { id: 'red', name: 'Rød', disc: '#e23636', discInk: '#fff', accent: '#1d1d1b', accentInk: '#fff' },
  { id: 'dark', name: 'Mørk', disc: '#1d1d1b', discInk: '#ffd400', accent: '#ffd400', accentInk: '#1d1d1b' },
];

export function designGroup(id: string | null | undefined): DesignGroup | null {
  return id ? DESIGN_GROUPS.find((group) => group.id === id) ?? null : null;
}

/* ------------------------------------------------------------- zones */

/** Who stands in a zone. `auto`: the next offer in order of weight. */
export const ZONE_TAKES = ['auto', 'lead', 'member', 'savings', 'reduced', 'new', 'lifestyle', 'multibuy'] as const;
export type ZoneTake = (typeof ZONE_TAKES)[number];

export const PageDesign = z.object({
  /** A `DesignGroup` id. */
  group: z.string().min(1).max(40),
  /** The chain's offer design tag this page is drawn in — see `OfferDesign`. */
  tag: z.string().max(120).nullable().optional(),
  /** Slot id → who stands there. Absent: `auto`. */
  zones: z.record(z.string(), z.enum(ZONE_TAKES)).default({}),
});
export type PageDesign = z.infer<typeof PageDesign>;

/* ------------------------------------------------------------- frame */

const kr = (value: number) => {
  const whole = Math.round(value * 100) % 100 === 0;
  return whole ? `${Math.round(value)},-` : value.toFixed(2).replace('.', ',');
};

/** What a sticker says for this offer — null when there is nothing to say. */
export function stickerText(kind: StickerKind, offer: Offer, words: { member?: string | null } = {}): string | null {
  switch (kind) {
    case 'before':
      return offer.prePrice !== null && offer.prePrice > offer.price ? `Før ${kr(offer.prePrice)}` : null;
    case 'member': {
      if (offer.memberPrice === null && !offer.labels.some((label) => label.kind === 'member')) return null;
      if (words.member) return words.member;
      const saved = offer.memberPrice !== null && offer.memberPrice < offer.price ? offer.price - offer.memberPrice : null;
      return saved ? `Medlemsrabat ${kr(saved)}` : 'Medlemspris';
    }
    case 'savings': {
      const pct = offer.savingsPercent
        ?? (offer.prePrice !== null && offer.prePrice > offer.price ? ((offer.prePrice - offer.price) / offer.prePrice) * 100 : null);
      return pct && pct >= 1 ? `Spar ${Math.round(pct)} %` : null;
    }
    case 'reduced': {
      const said = offer.labels.find((label) => /nedsat/i.test(label.text))?.text;
      if (said) return said;
      return offer.prePrice !== null && offer.prePrice > offer.price ? 'Nedsat pris' : null;
    }
    case 'new':
      return offer.labels.some((label) => label.kind === 'new' || /\bnyhed\b|^ny$/i.test(label.text)) ? 'Nyhed' : null;
    case 'tested':
      return offer.labels.find((label) => /\btest(et|vinder)?\b|bedst i test/i.test(label.text))?.text ?? null;
    case 'warranty':
      return offer.labels.find((label) => /garanti|warranty/i.test(label.text))?.text ?? null;
    case 'multibuy':
      return offer.labels.find((label) => label.kind === 'multibuy')?.text ?? null;
    case 'campaign':
      return offer.campaign.trim() || null;
  }
}

/**
 * One offer, drawn in one variant of one group, in a cell of this shape:
 * the frame the tile draws, the price shape, and the offer as the mark
 * should state it (a member price in the figure, the ordinary one "før").
 */
export function variantFrame(
  variant: Variant, group: DesignGroup, offer: Offer, aspect: number, words: { member?: string | null } = {},
  /** Which turn of the rotation this cell is — see `mirror`. Odd turns are mirrored. */
  turn = 0,
): { frame: TileFrame; priceShape: 'plain' | 'disc'; offer: Offer } {
  const design = VARIANT_DESIGNS[variant];
  const square = reshape(design.shape, aspect, design.cover);
  const shape = turn % 2 === 1 && !design.cover && aspect > 0.72 ? mirror(square) : square;
  // A slot says one thing, and one thing is said once: "Nyhed" in its own slot is not repeated in the marks.
  const said = new Set<StickerKind>();
  const stickers = shape.stickers.flatMap((slot) => {
    for (const kind of slot.kinds) {
      if (said.has(kind)) continue;
      const text = stickerText(kind, offer, words);
      if (text) {
        said.add(kind);
        return [{
          rect: slot.rect, text, kind,
          fill: slot.tone === 'accent' ? group.accent : '#1d1d1b',
          ink: slot.tone === 'accent' ? group.accentInk : '#fff',
        }];
      }
    }
    return [];
  });
  const shown = design.memberPrice && offer.memberPrice !== null && offer.memberPrice < offer.price
    ? { ...offer, price: offer.memberPrice, prePrice: offer.price, savings: null }
    : offer;
  const hide = [
    ...(design.says.brand ? [] : ['brand']),
    ...(design.says.description ? [] : ['description']),
    ...(design.says.comparison ? [] : ['meta']),
  ];
  return {
    frame: {
      media: shape.media,
      words: shape.words,
      price: shape.price,
      wordsAlign: shape.wordsAlign,
      laid: true,
      stickers,
      hide,
      ...(design.priceShape === 'disc' ? { priceFill: group.disc, priceInk: group.discInk } : {}),
      ...(design.cover ? { cover: true, scrim: true, light: true } : {}),
      ...(design.priceScale ? { priceScale: design.priceScale } : {}),
    },
    priceShape: design.priceShape,
    offer: shown,
  };
}

/**
 * A frame for a cell that runs off the paper, drawn into the part of it
 * that is on the paper — a hero measured 105 % of the page wide put its
 * price past the edge. Every box is moved in, in proportion.
 */
export function onPaper(frame: TileFrame, cell: MeasuredRect): TileFrame {
  const x0 = Math.max(0, cell.x);
  const x1 = Math.min(1, cell.x + cell.w);
  const y0 = Math.max(0, cell.y);
  const y1 = Math.min(1, cell.y + cell.h);
  if (x0 === cell.x && x1 === cell.x + cell.w && y0 === cell.y && y1 === cell.y + cell.h) return frame;
  const sx = (x1 - x0) / cell.w;
  const sy = (y1 - y0) / cell.h;
  const ox = (x0 - cell.x) / cell.w;
  const oy = (y0 - cell.y) / cell.h;
  const move = (box: MeasuredRect): MeasuredRect => ({ x: ox + box.x * sx, y: oy + box.y * sy, w: box.w * sx, h: box.h * sy });
  return {
    ...frame,
    media: frame.cover ? frame.media : move(frame.media),
    ...(frame.words ? { words: move(frame.words) } : {}),
    ...(frame.price ? { price: move(frame.price) } : {}),
    ...(frame.stickers ? { stickers: frame.stickers.map((sticker) => ({ ...sticker, rect: move(sticker.rect) })) } : {}),
  };
}
