import type { Brand, CatalogDocument } from '@incitio/schema';
import { resolveTemplate } from '@incitio/brands';
import { PageView } from './PageView.js';
import { ImagePage } from './ImagePage.js';

export interface CatalogViewProps {
  document: CatalogDocument;
  /** Must be the document's own brand; see the guard below. */
  brand: Brand;
  selectedOfferId?: string | null;
  onSelectOffer?: (offerId: string) => void;
}

/**
 * A whole catalogue, page after page.
 *
 * The brand is passed in rather than looked up from `document.brandId`
 * so this component stays free of the registry — but the two must agree,
 * and a mismatch is a tenancy bug rather than a rendering one, so it
 * fails loudly instead of drawing a Netto catalogue in Coop red.
 */
export function CatalogView({
  document, brand, selectedOfferId, onSelectOffer,
}: CatalogViewProps) {
  if (document.brandId !== brand.id) {
    throw new Error(
      `catalogue "${document.id}" belongs to ${document.brandId}, not ${brand.id}`,
    );
  }

  const offers = new Map(document.offers.map((offer) => [offer.id, offer]));

  return (
    <div className="catalog">
      {document.pages.map((page, index) => {
        if (page.kind === 'image') {
          return (
            <ImagePage
              key={page.id}
              page={page}
              brand={brand}
              pageIndex={index}
              pageNumber={index + 1}
            />
          );
        }
        /*
         * The chain's own layouts first, then any the document brought
         * with it — see `CatalogDocument.templates`. A page rebuilt
         * from a reference sits on a layout nobody drew for the chain,
         * and without this fallback it would print as "unknown
         * template" everywhere except the session that generated it.
         */
        const template = resolveTemplate(brand, page.templateId)
          ?? document.templates.find((t) => t.id === page.templateId);
        if (!template) {
          return (
            <div className="page page--error" key={page.id}>
              Ukendt skabelon: {page.templateId}
            </div>
          );
        }
        return (
          <PageView
            key={page.id}
            page={page}
            template={template}
            brand={brand}
            offers={offers}
            pageIndex={index}
            pageNumber={index + 1}
            selectedOfferId={selectedOfferId ?? null}
            {...(onSelectOffer ? { onSelectOffer } : {})}
          />
        );
      })}
    </div>
  );
}
