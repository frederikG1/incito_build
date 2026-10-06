import { useMemo, useState } from 'react';
import type { Brand, CatalogDocument, CatalogPage, PageTemplate } from '@incitio/schema';
import { resolveTemplate } from '@incitio/brands';
import { ImageSize, PageView } from '@incitio/renderer';
import { THUMB_PX, layoutKey, pageInLayout, useStudio, useStudioPick, withTemplates } from './state.js';
import { STANDARD_COUNTS, standardLayouts } from './layouts.js';

/** A layout drawn small: its cells as blocks on a sheet. */
export function LayoutThumb({ template }: { template: PageTemplate }) {
  const measured = template.slots.some((slot) => slot.rect);
  if (measured) {
    return (
      <span className="thumb thumb--free">
        {template.slots.filter((slot) => slot.rect).map((slot) => (
          <i
            key={slot.id}
            style={{
              left: `${slot.rect!.x * 100}%`, top: `${slot.rect!.y * 100}%`,
              width: `${slot.rect!.w * 100}%`, height: `${slot.rect!.h * 100}%`,
            }}
          />
        ))}
      </span>
    );
  }
  const columns = template.areas[0]!.split(' ').length;
  return (
    <span
      className="thumb"
      style={{
        gridTemplateAreas: template.areas.map((row) => `'${row}'`).join(' '),
        gridTemplateColumns: `repeat(${columns}, 1fr)`,
        gridTemplateRows: `repeat(${template.areas.length}, 1fr)`,
      }}
    >
      {template.slots.map((slot) => <i key={slot.id} style={{ gridArea: slot.id }} />)}
    </span>
  );
}

/** Width the preview page is laid out at, and drawn at — see `.gallery__live`. */
const WORK_PX = 500;
const SHOWN_PX = 128;

/**
 * This page, in one layout — its own products, prices and pictures.
 *
 * Worked out by `pageInLayout`, the same function the click applies, so
 * what is shown is what is chosen: a grey box had to be imagined, and
 * the imagining was where the surprise came from.
 */
function LivePreview({
  document, brand, page, option, index, on,
}: { document: CatalogDocument; brand: Brand; page: CatalogPage; option: PageTemplate; index: number; on: boolean }) {
  const shown = useMemo(() => {
    // The layout the page is in is the page as it is.
    const next = (on ? null : pageInLayout(document, brand, page.id, option)) ?? document;
    const sheet = next.pages.find((entry) => entry.id === page.id)!;
    const template = next.templates.find((t) => t.id === sheet.templateId)
      ?? resolveTemplate(brand, sheet.templateId);
    return template ? { next, sheet, template } : null;
  }, [document, brand, page.id, option, on]);
  const offers = useMemo(
    () => new Map((shown?.next.offers ?? []).map((offer) => [offer.id, offer])),
    [shown?.next.offers],
  );
  if (!shown) return <LayoutThumb template={option} />;
  return (
    <span
      className="gallery__live"
      style={{ width: SHOWN_PX, height: SHOWN_PX / brand.pageAspect, background: shown.sheet.ground ?? undefined }}
      aria-hidden="true"
    >
      <span style={{ width: WORK_PX, transform: `scale(${SHOWN_PX / WORK_PX})` }}>
        <ImageSize.Provider value={THUMB_PX}>
          <PageView
            page={shown.sheet}
            template={shown.template}
            brand={withTemplates(brand, shown.next.templates)}
            offers={offers}
            pageIndex={index}
            pageNumber={index + 1}
          />
        </ImageSize.Provider>
      </span>
    </span>
  );
}

/**
 * Every layout the page can take, drawn with the page itself in it.
 *
 * The counts next to the page's own are drawn live — the page as it
 * would be, one click from being so. The rest, further from what the
 * page holds, stay small shapes: rendering the whole avis twenty times
 * to answer "nine products?" is not worth the wait.
 *
 * Switching is not destructive: the page remembers each layout it has
 * been in, and choosing one again brings it back as it was left.
 */
export function LayoutGallery({
  page, template, spare, index,
}: { page: CatalogPage; template: PageTemplate; spare: number; index: number }) {
  const s = useStudioPick('applyLayout', 'brand', 'document');
  const [open, setOpen] = useState(false);
  const [others, setOthers] = useState(false);
  const brand = s.brand;
  const document = s.document;
  if (!brand || !document) return null;

  const here = page.placements.length;
  const current = layoutKey(page);
  /*
   * The standard shapes only — see `standardLayouts` — and the page's own
   * layout in its row, so the one it has is always there to go back to.
   */
  /*
   * And every layout of its own the page has been in — the one it was
   * read off the publication in, one shaped by hand — so leaving it for a
   * standard shape is never a one-way door.
   */
  const remembered = Object.entries(page.layouts ?? {})
    .filter(([key]) => !key.startsWith('std/') && key !== current)
    .map(([, memory]) => memory.template);
  const rows = STANDARD_COUNTS.map((count) => {
    const options = standardLayouts(count);
    const own = [
      ...(count === template.slots.length && !options.some((t) => t.id === current) ? [template] : []),
      ...remembered.filter((t) => t.slots.length === count),
    ];
    const list = [...new Map([...own, ...options].map((t) => [t.id, t])).values()];
    return { count, list, fills: Math.min(count, here + spare) };
  });
  // The page's own count and one either side, which is what a page is
  // usually a click from; anything reachable only with empty cells is not.
  const near = (count: number) => Math.abs(count - here) <= 1 && count <= here + spare;
  const isOn = (option: PageTemplate) => option.id === current || option.id === template.id;

  const choose = (option: PageTemplate) => {
    setOpen(false);
    if (isOn(option)) return;
    s.applyLayout(page.id, option);
  };
  const title = (option: PageTemplate, row: { count: number; fills: number }) => (row.fills < row.count
    ? `${option.name} — ${row.count - row.fills === 1 ? '1 felt står tomt' : `${row.count - row.fills} felter står tomme`}, træk varer ind fra listen`
    : option.name);

  return (
    <div className="gallery">
      <button
        className="gallery__open"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        title="Vælg hvor mange varer og hvilket layout siden har"
      >
        <LayoutThumb template={template} />
        <span>{here} {here === 1 ? 'vare' : 'varer'} ▾</span>
      </button>
      {open && (
        <>
          <div className="gallery__away" onPointerDown={() => setOpen(false)} />
          <div className="gallery__card gallery__card--live">
            {rows.filter((row) => near(row.count)).map((row) => (
              <div className="gallery__row" key={row.count}>
                <b>{row.count} {row.count === 1 ? 'vare' : 'varer'}</b>
                <div className="gallery__options">
                  {row.list.map((option) => (
                    <button
                      key={option.id}
                      className={`gallery__option gallery__option--live${isOn(option) ? ' is-on' : ''}`}
                      title={title(option, row)}
                      onClick={() => choose(option)}
                    >
                      <LivePreview document={document} brand={brand} page={page} option={option} index={index} on={isOn(option)} />
                      <small>{option.name}</small>
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <button className="gallery__more" onClick={() => setOthers(!others)} aria-expanded={others}>
              {others ? 'Skjul andre antal' : 'Andre antal varer'} {others ? '▴' : '▾'}
            </button>
            {others && rows.filter((row) => !near(row.count)).map((row) => (
              <div className="gallery__row" key={row.count}>
                <b>{row.count} {row.count === 1 ? 'vare' : 'varer'}</b>
                <div className="gallery__options">
                  {row.list.map((option) => (
                    <button
                      key={option.id}
                      className={`gallery__option${isOn(option) ? ' is-on' : ''}`}
                      title={title(option, row)}
                      onClick={() => choose(option)}
                    >
                      <LayoutThumb template={option} />
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <p className="gallery__hint">Et layout du har prøvet, kommer tilbage som du forlod det. Finjustér bagefter med “Rediger layout”.</p>
          </div>
        </>
      )}
    </div>
  );
}
