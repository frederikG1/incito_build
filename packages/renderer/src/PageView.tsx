import type { CSSProperties, ReactNode } from 'react';
import type { Brand, CatalogPage, Offer, PageTemplate, TilePart } from '@incitio/schema';
import { artworkOrigin, brandCssVars, slotCells, slotShape } from '@incitio/schema';
import { OfferTile } from './OfferTile.js';
import { splitHeading } from './format.js';

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
  onSelectOffer?: (offerId: string) => void;
  /** Editor overlay (drop targets, handles). Kept out of the print view. */
  slotDecorator?: (slotId: string) => ReactNode;
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
  onSelectOffer,
  slotDecorator,
}: PageViewProps) {
  const style: CSSProperties = {
    ...brandCssVars(brand, pageIndex),
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

  return (
    <section
      className={`page brand--${brand.id} page--ground-${brand.groundPattern}`}
      style={style}
      data-page-id={page.id}
      data-template-id={template.id}
    >
      {(page.title || brand.logoUrl) && (
        <header className="page__masthead">
          {brand.logoUrl && <img className="page__logo" src={brand.logoUrl} alt="" />}
          <div>
            {page.title && (
              <h2
                className="page__title"
                style={{ '--title-width': String(Math.max(6, Math.round(titleWidth))) } as CSSProperties}
              >
                <span className="page__title-head">{head}</span>
                {tail && <span className="page__title-tail"> {tail}</span>}
              </h2>
            )}
            {page.subtitle && <p className="page__subtitle">{page.subtitle}</p>}
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
                // Only read when the slot is allowed to overrun; see
                // TemplateSlot.bleed. The artwork scales, the words do not.
                ...(slot.bleed > 1 ? { '--bleed': String(slot.bleed) } : {}),
                // Which way the artwork grows. Every slot needs it now,
                // not just a bleeding one: the standing `--fill` means
                // all artwork overruns, so a cell against the sheet's
                // edge would push its product off the paper.
                '--art-origin': artworkOrigin(cells.get(slot.id)),
              } as CSSProperties}
              key={slot.id}
              data-slot-id={slot.id}
              data-offer-id={placement.offerId}
              data-shape={slotShape(cells.get(slot.id))}
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
