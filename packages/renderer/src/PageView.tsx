import type { CSSProperties, ReactNode } from 'react';
import type { Brand, CatalogPage, Offer, PageTemplate, TilePart } from '@incitio/schema';
import { brandCssVars } from '@incitio/schema';
import { OfferTile } from './OfferTile.js';

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
            {page.title && <h2 className="page__title">{page.title}</h2>}
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
              } as CSSProperties}
              key={slot.id}
              data-slot-id={slot.id}
              data-offer-id={placement.offerId}
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
