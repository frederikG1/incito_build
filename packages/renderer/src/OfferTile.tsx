import { useState } from 'react';
import type { CSSProperties } from 'react';
import type {
  FrameLine, FrameStack, MeasuredRect, Offer, OfferLabel, PlacementOverrides, PriceShape,
  SlotRole, TilePart, TileArrangement, TileFrame,
} from '@incitio/schema';
import { wordsBesidePrice } from './words.js';
import {
  TILE_PARTS, packOverride, packStack, partOverride, tileArranged, PlacementOverrides as Overrides,
} from '@incitio/schema';
import { formatPrice, formatQuantity, splitPrice } from './format.js';

/**
 * A certification mark, rendered as artwork.
 *
 * Chains contract for the Ø-mark itself, not the word "Økologi" in a
 * box. Where the artwork fails to load the wording comes back rather
 * than leaving a hole — several marks in the shipped dictionary are
 * hosted on origins that are not always reachable.
 */
function LabelMark({ label }: { label: OfferLabel }) {
  const [broken, setBroken] = useState(false);
  if (broken || !label.image) {
    return <li className={`tag tag--${label.kind}`}>{label.text}</li>;
  }
  return (
    <li className="tag tag--mark">
      <img src={label.image} alt={label.text} onError={() => setBroken(true)} />
    </li>
  );
}

export interface OfferTileProps {
  offer: Offer;
  role: SlotRole;
  /**
   * The cell's measured design, when it was read off a published page:
   * where the packshot, the price mark and the words sit. Each part is
   * placed in its box and stays exactly as editable as before — see
   * `TemplateSlot.frame`.
   */
  frame?: TileFrame;
  /** The cell's width as a share of the page, when the cell is measured. */
  cellWidth?: number;
  /** The cell's height, in the same unit as `cellWidth` — a share of the page's WIDTH. */
  cellHeight?: number;
  priceShape: PriceShape;
  overrides?: PlacementOverrides;
  selected?: boolean;
  /**
   * Which single box of the tile the editor has hold of.
   *
   * Sits here beside `selected` for the same reason that one does: the
   * print render simply never passes it, so the marker costs the PDF
   * nothing and the editor does not need a second copy of this
   * component to draw a selection on.
   */
  selectedPart?: TilePart | null;
  /**
   * Which product of a cluster is in hand, by its place in the pack.
   *
   * Beside `selectedPart` rather than folded into it, because the two
   * are not alternatives: a variant that is in hand is always a variant
   * of the artwork box, and both markers are wanted on the page at once
   * — the box outlined, the product inside it outlined harder.
   */
  selectedPack?: number | null;
  /**
   * The composed picture this cluster was stood up from, drawn over it.
   *
   * Editor only, like `selectedPack`, and for the same kind of reason:
   * the print render never passes it. What it answers is the question
   * the feature could not answer before — whether the tile actually
   * matches the picture it was given. The rectangle is in fractions of
   * the artwork box and comes from the same mapping the products got,
   * so a product that landed correctly lies exactly on its own
   * photograph in the ghost, and one that did not is visibly beside it.
   */
  reference?: {
    url: string;
    left: number;
    top: number;
    width: number;
    height: number;
  } | null;
  onSelect?: (offerId: string) => void;
  /**
   * Only the products — a cluster standing in a published page's cell,
   * whose words and price the publication itself prints. See `incitoPacks`.
   */
  artworkOnly?: boolean;
}

/**
 * Whether a line of the printed page's own words states an amount this
 * offer does not have.
 *
 * A measured cell keeps the words the page set around its price —
 * "Pris ikke-medlem op til 84,95", "Medlemsrabat op til 25,95". They
 * were true of the product printed there, and printed under next week's
 * product they are a price nobody set.
 */
function foreignAmount(text: string, offer: Offer): boolean {
  const known = new Set<string>();
  for (const value of [offer.price, offer.prePrice, offer.savings, offer.savingsMax, offer.comparison?.value]) {
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    known.add(value.toFixed(2).replace('.', ''));
    if (Number.isInteger(value)) known.add(String(value));
  }
  const amounts = text.match(/\d+[.,]\d{2}(?!\d)|\d+,-|^\s*\d{3,}\s*$/g) ?? [];
  return amounts.some((amount) => !known.has(amount.replace(/\D/g, '')));
}

/** Whether one box's middle lies inside another — a disc drawn under a sticker's words. */
function covers(outer: MeasuredRect, inner: MeasuredRect): boolean {
  const x = inner.x + inner.w / 2;
  const y = inner.y + inner.h / 2;
  return x >= outer.x && x <= outer.x + outer.w && y >= outer.y && y <= outer.y + outer.h;
}

/** A tile nobody has corrected. Parsed once; the shape never varies. */
const UNTOUCHED: PlacementOverrides = Overrides.parse({});

/**
 * Where a box grows from when it is scaled.
 *
 * The artwork and the price mark are objects with a middle, so they
 * grow around it. A line of type is anchored to where it starts
 * reading: growing a headline from its centre walks the first letter
 * left, away from everything the editor aligned it against.
 */
const PART_ORIGIN: Partial<Record<TilePart, string>> = {
  media: 'center',
  price: 'center',
  marks: 'left top',
};

/**
 * How many variant images a tile shows before it stops being legible.
 *
 * A ceiling on what a FEED hands over. It was three on a standard cell,
 * written for feeds that repeat one yoghurt eight times — but the Tjek
 * export lists each variant as its own product ("San Pellegrino lemon,
 * aranciata, vand, Änglamark …"), and dropping half of those printed a
 * tile that sold fewer things than its name promised, while the
 * inspector listed them all. Too many for the cell is what the crowded
 * warning is for; silently leaving products out is not.
 */
const MAX_PACK: Record<SlotRole, number> = {
  hero: 8,
  feature: 6,
  standard: 6,
  compact: 1,
};

/**
 * The same ceiling for a tile somebody ASSEMBLED — see `Offer.members`.
 *
 * Higher, because the two are not the same thing. A feed's motives are
 * variations the tile may summarise; a group's members are the products
 * an editor chose to put in that cell, and showing four of their six is
 * not a summary, it is a tile that lost two of the things it is selling.
 * The schema's own ceiling is eight, and it is the one that applies —
 * except on a compact cell, which is too small for a cluster whoever
 * built it.
 */
const MAX_GROUP: Record<SlotRole, number> = {
  hero: 8,
  feature: 8,
  standard: 8,
  compact: 2,
};

/** How many promotional tags each role has room for. */
const MAX_TAGS: Record<SlotRole, number> = {
  hero: 3, feature: 2, standard: 1, compact: 0,
};

/**
 * How many certification marks each role has room for.
 *
 * Its own table, and the difference from `MAX_TAGS` is the whole reason
 * it exists. A promotional chip is the chain talking — "Spar 25%" — and
 * the first thing a crowded tile should drop. A certification mark is a
 * claim about the product that the chain has contracted to print, and
 * the smallest tile is exactly where it used to be dropped: `compact`
 * shared the tags' allowance of zero, so a small organic offer printed
 * no Ø-mark at all. The chain's own week-37 book sets the mark on every
 * tile including the smallest ones.
 *
 * One apiece below hero, because the strip is a single row that is cut
 * rather than wrapped — see `.tile__marks`.
 */
const MAX_MARKS: Record<SlotRole, number> = {
  hero: 3, feature: 2, standard: 2, compact: 1,
};

/**
 * How the images of a multi-variant offer are arranged.
 *
 * Published pages do not print every "frit valg" tile the same way. On
 * one Coop page the pålæg trays overlap in a staggered row with the
 * middle one in front, the spegepølse packs sit in a 2×2 block, the
 * bread bags fan across, and the fiskefrikadeller are two trays offset
 * diagonally. One arrangement everywhere is the single clearest tell
 * that a page was generated.
 */
export type PackStyle = TileArrangement;

/**
 * Deterministic 0..1 from an offer id (FNV-1a, 32-bit).
 *
 * The arrangement has to VARY across a page but must not vary between
 * two renders of the same catalogue, or the editor would reshuffle
 * under the user and a printed proof would not match the screen.
 * Drawing it from the offer's own id gives both.
 */
function stableFraction(id: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return ((hash >>> 0) % 10_000) / 10_000;
}

/**
 * Pick an arrangement for this offer's variants.
 *
 * Constrained by count, because the shapes are not interchangeable:
 * four or more items read as a block, two or three as a row, and a fan
 * only works when the items are tall enough to rotate without their
 * corners leaving the tile.
 */
export function packStyle(offerId: string, count: number, role: SlotRole): PackStyle {
  if (count === 4) return stableFraction(offerId) < 0.55 ? 'grid' : 'stagger';
  /*
   * Five or more is a block, not a row.
   *
   * A row divides the cell's WIDTH by the number of items and leaves
   * its height alone, so six products in a half-page band came out a
   * sixth of it wide, a fifth of it tall, and floating in an empty
   * field — while the published tile this layout was read off fills
   * the same cell edge to edge. A block spends both dimensions. See
   * `.tile__pack--grid`, which takes its column count from how many
   * there are rather than always being two across.
   */
  if (count > 4) return 'grid';
  // A fan needs room to rotate without its corners leaving the tile, so
  // a compact tile is offered only the two upright shapes.
  const options: PackStyle[] = role === 'compact'
    ? ['stagger', 'row']
    : ['stagger', 'row', 'fan'];
  return options[Math.floor(stableFraction(offerId) * options.length)]!;
}

/**
 * Where a box sits once someone has moved it.
 *
 * Lifted, so what was just dragged lands on top of what it was dragged
 * over. It has to clear every layer the stylesheet gives a tile — the
 * words are at 20 and the price mark at 30 — because this is an INLINE
 * style and it wins: at 6, which is what it was while the tile's own
 * layers were still 2–5, dragging the price mark quietly dropped it
 * from 30 to 6 and it went behind the words it was being moved onto.
 * A box that vanishes when you move it reads as a broken editor.
 *
 * No `position` alongside it, deliberately: the price mark and the
 * certification column are absolutely positioned against the artwork,
 * and `position: relative` here would unpin them. Flex and grid items
 * honour `z-index` without it, and every box in this tile is one or the
 * other.
 *
 * Checked against the stylesheet in `overlay.test.ts`, together with
 * the editor overlay that has to stay above this in turn.
 *
 * And lifted where it counts: the price mark lives INSIDE `.tile__info`,
 * which is a stacking context of its own at 20. A lift on the price
 * alone stayed at 20 as far as the rest of the tile was concerned, so a
 * member price dragged onto its own drawn roundel (`.tile__art`, 31)
 * went under the white disc and vanished. The block is lifted with it —
 * see `infoMoved`.
 */
const LIFTED = 38;

/**
 * One offer, drawn at whatever size its slot gives it.
 *
 * There are no "small" and "large" variants of this component — there is
 * one component and a role. Secondary information drops out as the role
 * gets tighter, in the order a designer would drop it (description, then
 * unit price, then brand), and the stylesheet does the rest through
 * container queries. That is what lets one tile stay legible from a
 * half-page hero down to a ninth-page filler.
 */

/** A page share as a length that scales with the sheet. */
const pageLength = (share: number) => `calc(${share} * 100cqw)`;

/** A box of lines stacked the way the page stacked them. */
function stackStyle(stack: FrameStack | undefined): CSSProperties {
  return {
    display: 'flex',
    flexDirection: 'column',
    alignItems: stack?.align ?? 'center',
    justifyContent: stack?.justify ?? 'center',
  };
}

/** Words with a superscript stretch — "15⁹⁵" — and their own line breaks. */
function lineText(line: FrameLine) {
  if (!line.sup || line.sup.end <= line.sup.start) return line.text;
  return (
    <>
      {line.text.slice(0, line.sup.start)}
      <sup>{line.text.slice(line.sup.start, line.sup.end)}</sup>
      {line.text.slice(line.sup.end)}
    </>
  );
}

/**
 * One line set as the published page set it. The figure line gets the
 * LIVE price and the pack line the offer's own pack, so an edited price
 * prints; every other line is the page's words.
 */
function Line({ line, children }: { line: FrameLine; children?: React.ReactNode }) {
  return (
    <span
      className={`frameline frameline--${line.role}`}
      style={{
        fontSize: pageLength(line.size),
        ...(line.color ? { color: line.color } : {}),
        // The publication's heading face is the chain's bold cut — COOP 700 for SuperBrugsen.
        fontWeight: line.bold || line.face === 'heading' ? 700 : 400,
        ...(line.face === 'heading' ? { fontFamily: 'var(--heading-font)' } : {}),
        ...(line.upper ? { textTransform: 'uppercase' } : {}),
        ...(line.align ? { textAlign: line.align } : {}),
        ...(line.lineHeight ? { lineHeight: line.lineHeight } : {}),
        ...(line.margin ? { margin: line.margin.map(pageLength).join(' ') } : {}),
        ...(typeof line.width === 'string' ? { width: line.width } : {}),
        ...(typeof line.width === 'number' ? { width: pageLength(line.width) } : {}),
      }}
    >
      {children ?? lineText(line)}
    </span>
  );
}

export function OfferTile({
  offer, role, priceShape, overrides, selected, selectedPart, selectedPack, reference,
  onSelect, frame, cellWidth, cellHeight, artworkOnly,
}: OfferTileProps) {
  const corrections = overrides ?? UNTOUCHED;

  /**
   * Where a measured cell puts this part — its box, in shares of the
   * cell. Only the media, the price mark and the words have boxes; the
   * rest of the parts live inside the words, as they do on the page.
   */
  function framedStyle(id: TilePart): CSSProperties | null {
    if (!frame) return null;
    const at = (rect: MeasuredRect): CSSProperties => ({
      left: `${rect.x * 100}%`,
      top: `${rect.y * 100}%`,
      width: `${rect.w * 100}%`,
      height: `${rect.h * 100}%`,
    });
    if (id === 'media') return at(frame.media);
    if (id === 'price' && frame.price) {
      /*
       * Kept inside its own cell. The rectangle was measured on the
       * publication, where the offer had a little more room around it;
       * redrawn on the chain's grid, a mark in the bottom row reached
       * 1–2 % past its cell — and past the paper, which cuts it off.
       * Nudged back in, never shrunk.
       */
      const mark = frame.price;
      const held = {
        ...mark,
        x: mark.w < 1 ? Math.min(mark.x, 1 - mark.w) : mark.x,
        y: mark.h < 1 ? Math.min(mark.y, 1 - mark.h) : mark.y,
      };
      return {
        ...at(held),
        ...(frame.splash ? { backgroundImage: `url("${frame.splash}")` } : {}),
        ...(frame.priceInk ? { color: frame.priceInk } : {}),
      };
    }
    return null;
  }

  /**
   * The attributes that make one box addressable, and put it where the
   * editor left it.
   *
   * Offsets are spent in `cqw`/`cqh` — the page is the size container,
   * so a box stays where it was put whether the page is a 240px
   * thumbnail on screen or A4 at 300dpi under Chromium. A percentage
   * would resolve against the box itself and every element would move a
   * different distance for the same drag.
   *
   * An untouched box gets no style at all, not a style that happens to
   * be the identity: a `transform` creates a containing block, and one
   * on `.tile__media` would re-root the price mark hanging off it.
   */
  function box(id: TilePart) {
    const placed = frame ? framedStyle(id) : null;
    const marker = {
      'data-part': id,
      ...(selectedPart === id ? { 'data-part-selected': 'true' } : {}),
      ...(placed ? { style: placed } : {}),
    };
    // The artwork is addressable like every other box but carries its
    // own transform, in its own frame-relative units — see `mediaStyle`
    // below. Handing it a second one here would move it twice.
    if (id === 'media') return marker;

    const part = partOverride(corrections, id);
    if (part.offsetX === 0 && part.offsetY === 0 && part.scale === 1) return marker;

    return {
      ...marker,
      style: {
        ...placed,
        transform: `translate(${part.offsetX}cqw, ${part.offsetY}cqh) scale(${part.scale})`,
        transformOrigin: PART_ORIGIN[id] ?? 'left top',
        zIndex: LIFTED,
      } satisfies CSSProperties,
    };
  }

  /** Something inside the words block has been moved, so the block rises with it. */
  const infoMoved = TILE_PARTS.some((id) => {
    if (id === 'media') return false;
    const part = partOverride(corrections, id);
    return part.offsetX !== 0 || part.offsetY !== 0 || part.scale !== 1;
  });

  /** Whether this box prints at all. */
  const shown = (id: TilePart) => !partOverride(corrections, id).hidden;

  // Where the words stand: the measured box, never under the price mark.
  const column = frame?.words
    ? wordsBesidePrice(frame.words, shown('price') ? frame.price : undefined)
    : null;
  /** The editor's wording for a box that has no field of its own. */
  const wording = (id: TilePart) => partOverride(corrections, id).text;

  /*
   * A price of 0 means there is no price, not that it is free.
   *
   * Feeds carry mechanic offers whose whole proposition is the headline
   * — "Spar 20% på Irma varer", "Udvalgte opbevaringsglas". Printing
   * "0,00" on a price mark makes the loudest thing on the page a lie, so
   * the name carries the tile instead, which is what the leaflet does.
   */
  const hasPrice = offer.price > 0;
  const name = overrides?.displayName ?? offer.name;

  /*
   * A variant cluster, when the offer covers several products.
   *
   * "Frit valg" and "Flere varianter" are one price over several items,
   * and published leaflets print them as a group rather than picking one
   * at random — 72% of SuperBrugsen's offers supply two or more motives.
   * A compact tile shows one anyway: at that size a cluster is mush.
   */
  /*
   * Every line of a drawn price mark or roundel, no wider than its box.
   *
   * The page states each size for the chain's own narrow face; the
   * stand-in face here is wider, so "25,-" ran into the roundel's
   * "MEDLEMSPRIS" arc and "Medlems-rabat op til" out of its little
   * white disc. Each line is shrunk — never grown — until its longest
   * run of characters fits the room the page gave it. Estimated from
   * the characters, so it holds in print, where nothing measures. Only
   * on a measured cell, where the box's size on the page is known.
   */
  function fitLine(line: FrameLine, box: MeasuredRect | undefined): FrameLine {
    if (!cellWidth || !box) return line;
    let room = box.w * cellWidth;
    if (typeof line.width === 'string') room *= parseFloat(line.width) / 100;
    else if (typeof line.width === 'number') room = line.width;
    if (line.margin) room -= Math.max(0, line.margin[1]!) + Math.max(0, line.margin[3]!);
    let ems: number;
    if (line.role === 'figure') {
      /*
       * Across the middle of the disc nearly its whole width is paper. A
       * digit of the chain's face is 0.6 em; øre are raised at 0.6 of
       * that, and ",-" is 0.45 — the same measure the plain mark uses
       * (see `figureFit`), so both kinds of mark give way alike.
       */
      room *= 0.85;
      ems = 0.6 * price.major.length + (price.minor === '00' ? 0.45 : 0.72) + (offer.priceFrom ? 1.1 : 0);
    } else if (cellHeight && box.h > 0) {
      /*
       * Words in a roundel wrap, as the page wraps them — "Pris / ikke- /
       * medle / mmer" in a disc a little wider than one word. Kept at
       * their printed size while they fit the disc's height at that
       * size, and only then made smaller. Measured as one line, as this
       * used to, a four-line badge came out a quarter of its size.
       */
      const across = room * 0.86;
      const lineHeight = line.size * (line.lineHeight ?? 1.1);
      const tall = box.h * cellHeight * 0.92;
      // The heading face is wide: measured on SuperBrugsen's, 0.64 em a character.
      const perChar = line.face === 'heading' ? 0.64 : line.bold ? 0.6 : 0.55;
      const rows = (size: number) => line.text.split('\n').reduce((sum, part) => sum + part.split(/\s+/)
        .reduce((count, word) => count + Math.max(1, Math.ceil((word.length * perChar * size) / across)), 0), 0);
      let size = line.size;
      while (size > line.size * 0.4 && rows(size) * size * (lineHeight / line.size) > tall) size *= 0.92;
      return size < line.size ? { ...line, size } : line;
    } else {
      // A round disc is narrower than its box away from the middle.
      room *= 0.86;
      const sup = line.sup ? line.sup.end - line.sup.start : 0;
      /*
       * A run of several words may wrap once, as the printed line does
       * ("Pris ikke-medlem / op til 41,95") — so it is measured as its
       * longer half, not squeezed onto one line.
       */
      const halves = (run: string) => {
        const words = run.split(' ');
        if (words.length < 3) return run.length;
        let best = run.length;
        for (let cut = 1; cut < words.length; cut += 1) {
          best = Math.min(best, Math.max(words.slice(0, cut).join(' ').length, words.slice(cut).join(' ').length));
        }
        return best;
      };
      const longest = Math.max(...line.text.split('\n').map(halves)) - sup * 0.45;
      ems = Math.max(1, longest) * (line.bold ? 0.6 : 0.55);
    }
    const cap = room / ems;
    return cap > 0 && cap < line.size ? { ...line, size: cap } : line;
  }

  /*
   * "fra" on the line above the number, in a measured mark.
   *
   * Set inline it made the number give up a third of its size to fit
   * the disc, and a SuperBrugsen price is the biggest thing on its
   * mark — "fra 12,-" in small figures reads as another chain's paper.
   * Above it, like "1 pose" or "Ugens køb", the number keeps the size
   * the publication gave it.
   */
  const fromAbove = Boolean(offer.priceFrom && frame?.price && frame.type?.figure);

  const room = offer.members.length > 0 ? MAX_GROUP[role] : MAX_PACK[role];
  const pack = offer.imagePack.slice(0, room);
  const isPacked = pack.length > 1;
  /*
   * Whoever decided, decides. The stylesheet's own answer is drawn from
   * the offer's id — stable and varied, and blind to what the products
   * look like — so an arrangement written onto the placement wins.
   */
  const arrangement = isPacked
    ? overrides?.arrangement ?? packStyle(offer.id, pack.length, role)
    : 'row';

  // The page's own stickers that state another product's amounts — and
  // the drawn disc under each, which would be left standing empty.
  const staleBadges = (frame?.badges ?? []).filter((badge) => badge.lines.some((line) => foreignAmount(line.text, offer)));

  // Price tags and certification marks compete for the same corner and
  // must not: a tile that can show one badge should show its Ø-mark, not
  // lose it behind "Spar 25%".
  const marks = offer.labels.filter((l) => l.image !== null);
  const promos = offer.labels.filter((l) => l.image === null);
  const tagRoom = MAX_TAGS[role];
  const promoCount = Math.min(promos.length, tagRoom);
  const markRoom = MAX_MARKS[role];

  /*
   * The supporting line, the editor's if one was written.
   *
   * An override of `''` is not the same as no override: it is someone
   * deciding this tile reads better without the line, and it has to
   * survive a re-render or the edit looks like it did not take.
   */
  const description = overrides?.description ?? offer.description;
  /*
   * Every tile, not just the big ones.
   *
   * This was gated to `hero` and `feature`, on the reasoning that a
   * supporting line is the first thing a crowded tile should drop. For
   * a marketing sentence that would be right. It is not what this line
   * holds: on a Danish grocery page it carries the comparison price
   * ("Kg-pris maks. 63,33"), which is required on every offer that
   * states one, alongside the qualifiers that make the price true at
   * all — "Flere varianter.", "Begrænset parti.". The printed week-37
   * book sets it under every single tile including the smallest, and
   * dropping it on four fifths of the page was not a density judgement
   * but a missing line.
   *
   * How MANY lines of it survive is still a density judgement, and
   * that is the stylesheet's to make per role — see the clamp on
   * `.tile__description`.
   */
  const showDescription = description !== '';
  /*
   * The brand line, unless the name already says it.
   *
   * Feeds routinely give both — "GOD MORGEN" and "Økologisk God Morgen
   * juice" — and printing the two together says the same thing twice
   * and costs the tile a line it does not have to spare. Published
   * tiles set the brand separately only when the name omits it.
   */
  const showBrand = role !== 'compact'
    && offer.brand !== ''
    && !name.toLowerCase().includes(offer.brand.toLowerCase());
  /*
   * Unit price and previous price are the first things a designer drops
   * on a crowded tile — they are reference figures, not the offer. A
   * compact tile never shows them; a standard one shows them only when
   * it is not already carrying a promotional chip.
   */
  const showMeta = role !== 'compact' && !(role === 'standard' && promoCount > 0);
  const showComparison = showMeta && offer.comparison !== null;

  const price = splitPrice(offer.price);

  /*
   * The figure of a plain measured mark, shrunk to fit its disc.
   *
   * Its size comes from the publication — `type.figure`, set for the
   * price that was printed there. A different price is not the same
   * width: "fra 30,-" on a cluster, or 109,95 in a mark set for 30,-,
   * ran straight out of the squircle. Same arithmetic as `fitLine`, so
   * both kinds of mark give up size the same way; never grown.
   */
  const figureFit: CSSProperties | undefined = (() => {
    if (!frame?.price || !frame.type?.figure || !cellWidth) return undefined;
    /*
     * Across the middle of the disc, where the figure stands, nearly its
     * whole width is paper — measured on SuperBrugsen's own marks, a
     * digit of the chain's face is 0.6 em and ",-" 0.45. So this only
     * steps in when the number genuinely does not fit: 109,95 in a mark
     * set for 30,-, never "10,-" in a mark set for "10,-".
     */
    const room = frame.price.w * cellWidth * 0.85;
    // "fra" stands on its own line above — see `fromAbove` — so only the number counts.
    const ems = 0.6 * price.major.length + (price.minor === '00' ? 0.45 : 0.75);
    const cap = room / ems;
    return cap > 0 && cap < frame.type.figure ? { fontSize: `${cap * 100}cqw` } : undefined;
  })();

  const hasBefore = offer.prePrice !== null && offer.prePrice > offer.price;
  const quantity = formatQuantity(
    offer.quantity.size, offer.quantity.unit, offer.quantity.pieceCount,
  );

  /*
   * The two lines the editor can rewrite that have no field of their
   * own — the pack size and the unit price. Both are computed from the
   * feed's numbers, and both are regularly wrong in a way only a person
   * looking at the product can fix ("140 g" on a tray sold by the
   * piece). An empty string is a real answer here and removes the line,
   * the same way it does on the supporting line.
   */
  const quantityText = wording('quantity') ?? quantity;
  const metaText = wording('meta');

  // Image nudges are stored normalised so they survive a template change.
  const mediaStyle: CSSProperties = {
    transform: `translate(${corrections.imageOffsetX * 20}%, ${corrections.imageOffsetY * 20}%) scale(${corrections.imageScale})`,
  };


  const className = [
    'tile',
    `tile--${role}`,
    isPacked && 'tile--packed',
    !hasPrice && 'tile--mechanic',
    /*
     * A price mark that carries no field of its own has to be given
     * clear ground to stand on.
     *
     * A disc or a tag brings its own background, so it can sit
     * anywhere on the product and stay legible — which is exactly what
     * the printed page does with it. A plain numeral has nothing
     * behind it, and the book never puts one over a packshot: on the
     * week-37 pages the black "12,-" always stands in open ground
     * beside the product, with the product placed off to one side to
     * leave it room. Rendered without that rule, a black numeral
     * landed on a dark pizza box and on a Ben & Jerry's tub and simply
     * disappeared.
     */
    hasPrice && priceShape === 'plain' && 'tile--clear-price',
    /*
     * Once a box has been moved out of the place the template gave it,
     * the tile stops clipping its own text block — otherwise the first
     * drag out of `.tile__info` simply makes the line disappear, which
     * reads as a broken editor rather than as a boundary. The slot is
     * still a hard edge, so nothing escapes onto a neighbouring tile.
     */
    tileArranged(corrections) && 'tile--arranged',
    frame && 'tile--framed',
    frame?.splash && 'tile--splashed',
    selected && 'is-selected',
  ].filter(Boolean).join(' ');

  return (
    <article
      className={className}
      data-offer-id={offer.id}
      style={frame?.type ? {
        '--f-name': String(frame.type.name),
        '--f-body': String(frame.type.body),
        ...(frame.type.figure > 0 ? { '--f-figure': String(frame.type.figure) } : {}),
        ...(frame.type.pack > 0 ? { '--f-pack': String(frame.type.pack) } : {}),
      } as CSSProperties : undefined}
      onClick={onSelect ? () => onSelect(offer.id) : undefined}
    >
      <div className="tile__media" {...box('media')}>
        {isPacked ? (
          <div
            className={`tile__pack tile__pack--${arrangement}`}
            style={mediaStyle}
            /* How many products share this cell. Read by the stylesheet,
               which overlaps them harder from five up — see
               `.tile__pack[data-count]`. */
            data-count={pack.length}
          >
            {pack.map((url, index) => {
              const item = packOverride(corrections, index);
              if (item.hidden) return null;
              const moved = item.offsetX !== 0 || item.offsetY !== 0
                || item.scale !== 1 || item.rotate !== 0;
              return (
                /*
                 * The middle item paints on top, not the last one.
                 *
                 * A group of products has a front — published tiles put
                 * the lead variant nearest the reader with the others
                 * behind it on each side. Stacking strictly by DOM order
                 * makes the rightmost item the front, which reads as a
                 * pile that fell over. One somebody has MOVED comes
                 * further forward still: a product dragged out of the
                 * pile was dragged out to be seen.
                 */
                <img
                  key={`${index}-${url}`}
                  src={url}
                  alt=""
                  loading="lazy"
                  /* Addressed like every other box, with its position in
                     the pack alongside — the editor hit-tests for both.
                     See `PlacementOverrides.pack`. */
                  data-part="media"
                  data-pack={index}
                  {...(selectedPack === index ? { 'data-pack-selected': 'true' } : {})}
                  style={{
                    /*
                     * The stylesheet's own order, with the editor's word
                     * over it — see `packStack`.
                     *
                     * A product that has been MOVED used to be lifted
                     * over the rest, on the reasoning that one dragged
                     * out of the pile was dragged out to be seen. That
                     * stopped meaning anything the moment a composition
                     * could move all of them at once: every product sat
                     * on the same lift and the stack fell back to
                     * document order, so the rightmost one ended up in
                     * front of a group it was never meant to lead. What
                     * replaced the guess is somebody saying which.
                     */
                    zIndex: packStack(pack.length, index, item.depth),
                    /*
                     * `translate`/`scale`/`rotate`, NOT `transform`.
                     *
                     * The arrangement writes `transform` on these very
                     * images — a stagger scales its odd children, a fan
                     * turns its outer ones — and an inline `transform`
                     * would replace it, so the first nudge of one
                     * variant would flatten the shape the cluster was
                     * arranged into. The individual properties apply
                     * BEFORE `transform` and compose with it.
                     */
                    ...(moved ? {
                      translate: `${item.offsetX}cqw ${item.offsetY}cqh`,
                      scale: String(item.scale),
                      rotate: `${item.rotate}deg`,
                    } : {}),
                  }}
                />
              );
            })}
          </div>
        ) : offer.imageUrl ? (
          <img src={offer.imageUrl} alt="" loading="lazy" style={mediaStyle} />
        ) : (
          <div className="tile__placeholder" aria-hidden="true">
            <span>{name.slice(0, 1).toUpperCase()}</span>
          </div>
        )}

        {/*
          * The picture the cluster was stood up from, laid over it.
          *
          * Drawn last so it is over the products, faint so they are
          * still readable through it, and unclickable so it cannot come
          * between a person and the thing they are dragging. It is a
          * proof, not a layer of the page: nothing in the document
          * carries it and the print render never receives one.
          */}
        {reference && (
          <img
            className="tile__ghost"
            src={reference.url}
            alt=""
            aria-hidden="true"
            style={{
              left: `${reference.left * 100}%`,
              top: `${reference.top * 100}%`,
              width: `${reference.width * 100}%`,
              height: `${reference.height * 100}%`,
            }}
          />
        )}
      </div>

      {!artworkOnly && (<>
      {/* The measured words box, less the price mark's corner — see `wordsBesidePrice`. */}
      <div className="tile__info" style={infoMoved ? { zIndex: LIFTED } : undefined}>
        {/*
          * The words, as one box.
          *
          * A wrapper earns its place here: the text block is a lockup
          * of two things — everything the chain says, and the number it
          * says it about — and with the sentences stacking inside their
          * own box the block itself is two cells and nothing else. Laid
          * out as one grid with every line in it, the mark had to span
          * a row count nobody knows in advance, and `1 / -1` does not
          * reach implicit rows: it resolved to the first line alone, so
          * the mark stood level with the product name instead of on
          * the last line of the block.
          */}
        <div
          className="tile__words"
          style={column ? {
            left: `${column.x * 100}%`,
            top: `${column.y * 100}%`,
            width: `${column.w * 100}%`,
            height: `${column.h * 100}%`,
            justifyContent: frame?.wordsAlign === 'end' ? 'flex-end' : 'flex-start',
          } : undefined}
        >
        {/*
          * Certification marks lead the text block.
          *
          * They were absolutely positioned in the artwork box's top-left
          * corner, which put a Dannebrog or an Ø-mark floating in open
          * ground with nothing beside it — it read as a stray graphic
          * rather than as a claim about the product below it. The
          * printed book sets them immediately above the headline,
          * flush with the left edge of the words they qualify, and a
          * mark that touches its own text is the whole reason it is
          * there.
          *
          * In the text block they are also in flow, so a tight tile
          * clips them last along with everything else instead of
          * printing them over the product.
          */}
        {markRoom > 0 && marks.length > 0 && shown('marks') && (
          <ul className="tile__marks" {...box('marks')}>
            {marks.slice(0, markRoom).map((label) => (
              <LabelMark key={`${label.kind}-${label.text}`} label={label} />
            ))}
          </ul>
        )}
        {showBrand && shown('brand') && (
          <p className="tile__brand" {...box('brand')}>{wording('brand') ?? offer.brand}</p>
        )}
        {shown('name') && <h3 className="tile__name" {...box('name')}>{name}</h3>}
        {quantityText && shown('quantity') && (!frame || wording('quantity') !== null) && (
          <p className="tile__quantity" {...box('quantity')}>{quantityText}</p>
        )}
        {showDescription && shown('description') && (
          <p className="tile__description" {...box('description')}>{description}</p>
        )}

        {/* The previous price has moved up onto the price mark, where a
            leaflet prints it; what is left here is the unit price the
            law requires. */}
        <p
          className="tile__meta"
          hidden={!showMeta || !shown('meta') || (Boolean(frame) && wording('meta') === null)}
          {...box('meta')}
        >
          {metaText !== null ? (
            // An empty rewrite is the editor removing the line, the same
            // way it is on the supporting line — not an empty span.
            metaText !== '' && <span className="tile__comparison">{metaText}</span>
          ) : showComparison && offer.comparison && (
            <span className="tile__comparison">
              {formatPrice(offer.comparison.value, offer.currency)} / {offer.comparison.unit}
            </span>
          )}
        </p>
        </div>

        {/*
          * The price mark, INSIDE the text block.
          *
          * Not beside it and not over it: the mark is the text block's
          * own right-hand column — see `.tile__info` — so the number
          * and the words it prices are laid out by one box, share a
          * baseline, and cannot be separated by any layout. Every
          * arrangement that moves the words takes the number with it,
          * because there is no longer anything to keep in step.
          *
          * It was pinned to the artwork before that, at 6% of the
          * picture's height, and then to the text block's cell — both
          * of which put the number somewhere ABOVE the sentence, a
          * distance that varied with whatever was over it. Measured on
          * one rebuilt page: 61px from its own words on one tile, 231px
          * on the next.
          *
          * Last in source order because it is last in reading order;
          * the grid puts it in the column, not the flow. Still carrying
          * `box('price')`, so every offset the editor writes lands on
          * top of wherever the layout put it.
          */}
        {hasPrice && shown('price') && frame?.priceLines && (
          /*
           * A price mark the page set line by line — a member price is
           * "Medlemsrabat", the saving, the price and "Pris ikke-medlem"
           * laid out against one drawn roundel. Reproduced line for line,
           * with the live price in the figure's place.
           */
          <div className={`price price--${priceShape} price--lines`} {...box('price')}>
            <span className="price__lines" style={stackStyle(frame.priceStack)}>
              {frame.priceLines
                .filter((line) => line.role !== 'note' || !foreignAmount(line.text, offer))
                .map((line, index) => (
                <Line key={`${index}-${line.role}`} line={fitLine(line, frame.price)}>
                  {line.role === 'figure' ? (
                    <span className="price__figure">
                      {offer.priceFrom && <span className="price__from">fra</span>}
                      <span className="price__major">{price.major}</span>
                      {price.minor === '00'
                        ? <span className="price__kr"><i aria-hidden="true" /><span>,</span></span>
                        : <span className="price__minor">{price.minor}</span>}
                    </span>
                  ) : line.role === 'pack' && offer.pack ? offer.pack : undefined}
                </Line>
              ))}
            </span>
          </div>
        )}
        {hasPrice && shown('price') && !frame?.priceLines && (
          <div className={`price price--${priceShape}`} {...box('price')}>
            {/*
              * What the number buys, directly above it.
              *
              * "1 pose" over 12,-. The chain sets it here rather than in
              * the fine print because a price above a photograph of six
              * bottles is ambiguous in exactly one direction, and this
              * is the line that settles it. Dropped on a compact tile,
              * where the mark is too small to carry two lines.
              */}
            {/* On a drawn splash the pack is a word or two ("1 pose"); a
                sentence there is fine print that was misread, and it
                would run straight off the shape. */}
            {offer.pack !== '' && role !== 'compact'
              && !(frame?.splash && offer.pack.length > 18) && (
              <span className="price__pack">{offer.pack}</span>
            )}
            {fromAbove && <span className="price__pack price__pack--from">fra</span>}
            {/* Small, struck through, hard against the offer price. The
                comparison only lands if the two read as one mark. */}
            {hasBefore && role !== 'compact' && (
              <span className="price__before">
                før {formatPrice(offer.prePrice!, offer.currency)}
              </span>
            )}
            {/* The figure is one unbreakable unit. Inside a disc the mark
                is square and narrow, and without this the øre wrapped onto
                a second line and the price read as two numbers. */}
            <span className="price__figure" style={figureFit}>
              {/*
                * "fra", when this is the lowest of several prices.
                *
                * Never decoration and never optional: a single figure
                * printed over goods that are not all that price is
                * something a shopper finds out at the till. If the feed
                * says the products differ, the page says so too.
                */}
              {offer.priceFrom && !fromAbove && <span className="price__from">fra</span>}
              <span className="price__major">{price.major}</span>
              {/* A whole-krone price ends in the kroner mark, which is a
                  lockup and not two characters — see `.price__kr`. */}
              {price.minor === '00'
                ? <span className="price__kr"><i aria-hidden="true" /><span>,</span></span>
                : <span className="price__minor">{price.minor}</span>}
            </span>
            {offer.savings !== null && offer.savings > 0 && role !== 'compact' && (
              <span className="price__savings">
                {/*
                  * Both ends when the products saved different amounts.
                  *
                  * "Spar 29,95-49,95" is what the chain's own export
                  * says and what it prints. One of the two numbers,
                  * printed over both bottles, is true of one of them.
                  */}
                Spar {formatPrice(offer.savings, offer.currency)}
                {offer.savingsMax !== null && offer.savingsMax > offer.savings
                  && `-${formatPrice(offer.savingsMax, offer.currency)}`}
              </span>
            )}
          </div>
        )}
      </div>

      {/*
        * Tags sit OUTSIDE the text block, as their own tile row.
        *
        * Inside it they were the last thing in an elastic, clipped box,
        * so on a tight tile the chip printed cut in half across its
        * middle — which reads as a rendering bug rather than as an
        * omission. A fixed row either fits whole or is not there.
        */}
      {tagRoom > 0 && promos.length > 0 && shown('tags') && (
        <ul className="tile__tags" {...box('tags')}>
          {/* Rewritten, the row is the one chip the editor wrote. A
              person retyping "Frit valg" means that chip, not a request
              to relabel every promotion the feed happened to attach. */}
          {wording('tags') !== null ? (
            <li className="tag tag--custom">{wording('tags')}</li>
          ) : promos.slice(0, tagRoom).map((label) => (
            <li key={`${label.kind}-${label.text}`} className={`tag tag--${label.kind}`}>
              {label.text}
            </li>
          ))}
        </ul>
      )}
      {/* The page's own roundels and marks over the tile, where it set them. */}
      {frame?.art?.filter((entry) => !staleBadges.some((badge) => covers(badge.rect, entry.rect))).map((entry, index) => (
        <img
          key={`art-${index}`}
          className="tile__art"
          src={entry.image}
          alt=""
          aria-hidden="true"
          style={{
            left: `${entry.rect.x * 100}%`, top: `${entry.rect.y * 100}%`,
            width: `${entry.rect.w * 100}%`, height: `${entry.rect.h * 100}%`,
          }}
        />
      ))}
      {frame?.badges?.filter((badge) => !staleBadges.includes(badge)).map((badge, index) => (
        <div
          key={`badge-${index}`}
          className="tile__badge"
          style={{
            left: `${badge.rect.x * 100}%`, top: `${badge.rect.y * 100}%`,
            width: `${badge.rect.w * 100}%`, height: `${badge.rect.h * 100}%`,
            ...(badge.image ? { backgroundImage: `url("${badge.image}")` } : {}),
            ...stackStyle(badge.stack),
          }}
        >
          {badge.lines.map((line, at) => <Line key={at} line={fitLine(line, badge.rect)} />)}
        </div>
      ))}
      </>)}
    </article>
  );
}
