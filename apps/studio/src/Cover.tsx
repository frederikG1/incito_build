import { useEffect, useState } from 'react';
import { isImagePage } from '@incitio/schema';
import { resolveTemplate } from '@incitio/brands';
import { ImagePage, ImageSize, PageView } from '@incitio/renderer';
import { fetchCover, type CatalogCover } from './api.js';
import { THUMB_PX, useStudio } from './state.js';

/**
 * An avis's front page, small — on the front page, where a list of
 * names used to be.
 *
 * Drawn with the renderer, like the book's thumbnails, so the cover is
 * the printed page and not a picture of it. Fetched once per avis and
 * remembered for the session: the front page is visited often and the
 * covers do not change while you look at it — a newer save simply
 * shows next time, keyed by when it was saved.
 */
const covers = new Map<string, Promise<CatalogCover>>();

export function Cover({ id, updatedAt, size = 'card' }: { id: string; updatedAt: string; size?: 'card' | 'hero' }) {
  const brand = useStudio((s) => s.brand);
  const brandId = useStudio((s) => s.brandId);
  const [cover, setCover] = useState<CatalogCover | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!brandId) return;
    let live = true;
    const key = `${brandId}:${id}:${updatedAt}`;
    if (!covers.has(key)) covers.set(key, fetchCover(brandId, id));
    covers.get(key)!.then((value) => { if (live) setCover(value); }, () => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [brandId, id, updatedAt]);

  const page = cover?.page ?? null;
  const template = page && brand && !isImagePage(page)
    ? resolveTemplate(brand, page.templateId) ?? cover!.templates.find((t) => t.id === page.templateId)
    : undefined;
  const offers = new Map((cover?.offers ?? []).map((offer) => [offer.id, offer]));
  const drawn = !brand || !page ? null : isImagePage(page) ? (
    <ImagePage page={page} brand={brand} pageIndex={0} pageNumber={1} />
  ) : template ? (
    <PageView page={page} template={template} brand={brand} offers={offers} pageIndex={0} pageNumber={1} />
  ) : null;

  return (
    <div
      className={`cover cover--${size}${drawn ? '' : ' cover--blank'}`}
      style={{ background: page?.ground ?? brand?.tokens.ground ?? undefined, aspectRatio: String(brand?.pageAspect ?? 0.707) }}
      aria-hidden="true"
    >
      {drawn && <div className="cover__live"><ImageSize.Provider value={THUMB_PX}>{drawn}</ImageSize.Provider></div>}
      {!drawn && <span className="cover__none">{failed || (cover && !page) ? 'Ingen sider endnu' : ''}</span>}
    </div>
  );
}
