import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import type {
  Brand, CatalogPage, Offer, PagePart, PageTemplate, PageTextOverride, TilePart,
} from '@incitio/schema';
import {
  artworkGrowth, brandCssVars, pageTextOverride, pageTextsFreed,
  slotCells, slotRoom, slotShape,
} from '@incitio/schema';
import { OfferTile } from './OfferTile.js';
import { splitHeading } from './format.js';

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
export function PageView({
  page,
  template,
  brand,
  offers,
  pageIndex = 0,
  pageNumber,
  selectedOfferId,
  selectedPart,
  selectedPack,
  onSelectOffer,
  slotDecorator,
  onMoveDecor,
  onDecorMoveEnd,
  selectedDecorId,
  textDecorator,
  ghosts,
}: PageViewProps) {
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

  const slots = new Map(template.slots.map((s) => [s.id, s]));
  /*
   * How wide each cell is against its own height, read off the grid —
   * see `slotCells` for why this is not a container query.
   *
   * A role says what an offer is FOR; it cannot say what shape the cell
   * holding it turned out to be. The chain calls both a full-width
   * editorial band and a column running the height of the page a
   * "feature", and the stylesheet has to draw them differently.
   */
  const cells = slotCells(template, brand.pageAspect);

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
            '--bg-image': `url("${encodeURI(page.background.imageUrl)}")`,
            '--bg-opacity': String(page.background.opacity),
            '--bg-focus': `${page.background.focusX}% ${page.background.focusY}%`,
          } as CSSProperties}
        />
      )}

      {/*
        * Generated mood artwork, behind everything.
        *
        * Before the masthead in source order and pinned by the
        * stylesheet, so it can never take a click or push a layout: the
        * grid is the page, and this is paint on the wall behind it.
        */}
      {page.decorations.map((decor) => (
        <img
          key={decor.id}
          className={`page__decor page__decor--${decor.anchor}${
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
      ))}

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

      <div className="page__grid" style={gridStyle}>
        {page.placements.map((placement) => {
          const slot = slots.get(placement.slotId);
          const offer = offers.get(placement.offerId);
          // A placement naming a slot this template does not have is a
          // stale edit, not a crash: skip it and let the page render.
          if (!slot) return null;

          return (
            <div
              className={`slot slot--${slot.role}${slot.bleed > 1 ? ' slot--bleed' : ''}`}
              style={{
                gridArea: slot.id,
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
              {offer ? (
                <OfferTile
                  offer={offer}
                  role={slot.role}
                  // The lead of a page may be marked differently from
                  // the rest — SuperBrugsen gives it the red disc and
                  // leaves every other price as a plain numeral.
                  priceShape={
                    (slot.role === 'hero' || slot.role === 'feature')
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
        })}
      </div>

      {pageNumber !== undefined && <footer className="page__foot">{pageNumber}</footer>}
    </section>
  );
}
