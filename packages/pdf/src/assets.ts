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

  /*
   * Decorations and the page's background carry the same root-relative
   * form and break the same way — `/decor/ab12cd.png` under `file://`
   * is the filesystem root. Both are on the page, not on an offer, so
   * `rewrite` above never sees them.
   *
   * The background fails LOUDER than a missing product: it is a CSS
   * `background-image`, so a path that does not resolve is not a broken
   * icon but a sheet that prints plain — measured, and correct-looking
   * enough that nobody would go looking for a bug.
   */
  return {
    ...document,
    offers: document.offers.map(rewrite),
    pages: document.pages.map((page) => ({
      ...page,
      ...(page.decorations.length > 0 && {
        decorations: page.decorations.map((d) => ({ ...d, imageUrl: resolve(d.imageUrl) })),
      }),
      ...(page.background && {
        background: { ...page.background, imageUrl: resolve(page.background.imageUrl) },
      }),
      /*
       * A page printed from its own tree carries its pictures inside the
       * tree — and a page made from a publication's picture carries
       * that picture as `/uploads/…`, which breaks the same way.
       */
      ...(page.incito && {
        incito: { ...page.incito, view: rewriteTree(page.incito.view, resolve) as Record<string, unknown> },
      }),
      ...((page.notes ?? []).some((note) => note.image) && {
        notes: page.notes.map((note) => (note.image ? { ...note, image: resolve(note.image) } : note)),
      }),
    })),
  };
}

/** Every picture in an incito tree, resolved — `src` and `background_image`. */
function rewriteTree(node: unknown, resolve: (ref: string) => string): unknown {
  if (Array.isArray(node)) return node.map((child) => rewriteTree(child, resolve));
  if (!node || typeof node !== 'object') return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    out[key] = (key === 'src' || key === 'background_image' || key === 'image') && typeof value === 'string'
      ? resolve(value)
      : rewriteTree(value, resolve);
  }
  return out;
}
