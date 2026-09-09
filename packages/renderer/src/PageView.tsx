import type { CSSProperties, ReactNode } from 'react';
import type { CatalogPage, Offer, PageTemplate, Theme } from '@incitio/schema';
import { slotArea, slotAspect, slotRect } from '@incitio/layout';
import { OfferTile } from './OfferTile.js';

export interface PageViewProps {
  page: CatalogPage;
  template: PageTemplate;
  offers: Map<string, Offer>;
  theme: Theme;
  pageAspect: number;
  pageNumber?: number;
  selectedOfferId?: string | null;
  onSelectOffer?: (offerId: string) => void;
  /** Editor overlay (drop targets, handles). Kept out of the print view. */
  slotDecorator?: (slotId: string) => ReactNode;
}

/**
 * One catalog page. Slots are positioned absolutely from the template's
 * grid maths — the same `slotRect` the solver reasons about — so what the
 * scorer optimised is exactly what gets drawn. Using CSS grid here instead
 * would put a second, subtly different layout model in the system.
 */
export function PageView({
  page,
  template,
  offers,
  theme,
  pageAspect,
  pageNumber,
  selectedOfferId,
  onSelectOffer,
  slotDecorator,
}: PageViewProps) {
  const slots = new Map(template.slots.map((s) => [s.id, s]));

  const style: CSSProperties = {
    aspectRatio: String(pageAspect),
    background: theme.pageBackground,
    color: theme.textColor,
    fontFamily: theme.bodyFont,
    '--brand': theme.brandColor,
    '--accent': theme.accentColor,
    '--heading-font': theme.headingFont,
  } as CSSProperties;

  return (
    <section className="page" style={style} data-page-id={page.id}>
      {(page.title || theme.logoUrl) && (
        <header className="page__header">
          {theme.logoUrl && <img className="page__logo" src={theme.logoUrl} alt="" />}
          <div>
            {page.title && <h2 className="page__title">{page.title}</h2>}
            {page.subtitle && <p className="page__subtitle">{page.subtitle}</p>}
          </div>
        </header>
      )}

      <div className="page__canvas">
        {page.placements.map((placement) => {
          const slot = slots.get(placement.slotId);
          const offer = offers.get(placement.offerId);
          if (!slot) return null;

          const rect = slotRect(slot, template);
          const positioned: CSSProperties = {
            left: `${rect.left}%`,
            top: `${rect.top}%`,
            width: `${rect.width}%`,
            height: `${rect.height}%`,
          };

          return (
            <div
              className="page__slot"
              style={positioned}
              key={placement.slotId}
              data-slot-id={slot.id}
              // Read by the scoring pipeline to attribute a crop to an offer.
              data-offer-id={placement.offerId}
            >
              {offer ? (
                <OfferTile
                  offer={offer}
                  slot={slot}
                  overrides={placement.overrides}
                  area={slotArea(slot, template)}
                  aspect={slotAspect(slot, template, pageAspect)}
                  selected={selectedOfferId === offer.id}
                  {...(onSelectOffer ? { onSelect: onSelectOffer } : {})}
                />
              ) : (
                <div className="page__empty">Tom plads</div>
              )}
              {slotDecorator?.(slot.id)}
            </div>
          );
        })}
      </div>

      {pageNumber !== undefined && <footer className="page__footer">{pageNumber}</footer>}
    </section>
  );
}
