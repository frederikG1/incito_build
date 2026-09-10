import type { CatalogDocument, Offer } from '@incitio/schema';

/**
 * Rewrite root-relative asset paths onto a base URL.
 *
 * Feeds from hosted services carry absolute URLs and pass through
 * untouched. An export meant to sit beside an asset bundle carries
 * `/images/SKU-0001.svg`, which is correct when the studio serves
 * `data/` as its web root — and wrong under `file://`, where a leading
 * slash means the filesystem root and every product silently renders as
 * a placeholder.
 *
 * A `<base href>` does not fix that: it changes how RELATIVE paths
 * resolve, while a root-relative path still resolves against the
 * origin. So the paths are rewritten instead, once, before rendering.
 */
export function withAssetBase(document: CatalogDocument, base: string): CatalogDocument {
  const root = base.endsWith('/') ? base : `${base}/`;
  const resolve = (ref: string): string =>
    ref.startsWith('/') ? `${root}${ref.slice(1)}` : ref;

  const rewrite = (offer: Offer): Offer => ({
    ...offer,
    imageUrl: offer.imageUrl ? resolve(offer.imageUrl) : null,
    imagePack: offer.imagePack.map(resolve),
    labels: offer.labels.map((label) => ({
      ...label,
      image: label.image ? resolve(label.image) : null,
      imageOnDark: label.imageOnDark ? resolve(label.imageOnDark) : null,
    })),
  });

  return { ...document, offers: document.offers.map(rewrite) };
}
