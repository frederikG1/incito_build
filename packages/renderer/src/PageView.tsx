import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { IncitoPage, printsExactly } from './IncitoPage.js';
import { cellStates, pagedSheet } from './paged.js';
import { incitoPacks, offerViewIds } from './incito.js';
import type {
  Brand, CatalogPage, Offer, PageNote, PagePart, PageTemplate, PageTextOverride, TileFrame, TilePart,
} from '@incitio/schema';
import {
  STARTER_RULES, type Variant, artworkGrowth, brandCssVars, designGroup, onPaper, pageTextOverride, pageTextsFreed, resolveLook, variantFrame,
  slotCells, slotRoom, slotShape, chooseDesign, designCells, designTags, slotAssignmentOrder,
  type CellRect, type DesignChoice,
} from '@incitio/schema';
import { OfferTile } from './OfferTile.js';
import { DesignTile } from './DesignTile.js';
import { cssUrl, splitHeading } from './format.js';

/**
 * Pictures and words an import read off the publication carry this id —
 * its mastheads and drawn art. A page printed from its own tree draws
 * those already; only what was added in the studio goes on top.
 */
const PUBLISHED = 'pub-';

/** A cluster's products fill the packshot's box — see `incitoPacks`. */
const PACK_FRAME: TileFrame = { media: { x: 0, y: 0, w: 1, h: 1 }, wordsAlign: 'start' };

/**
 * How high a moved heading rides.
 *
 * Only ever set on a line somebody has moved, and then it is
 * load-bearing: the masthead comes BEFORE the grid in the document, so
 * a heading dragged down over the offers would otherwise paint behind
 * the very tiles it was dragged onto. Above the tiles' own layers
 * (which stop at 30) and above a lifted box (35), below an armed
 * decoration (60) — a picture taken in hand is the one thing that
 * should still come to the front.
 *
 * Inline rather than in the stylesheet for the same reason `LIFTED` is
 * in `OfferTile`: it belongs to the element that carries a correction,
 * not to every heading ever printed.
 */
const MOVED = 45;

/**
 * Where a line has been put, as a style — and nothing at all when it is
 * where the masthead put it.
 *
 * An untouched line gets no `transform`, deliberately: a transform
 * creates a containing block, and one here would re-root anything
 * absolutely positioned inside the heading.
 *
 * Offsets are spent in `cqw`/`cqh` against the page's size container,
 * so a heading stays where it was put whether the page is a 240px
 * thumbnail or A4 at 300dpi. Grown from `left top`, because a line of
 * type is anchored where it starts reading — scaling it from the middle
 * walks the first letter away from whatever it was aligned to.
 */
function textStyle(part: PageTextOverride): CSSProperties | undefined {
  if (part.offsetX === 0 && part.offsetY === 0 && part.scale === 1) return undefined;
  return {
    transform: `translate(${part.offsetX}cqw, ${part.offsetY}cqh) scale(${part.scale})`,
    transformOrigin: 'left top',
    zIndex: MOVED,
  };
}

export interface PageViewProps {
  page: CatalogPage;
  /** Editor only, for a page printed as published — see `IncitoPage`. */
  selectedIncitoBlock?: string | null;
  onSelectIncitoBlock?: (path: string | null) => void;
  onMoveIncitoBlock?: (path: string, at: { dx: number; dy: number }, gesture: string) => void;
  onScaleIncitoBlock?: (path: string, by: number) => void;
  onIncitoMoveEnd?: () => void;
  onDropOnIncitoOffer?: (offerViewId: string, event: DragEvent) => void;
  incitoDropType?: string;
  template: PageTemplate;
  brand: Brand;
  offers: Map<string, Offer>;
  /**
   * Where this page sits in the book. Picks its ground from the chain's
   * rotating palette — see `pageGround`. Defaults to the first tint.
   */
  pageIndex?: number;
  pageNumber?: number;
  selectedOfferId?: string | null;
  /** Which box of the selected tile is in hand. Editor only. */
  selectedPart?: TilePart | null;
  /** Which product of a cluster is in hand — see `OfferTileProps`. */
  selectedPack?: number | null;
  onSelectOffer?: (offerId: string) => void;
  /** Editor overlay (drop targets, handles). Kept out of the print view. */
  slotDecorator?: (slotId: string) => ReactNode;
  /**
   * Let a picture on the page be dragged. Editor only.
   *
   * Absent in print and in every non-interactive render, and that is
   * what keeps a decoration what it is meant to be there: paint on the
   * wall behind the grid, unable to take a click or push a layout.
   * Present, it becomes draggable and nothing else changes.
   *
   * Called with page-percent offsets, which is the currency
   * `PageDecoration.offsetX` is stored in — see the note there.
   */
  onMoveDecor?: (decorId: string, offset: { x: number; y: number }, gesture: string) => void;
  /**
   * Which picture is armed, and therefore reachable by a pointer.
   *
   * Only this one lifts above the grid and takes a click. The rest stay
   * where the stylesheet puts them: behind everything, `pointer-events:
   * none`, which is the whole reason a decoration cannot be grabbed by
   * accident — and, before this, could not be grabbed at all.
   */
  selectedDecorId?: string | null;
  /** Called when a drag ends, so history can coalesce it into one step. */
  onDecorMoveEnd?: () => void;
  /**
   * Composed pictures drawn over the tiles they were read from, so the
   * editor can SEE whether each cluster matches its own. Editor only,
   * and a list: a whole sheet is stood up in one go.
   */
  ghosts?: {
    offerId: string;
    url: string;
    left: number;
    top: number;
    width: number;
    height: number;
  }[];
  /**
   * Editor overlay on the page's own lines. Kept out of the print view,
   * exactly like `slotDecorator` — same contract, one level up.
   *
   * The heading and the theme line are boxes a person moves, and the
   * only reason they were not was that nothing drew a handle on them.
   */
  textDecorator?: (part: PagePart) => ReactNode;
  /**
   * Free text on the page, in the editor: which note is in hand, and
   * how to take one in hand and move it. Print passes none of these, so
   * a note there is plain type that no pointer can reach.
   */
  selectedNoteId?: string | null;
  onSelectNote?: (noteId: string) => void;
  onMoveNote?: (noteId: string, at: { x: number; y: number }, gesture: string) => void;
  onNoteMoveEnd?: () => void;
}

/**
 * One catalogue page.
 *
 * The template's `areas` go straight into `grid-template-areas` and each
 * slot claims its cell by name. There is no pixel maths here and no
 * second layout model: the browser resolves the grid, which is also what
 * makes the printed PDF identical to the screen — Chromium runs the same
 * code twice.
 *
 * The page establishes a size container, so every measurement in the
 * stylesheet can be written in `cqw`/`cqh` and the whole page scales as
 * one unit from a thumbnail to A4 at 300dpi.
 */
/**
 * A text's size, made to fit the box it was measured in.
 *
 * A text read off a printed page carries its box and one size — the
 * size of its first line, which is often a headline over a paragraph.
 * Set whole at that size, the Änglamark paragraph ran a page-third past
 * its panel and over the products beside it. So a text with a box is
 * set no larger than fits the box: lines estimated from its length at
 * an average glyph width, shrunk until they stand in the box's height.
 * An estimate rather than a measurement, so the page prints the same
 * in the studio and in the PDF, where nothing is measured.
 */
export function fittedNoteSize(note: Pick<PageNote, 'text' | 'size' | 'w' | 'h' | 'bold'>, pageAspect: number): number {
  if (note.h === null || !note.text.trim()) return note.size;
  // The box's height in page WIDTHS, the unit sizes are in.
  const height = note.h / pageAspect;
  const glyph = note.bold ? 0.6 : 0.55;
  const fits = (size: number) => {
    const perLine = Math.max(1, Math.floor(note.w / (glyph * size)));
    const lines = note.text.split('\n').reduce((n, line) => n + Math.max(1, Math.ceil(line.trim().length / perLine)), 0);
    return lines * 1.15 * size <= height;
  };
  let size = note.size;
  // Never below a third of what was measured: past that the box, not the type, is wrong.
  while (!fits(size) && size > note.size / 3) size *= 0.94;
  return size;
}

export function PageView({
  page,
  template,
  brand,
  offers,
  pageIndex = 0,
  selectedOfferId,
  selectedPart,
  selectedPack,
  onSelectOffer,
  slotDecorator,
  onMoveDecor,
  onDecorMoveEnd,
  selectedDecorId,
  textDecorator,
  selectedNoteId,
  onSelectNote,
  onMoveNote,
  onNoteMoveEnd,
  ghosts,
  selectedIncitoBlock,
  onSelectIncitoBlock,
  onMoveIncitoBlock,
  onScaleIncitoBlock,
  onIncitoMoveEnd,
  onDropOnIncitoOffer,
  incitoDropType,
}: PageViewProps) {
  const slots = new Map(template.slots.map((s) => [s.id, s]));
  /*
   * One cell and its tile. A factory over the sheet's aspect, because a
   * page made from a picture is the picture's shape, not the chain's
   * print format — see `slotCells`.
   */
  /*
   * The page's design, and the rules it is drawn by — the chain's own,
   * else incito's logic stated. Every page has one: a page without a
   * group of its own is drawn in the chain's colours, so what an offer
   * IS (lowered, a member price, new) always shows in how it looks.
   */
  const group = designGroup(page.design?.group ?? 'standard');
  const rules = brand.offerRules.length > 0 ? brand.offerRules : STARTER_RULES;
  /*
   * The rotation: offers drawn in the same variant take turns, in the
   * page's reading order, so two ordinary offers side by side are each
   * other's mirror — incito's "same tag, used evenly".
   */
  const turns = new Map<string, { variant: Variant | null; turn: number }>();
  if (group) {
    const seen = new Map<string, number>();
    for (const placement of page.placements) {
      const slot = slots.get(placement.slotId);
      const offer = offers.get(placement.offerId);
      if (!slot || !offer) continue;
      const look = resolveLook(offer, rules, { hero: slot.role === 'hero' || slot.role === 'feature' });
      const key = look.variant ?? 'normal';
      const turn = seen.get(key) ?? 0;
      seen.set(key, turn + 1);
      turns.set(placement.slotId, { variant: look.variant, turn });
    }
  }
  /*
   * The chain's own offer designs, when it has them: the design decides
   * where the picture, the words and the price stand, the rules and the
   * page decide which design. Designs with the same tag take turns in
   * the page's reading order — incito's "used evenly".
   */
  const designed = new Map<string, DesignChoice>();
  if (brand.offerDesigns.length > 0) {
    const pageTag = page.design?.tag ?? brand.designTag ?? designTags(brand.offerDesigns)[0]!;
    const turnsByTag = new Map<string, number>();
    const order = new Map(slotAssignmentOrder(template).map((slot, index) => [slot.id, index]));
    const reading = [...page.placements].sort((a, b) => (order.get(a.slotId) ?? 0) - (order.get(b.slotId) ?? 0));
    for (const placement of reading) {
      const slot = slots.get(placement.slotId);
      const offer = offers.get(placement.offerId);
      if (!slot || !offer) continue;
      const a = slot.role === 'hero' || slot.role === 'feature';
      const look = resolveLook(offer, rules, { hero: a });
      const tag = look.design ?? pageTag;
      const turn = turnsByTag.get(tag) ?? 0;
      turnsByTag.set(tag, turn + 1);
      const choice = chooseDesign(brand.offerDesigns, tag, offer, { a, turn })
        ?? chooseDesign(brand.offerDesigns, pageTag, offer, { a, turn });
      if (choice) {
        designed.set(placement.slotId, look.because.design
          ? { ...choice, because: `regel «${look.because.design}» · ${choice.because}` }
          : choice);
      }
    }
  }
  const slotRenderer = (aspect: number) => {
    const cells = slotCells(template, aspect);
    /*
     * Boxes measured off a printed page overlap and run off the paper; an
     * offer design fills its cell to the edge, so its cells are tidied
     * first — on the paper, clear of the page's artwork, a gutter apart.
     * See `designCells`.
     */
    const measured: Record<string, CellRect> = {};
    for (const placement of page.placements) {
      const slot = slots.get(placement.slotId);
      if (slot?.rect && designed.has(slot.id)) measured[slot.id] = slot.rect;
    }
    const tidy = Object.keys(measured).length > 0
      ? designCells(
        measured,
        page.decorations.filter((d) => d.rect && !d.offerId).map((d) => d.rect!),
        aspect,
      )
      : {};
    return (placement: CatalogPage['placements'][number]) => {
          const found = slots.get(placement.slotId);
          const slot = found && tidy[found.id] ? { ...found, rect: tidy[found.id]! } : found;
          const offer = offers.get(placement.offerId);
          // A placement naming a slot this template does not have is a
          // stale edit, not a crash: skip it and let the page render.
          if (!slot) return null;
          /*
           * A page with a design: the offer is drawn in the variant the
           * chain's rules choose — Hovedvare in the lead zone, Medlemspris
           * for a member price… — in the page's design group, in the
           * arrangement for this cell's shape. See `PageDesign`.
           */
          const drawn = group && offer ? (() => {
            const look = resolveLook(offer, rules, { hero: slot.role === 'hero' || slot.role === 'feature' });
            const shape = slot.rect ? (slot.rect.w / slot.rect.h) * aspect : cells.get(slot.id)?.aspect ?? 1;
            const result = variantFrame(
              look.variant ?? 'normal', group, offer, shape, { member: look.memberBadgeText }, turns.get(slot.id)?.turn ?? 0,
            );
            return { ...result, frame: slot.rect ? onPaper(result.frame, slot.rect) : result.frame };
          })() : null;
          const frame = drawn?.frame ?? slot.frame;
          const tileOffer = drawn?.offer ?? offer;

          return (
            <div
              className={`slot slot--${slot.role}${slot.bleed > 1 ? ' slot--bleed' : ''}`}
              style={{
                /*
                 * A cell measured off a published page sits in its own
                 * box, not in the grid's — see `TemplateSlot.rect`. No
                 * grid-area then: an absolute child of a grid with an
                 * area is positioned against that AREA, not the page.
                 */
                ...(slot.rect ? {} : { gridArea: slot.id }),
                ...(slot.rect ? {
                  position: 'absolute',
                  left: `${slot.rect.x * 100}%`,
                  top: `${slot.rect.y * 100}%`,
                  width: `${slot.rect.w * 100}%`,
                  height: `${slot.rect.h * 100}%`,
                } : {}),
                /*
                 * Only read when the slot is allowed to overrun; see
                 * `TemplateSlot.bleed`. Stated as the SHARE it overruns
                 * by rather than as the factor the template declares —
                 * a slot at 1.15 grows by 0.15 — so it is the same kind
                 * of number as `--fill` and the stylesheet can simply
                 * take whichever is larger. The artwork grows, the
                 * words do not.
                 */
                ...(slot.bleed > 1 ? { '--bleed': String(slot.bleed - 1) } : {}),
                /*
                 * Which way the artwork grows. Every slot needs it, not
                 * just a bleeding one: the standing `--fill` means all
                 * artwork overruns, so a cell against the sheet's edge
                 * would push its product off the paper.
                 */
                '--art-l': String(artworkGrowth(cells.get(slot.id)).left),
                '--art-r': String(artworkGrowth(cells.get(slot.id)).right),
                /*
                 * How wide this cell is, as a share of the sheet.
                 *
                 * The stylesheet measures everything against the PAGE
                 * — that is what makes a thumbnail and A4 one design —
                 * and the price mark is the one element that also has
                 * to answer to the cell it stands in: set by height
                 * alone it is the same number in a half-page hero and
                 * in a column a sixth of the page wide, where it
                 * leaves the product name two characters to a line.
                 * See `--price-size` and `SlotCell.width`.
                 */
                '--cell-w': String(cells.get(slot.id)?.width ?? 1),
              } as CSSProperties}
              key={slot.id}
              data-slot-id={slot.id}
              data-offer-id={placement.offerId}
              data-shape={slotShape(cells.get(slot.id))}
              /* Whether the price mark stands beside the words or above
                 them — see `slotRoom` and `.tile__info`. */
              data-room={slotRoom(cells.get(slot.id))}
            >
              {offer && designed.has(slot.id) ? (
                <DesignTile
                  design={designed.get(slot.id)!.design}
                  because={designed.get(slot.id)!.because}
                  offer={offer}
                  aspect={slot.rect ? (slot.rect.w / slot.rect.h) * aspect : cells.get(slot.id)?.aspect ?? 1}
                  overrides={placement.overrides}
                  {...(slot.rect ? { cell: { w: slot.rect.w, h: slot.rect.h } } : {})}
                  selected={selectedOfferId === offer.id}
                  {...(onSelectOffer ? { onSelect: (id: string) => onSelectOffer(id) } : {})}
                />
              ) : offer && tileOffer ? (
                <OfferTile
                  offer={tileOffer}
                  role={slot.role}
                  {...(frame ? { frame } : {})}
                  {...(slot.rect ? { cellWidth: slot.rect.w, cellHeight: slot.rect.h / aspect }
                    // A layout sizes its words and price to its own boxes, so it has to know the cell.
                    : drawn && cells.get(slot.id) ? { cellWidth: cells.get(slot.id)!.width, cellHeight: cells.get(slot.id)!.width / cells.get(slot.id)!.aspect }
                      : {})}
                  // The lead of a page may be marked differently from
                  // the rest — SuperBrugsen gives it the red disc and
                  // leaves every other price as a plain numeral.
                  priceShape={drawn ? drawn.priceShape
                    : (slot.role === 'hero' || slot.role === 'feature')
                      ? brand.leadPriceShape ?? brand.priceShape
                      : brand.priceShape
                  }
                  overrides={placement.overrides}
                  selected={selectedOfferId === offer.id}
                  selectedPart={selectedOfferId === offer.id ? selectedPart : null}
                  selectedPack={selectedOfferId === offer.id ? selectedPack ?? null : null}
                  reference={ghosts?.find((ghost) => ghost.offerId === offer.id) ?? null}
                  {...(onSelectOffer ? { onSelect: onSelectOffer } : {})}
                />
              ) : (
                <div className="slot__empty">Tom plads</div>
              )}
              {slotDecorator?.(slot.id)}
            </div>
          );
    };
  };
  const renderSlot = slotRenderer(brand.pageAspect);


  const style: CSSProperties = {
    ...brandCssVars(brand, pageIndex),
    /*
     * A page rebuilt from a reference brings its own field.
     *
     * Last, so it beats the chain's rotation — and only when it is set,
     * which is only ever for a page whose ground was measured off a
     * printed page. See `CatalogPage.ground`.
     */
    ...(page.ground ? { '--ground': page.ground } : {}),
    aspectRatio: String(brand.pageAspect),
  } as CSSProperties;

  const gridStyle: CSSProperties = {
    gridTemplateAreas: template.areas.map((row) => `"${row}"`).join(' '),
    gridTemplateColumns: `repeat(${template.areas[0]!.split(' ').length}, 1fr)`,
    gridTemplateRows: `repeat(${template.areas.length}, 1fr)`,
  };

  /*
   * How wide each cell is against its own height, read off the grid —
   * see `slotCells` for why this is not a container query.
   *
   * A role says what an offer is FOR; it cannot say what shape the cell
   * holding it turned out to be. The chain calls both a full-width
   * editorial band and a column running the height of the page a
   * "feature", and the stylesheet has to draw them differently.
   */

  /*
   * The heading is one line in two faces — see `splitHeading`. The two
   * halves are separate elements rather than one styled string because
   * they carry different faces, weights and colours, and because the
   * script half needs its own optical size: a marker script set at the
   * grotesk's size reads a stage smaller than it, which is the one way
   * a two-face line goes wrong.
   */
  const { head, tail } = splitHeading(page.title);

  /*
   * The heading's own length, for the stylesheet to size against.
   *
   * A section heading comes from the feed and its length is not a thing
   * this renderer gets to choose: "Bolig" is five characters and
   * "Nydelsesmidler og kioskvarer" is twenty-eight. A single `cqw` cap
   * has to be set for the longest one, which leaves the short headings
   * timid, or for the short ones, which wraps the long ones onto a
   * second line and costs the page a row of offers. Handing the count
   * to CSS lets one rule fit both, and it keeps the measurement where
   * the type is rather than in a layout pass.
   *
   * The script half is counted heavier: a marker face is set 1.12em
   * here and runs wider per character than the grotesk beside it.
   */
  const titleWidth = head.length + tail.length * 1.2;

  const title = pageTextOverride(page, 'title');
  const subtitle = pageTextOverride(page, 'subtitle');

  const renderNote = (note: PageNote) => {
        const size = fittedNoteSize(note, brand.pageAspect);
        const held = selectedNoteId === note.id;
        const boxed = note.h !== null && (note.background !== null || note.image !== null);
        return (
          <div
            key={note.id}
            className={`page__note${note.id.startsWith('pub-note-') ? ' page__note--pub' : ''}${note.behind ? ' page__note--behind' : ''}${held ? ' page__note--active' : ''}${onSelectNote ? ' page__note--editable' : ''}`}
            data-note-id={note.id}
            style={{
              left: `${note.x * 100}%`,
              top: `${note.y * 100}%`,
              width: `${note.w * 100}%`,
              ...(boxed ? { height: `${note.h! * 100}%` } : {}),
              fontSize: `calc(${size} * 100cqw)`,
              color: note.color,
              fontWeight: note.bold ? 700 : 400,
              textAlign: note.align,
              justifyContent: note.align === 'left' ? 'flex-start' : note.align === 'right' ? 'flex-end' : 'center',
              ...(note.rotate ? { rotate: `${note.rotate}deg` } : {}),
              ...(note.background ? { backgroundColor: note.background } : {}),
              // A backing a person chose gets breathing room; a band read
              // off a publication already has its measured height.
              ...(note.background && !boxed ? { padding: '0.25em 0.45em' } : {}),
              ...(note.image ? { backgroundImage: `url("${note.image}")` } : {}),
            }}
            onClick={onSelectNote ? (event) => { event.stopPropagation(); onSelectNote(note.id); } : undefined}
            onPointerDown={held && onMoveNote ? (event: ReactPointerEvent<HTMLDivElement>) => {
              const element = event.currentTarget;
              const sheet = element.closest('.page')?.getBoundingClientRect();
              if (!sheet || sheet.width === 0) return;
              event.preventDefault();
              event.stopPropagation();
              const from = { x: event.clientX, y: event.clientY };
              const start = { x: note.x, y: note.y };
              const clamp = (v: number) => Math.min(1.5, Math.max(-0.5, v));
              try { element.setPointerCapture(event.pointerId); } catch { /* uncapturable */ }
              const onMove = (move: PointerEvent) => {
                onMoveNote(note.id, {
                  x: clamp(start.x + (move.clientX - from.x) / sheet.width),
                  y: clamp(start.y + (move.clientY - from.y) / sheet.height),
                }, `note:${note.id}`);
              };
              const onUp = () => {
                try { element.releasePointerCapture(event.pointerId); } catch { /* never held */ }
                element.removeEventListener('pointermove', onMove);
                element.removeEventListener('pointerup', onUp);
                element.removeEventListener('pointercancel', onUp);
                onNoteMoveEnd?.();
              };
              element.addEventListener('pointermove', onMove);
              element.addEventListener('pointerup', onUp);
              element.addEventListener('pointercancel', onUp);
            } : undefined}
          >
            {note.text}
          </div>
        );
  };

  /** A picture laid on the page — the chain's own or a drawn motif. */
  const renderDecor = (decor: CatalogPage['decorations'][number]) => (
    <img
      key={decor.id}
      className={`page__decor page__decor--${decor.anchor}${
        decor.front ? ' page__decor--front' : ''}${
        onMoveDecor && selectedDecorId === decor.id ? ' page__decor--active' : ''}`}
      src={decor.imageUrl}
      alt=""
      aria-hidden="true"
      data-decor-subject={decor.subject}
      draggable={false}
      {...(onMoveDecor && selectedDecorId === decor.id ? {
        onPointerDown: (event: ReactPointerEvent<HTMLImageElement>) => {
          /*
           * Dragged in PAGE percent, measured off the page itself.
           *
           * One percent of the page is one `cqw`, so the number
           * stored and the number the pointer covered are the same
           * thing — and a canvas zoomed out to a thumbnail still
           * moves the picture by what the hand did, not by what the
           * numbers would be at A4.
           */
          const element = event.currentTarget;
          const page = element.closest('.page')?.getBoundingClientRect();
          if (!page || page.width === 0 || page.height === 0) return;
          event.preventDefault();
          event.stopPropagation();

          const perX = 100 / page.width;
          const perY = 100 / page.height;
          const from = { x: event.clientX, y: event.clientY };
          const start = { x: decor.offsetX, y: decor.offsetY };
          // Kept in step with `PageDecoration.offsetX`, which rejects
          // anything wider on save — a drag the schema will not
          // accept is a drag that vanishes at the next reload.
          const clamp = (v: number) => Math.min(75, Math.max(-75, v));
          const gesture = `decor:${decor.id}`;

          try { element.setPointerCapture(event.pointerId); } catch { /* uncapturable */ }

          const onMove = (move: PointerEvent) => {
            onMoveDecor(decor.id, {
              x: clamp(start.x + (move.clientX - from.x) * perX),
              y: clamp(start.y + (move.clientY - from.y) * perY),
            }, gesture);
          };
          const onUp = () => {
            try { element.releasePointerCapture(event.pointerId); } catch { /* never held */ }
            element.removeEventListener('pointermove', onMove);
            element.removeEventListener('pointerup', onUp);
            element.removeEventListener('pointercancel', onUp);
            onDecorMoveEnd?.();
          };
          element.addEventListener('pointermove', onMove);
          element.addEventListener('pointerup', onUp);
          element.addEventListener('pointercancel', onUp);
        },
      } : {})}
      style={{
        '--decor-scale': String(decor.scale),
        '--decor-rotate': `${decor.rotate}deg`,
        '--decor-opacity': String(decor.opacity),
        '--decor-flip': decor.flip ? '-1' : '1',
        '--decor-x': `${decor.offsetX}cqw`,
        '--decor-y': `${decor.offsetY}cqh`,
        /*
         * A measured piece states its own box and ignores the
         * anchor entirely — see `PageDecoration.rect`. `inset` and
         * a stated size beat the corner rules in the stylesheet,
         * and the offsets stay in the transform, so dragging one
         * works exactly as it does for a pinned picture.
         */
        ...(decor.rect ? {
          left: `${decor.rect.x * 100}%`,
          top: `${decor.rect.y * 100}%`,
          right: 'auto',
          bottom: 'auto',
          width: `${decor.rect.w * 100}%`,
          height: `${decor.rect.h * 100}%`,
          maxWidth: 'none',
          objectFit: 'contain' as const,
        } : {}),
      } as CSSProperties}
    />
  );

  // Printed as published — the publication's own tree, not the chain's tiles.
  if (printsExactly(page)) {
    /*
     * A page made from a picture prints the picture, and the chain's own
     * tile in every cell somebody has put a new product in — the same
     * tile, with the same tools, as on any page of the chain's. See
     * `boundIncito`.
     */
    const sheet = pagedSheet(page.incito);
    const states = sheet ? cellStates(page, template, offers) : null;
    const tiles = states ? page.placements.filter((placement) => states.get(placement.slotId) === 'new') : [];
    const aspect = page.incito.width / page.incito.height;
    /*
     * A cell whose product the chain's rules give a layout is drawn with
     * the chain's tile, in that layout, where the cell stands — the rest
     * of the sheet stays exactly as published. See `OfferRule`.
     */
    const views = offerViewIds(page.incito.view as Parameters<typeof offerViewIds>[0]);
    const viewOf = (placement: CatalogPage['placements'][number]) =>
      page.incito!.slots?.[placement.slotId] ?? (views.has(placement.offerId) ? placement.offerId : undefined);
    /*
     * A page given a design draws every product in it that way, over the
     * published sheet — given one by hand: the chain's standard is not
     * enough, an imported page prints exactly as published until asked.
     */
    const ruled = sheet || !page.design?.group ? [] : page.placements.filter((placement) =>
      Boolean(offers.get(placement.offerId) && slots.get(placement.slotId)?.rect && viewOf(placement)));
    const drawnElsewhere = new Set(ruled.map(viewOf).filter((id): id is string => Boolean(id)));
    const packs = (sheet ? [] : incitoPacks(page, offers, template))
      .filter((pack) => !ruled.some((placement) => placement.slotId === pack.slotId));
    return (
      <IncitoPage
        page={page}
        template={template}
        offers={offers}
        drawnElsewhere={drawnElsewhere}
        selectedBlock={selectedIncitoBlock ?? null}
        {...(onSelectIncitoBlock ? { onSelectBlock: onSelectIncitoBlock } : {})}
        {...(onMoveIncitoBlock ? { onMoveBlock: onMoveIncitoBlock } : {})}
        {...(onScaleIncitoBlock ? { onScaleBlock: onScaleIncitoBlock } : {})}
        {...(onIncitoMoveEnd ? { onMoveEnd: onIncitoMoveEnd } : {})}
        {...(onDropOnIncitoOffer ? { onDropOnOffer: onDropOnIncitoOffer, dropType: incitoDropType } : {})}
      >
        {/* The page's own pictures and texts, over the published sheet —
            a drawn motif, a picture of your own, a line added with "+ Tekst". */}
        {page.decorations.filter((decor) => !decor.id.startsWith(PUBLISHED)).map(renderDecor)}
        {(page.notes ?? []).filter((note) => !note.id.startsWith(PUBLISHED)).map(renderNote)}
        {(sheet || ruled.length > 0) && (
          <div
            className={`page page--overlay brand--${brand.id} page--ground-${brand.groundPattern}`}
            style={brandCssVars(brand, pageIndex) as CSSProperties}
          >
            <div className="page__grid page__grid--measured">
              {[...tiles, ...ruled].map(slotRenderer(aspect))}
            </div>
          </div>
        )}
        {/* A cluster in one of the publication's cells: its products,
            drawn by the chain's tile in the printed packshot's box. */}
        {packs.length > 0 && (
          <div
            className={`page page--overlay brand--${brand.id} page--ground-${brand.groundPattern}`}
            style={brandCssVars(brand, pageIndex) as CSSProperties}
          >
            <div className="page__grid page__grid--measured">
              {packs.map((pack) => {
                const offer = offers.get(pack.offerId)!;
                const placement = page.placements.find((entry) => entry.slotId === pack.slotId)!;
                const role = slots.get(pack.slotId)?.role ?? 'standard';
                return (
                  <div
                    key={pack.slotId}
                    className={`slot slot--${role} slot--pack`}
                    style={{
                      position: 'absolute',
                      left: `${pack.rect.x * 100}%`,
                      top: `${pack.rect.y * 100}%`,
                      width: `${pack.rect.w * 100}%`,
                      height: `${pack.rect.h * 100}%`,
                    }}
                    data-slot-id={pack.slotId}
                    data-offer-id={pack.offerId}
                  >
                    <OfferTile
                      offer={offer}
                      role={role}
                      frame={PACK_FRAME}
                      artworkOnly
                      priceShape={brand.priceShape}
                      overrides={placement.overrides}
                      selected={selectedOfferId === offer.id}
                      selectedPart={selectedOfferId === offer.id ? selectedPart : null}
                      selectedPack={selectedOfferId === offer.id ? selectedPack ?? null : null}
                      reference={ghosts?.find((ghost) => ghost.offerId === offer.id) ?? null}
                      {...(onSelectOffer ? { onSelect: onSelectOffer } : {})}
                    />
                    {slotDecorator?.(pack.slotId)}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </IncitoPage>
    );
  }

  return (
    <section
      className={`page brand--${brand.id} page--ground-${brand.groundPattern}`}
      style={style}
      data-page-id={page.id}
      data-template-id={template.id}
    >
      {/*
        * The chain's own picture under the whole sheet.
        *
        * First in source order, so it sits under the artwork as well as
        * under the grid: a background is what the page is printed ON,
        * and a decoration is something laid on top of it. A layer of
        * its own rather than a `background-image` on `.page`, because
        * the page's own `background` is the chain's ground colour and
        * the two have to be able to coexist — a `contain` fit shows the
        * ground around the picture, and a held-back opacity mixes into
        * it.
        */}
      {page.background && (
        <div
          className="page__bg"
          data-fit={page.background.fit}
          aria-hidden="true"
          style={{
            '--bg-image': cssUrl(page.background.imageUrl),
            '--bg-opacity': String(page.background.opacity),
            '--bg-focus': `${page.background.focusX}% ${page.background.focusY}%`,
          } as CSSProperties}
        />
      )}

      {/* Flat panels the page is split with, under everything drawn. */}
      {(page.notes ?? []).filter((note) => note.behind).map(renderNote)}

      {/*
        * Generated mood artwork, behind everything.
        *
        * Before the masthead in source order and pinned by the
        * stylesheet, so it can never take a click or push a layout: the
        * grid is the page, and this is paint on the wall behind it.
        */}
      {page.decorations.map(renderDecor)}

      {(page.title || brand.logoUrl) && (
        /*
         * Freed of its own clip once a line has been moved.
         *
         * The strip clips deliberately — see `.page__masthead` — so a
         * heading longer than the page cannot push the offers off the
         * sheet. But a heading somebody DRAGGED onto the grid is not
         * that, and clipping it would make a deliberate placement look
         * like a broken one. The height guard is untouched either way:
         * a transform moves no layout.
         */
        <header className={`page__masthead${pageTextsFreed(page) ? ' page__masthead--free' : ''}`}>
          {brand.logoUrl && <img className="page__logo" src={brand.logoUrl} alt="" />}
          <div className="page__lines">
            {page.title && !title.hidden && (
              /*
               * The line, in a box of its own.
               *
               * The wrapper is what carries the correction and what the
               * editor draws its handle on; the `h2` keeps every rule
               * the stylesheet already had for it. Two elements rather
               * than one because a transform on the heading itself
               * would have to fight `--title-width`'s sizing, and
               * because the overlay needs something to be `inset: 0`
               * against that hugs the words.
               */
              <div className="page__text" data-page-part="title" style={textStyle(title)}>
                <h2
                  className="page__title"
                  style={{ '--title-width': String(Math.max(6, Math.round(titleWidth))) } as CSSProperties}
                >
                  <span className="page__title-head">{head}</span>
                  {tail && <span className="page__title-tail"> {tail}</span>}
                </h2>
                {textDecorator?.('title')}
              </div>
            )}
            {page.subtitle && !subtitle.hidden && (
              <div className="page__text" data-page-part="subtitle" style={textStyle(subtitle)}>
                <p className="page__subtitle">{page.subtitle}</p>
                {textDecorator?.('subtitle')}
              </div>
            )}
          </div>
        </header>
      )}

      <div
        className={`page__grid${template.slots.some((slot) => slot.rect) ? ' page__grid--measured' : ''}`}
        style={gridStyle}
      >
        {page.placements.map(renderSlot)}
      </div>

      {/*
        * Free text, over everything the page draws — see `PageNote`.
        * In the editor a note is clicked to take it in hand and dragged
        * once it is; the words themselves are typed in the panel.
        */}
      {(page.notes ?? []).filter((note) => !note.behind).map(renderNote)}

      {/* No page number on the sheet: the chain's pages do not print one. */}
    </section>
  );
}
