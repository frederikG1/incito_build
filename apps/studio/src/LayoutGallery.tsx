import { useState } from 'react';
import type { CatalogPage, PageTemplate } from '@incitio/schema';
import { useStudio } from './state.js';
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

/**
 * Every layout the page can take, drawn rather than named.
 *
 * "To store og et bånd" had to be read and imagined; a picture of it is
 * seen. Grouped by how many products the page holds, so choosing the
 * count and the shape is one click. A count larger than the page has
 * products for leaves cells empty, to be filled from the list.
 */
export function LayoutGallery({
  page, template, spare,
}: { page: CatalogPage; template: PageTemplate; spare: number }) {
  const s = useStudio();
  const [open, setOpen] = useState(false);
  const brand = s.brand;
  if (!brand) return null;

  const here = page.placements.length;
  /*
   * The standard shapes only — see `standardLayouts` — and the page's own
   * layout in its row, so the one it has is always there to go back to.
   */
  const rows = STANDARD_COUNTS.map((count) => {
    const options = standardLayouts(count);
    const list = count === template.slots.length && !options.some((t) => t.id === template.id)
      ? [template, ...options]
      : options;
    return { count, list, reachable: true, fills: Math.min(count, here + spare) };
  });

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
          <div className="gallery__card">
            {rows.map((row) => (
              <div className="gallery__row" key={row.count}>
                <b>{row.count} {row.count === 1 ? 'vare' : 'varer'}</b>
                <div className="gallery__options">
                  {row.list.map((option) => (
                    <button
                      key={option.id}
                      className={`gallery__option${option.id === template.id ? ' is-on' : ''}`}
                      disabled={!row.reachable}
                      title={row.fills < row.count
                        ? `${option.name} — ${row.count - row.fills === 1 ? '1 felt står tomt' : `${row.count - row.fills} felter står tomme`}, træk varer ind fra listen`
                        : option.name}
                      onClick={() => {
                        setOpen(false);
                        if (option.id === template.id) return;
                        s.applyLayout(page.id, option);
                      }}
                    >
                      <LayoutThumb template={option} />
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <p className="gallery__hint">Vælg en form — og finjustér den bagefter med “Rediger layout”.</p>
          </div>
        </>
      )}
    </div>
  );
}
