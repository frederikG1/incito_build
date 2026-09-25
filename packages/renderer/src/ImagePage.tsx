import type { CSSProperties } from 'react';
import type { Brand, CatalogPage } from '@incitio/schema';
import { brandCssVars } from '@incitio/schema';
import { cssUrl } from './format.js';
import { IncitoPage, printsExactly } from './IncitoPage.js';

export interface ImagePageProps {
  page: CatalogPage;
  brand: Brand;
  pageIndex?: number;
  pageNumber?: number;
}

/**
 * A page that is one picture — an ad, a campaign spread, a back cover.
 *
 * No template, no grid, no masthead, nothing to cast. The picture is a
 * `PageBackground`, so the PDF run's path rewriting and the inspector's
 * fit and crop controls work here for free.
 */
export function ImagePage({ page, brand, pageIndex = 0 }: ImagePageProps) {
  // A published cover or advert is printed from its own tree, like any page.
  if (printsExactly(page)) return <IncitoPage page={page} />;

  const style: CSSProperties = {
    ...brandCssVars(brand, pageIndex),
    aspectRatio: String(brand.pageAspect),
  } as CSSProperties;

  return (
    <section
      className={`page page--image brand--${brand.id}`}
      style={style}
      data-page-id={page.id}
      data-page-kind="image"
    >
      {page.background ? (
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
      ) : (
        // A sheet that renders as nothing is indistinguishable from one
        // that failed to render.
        <p className="page__missing">Siden har intet billede</p>
      )}

      {/* No page number on the sheet: the chain's pages do not print one. */}
    </section>
  );
}
