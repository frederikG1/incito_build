import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { CatalogPage, PageTemplate } from '@incitio/schema';
import { freeSlots } from './grid.js';
import { useStudio } from './state.js';
import { OFFER_MIME, droppedOffers } from './Tray.js';

/**
 * The page's empty cells, as drop targets over the sheet.
 *
 * The renderer draws only the cells that hold something — an empty cell
 * is nothing on paper, and it must stay nothing — so there is no
 * element to drop a product on. This lays a grid of the page's own
 * areas exactly over the printed one, copying its resolved tracks and
 * gap off the live element, and draws only the free cells. Editor
 * chrome, measured from the page but never inside it.
 */
export function EmptyCells({ page, template }: { page: CatalogPage; template: PageTemplate }) {
  const fillSlot = useStudio((s) => s.fillSlot);
  const addOffersToPage = useStudio((s) => s.addOffersToPage);
  const root = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState<CSSProperties | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const free = freeSlots(page, template);

  useLayoutEffect(() => {
    const measure = () => {
      const host = root.current?.parentElement;
      const grid = host?.querySelector<HTMLElement>('.page__grid');
      if (!host || !grid) return setFrame(null);
      const outer = host.getBoundingClientRect();
      const box = grid.getBoundingClientRect();
      const style = getComputedStyle(grid);
      setFrame({
        left: box.left - outer.left,
        top: box.top - outer.top,
        width: box.width,
        height: box.height,
        gridTemplateColumns: style.gridTemplateColumns,
        gridTemplateRows: style.gridTemplateRows,
        gap: style.gap,
      });
    };
    measure();
    const host = root.current?.parentElement;
    const watch = new ResizeObserver(measure);
    if (host) watch.observe(host);
    return () => watch.disconnect();
  }, [page, template]);

  if (free.length === 0) return <div ref={root} hidden />;

  return (
    <div
      ref={root}
      className="empties"
      style={{
        ...frame,
        ...(frame ? {} : { display: 'none' }),
        gridTemplateAreas: template.areas.map((row) => `'${row}'`).join(' '),
      }}
    >
      {free.map((slot) => (
        <div
          key={slot.id}
          className={`empties__cell${over === slot.id ? ' is-over' : ''}`}
          style={slot.rect
            // A cell measured off a publication sits in its own box —
            // see `TemplateSlot.rect` — and so does its drop target.
            ? {
              position: 'absolute',
              left: `${slot.rect.x * 100}%`,
              top: `${slot.rect.y * 100}%`,
              width: `${slot.rect.w * 100}%`,
              height: `${slot.rect.h * 100}%`,
            }
            : { gridArea: slot.id }}
          onDragOver={(event) => {
            if (!event.dataTransfer.types.includes(OFFER_MIME)) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = 'copy';
            setOver(slot.id);
          }}
          onDragLeave={() => setOver(null)}
          onDrop={(event) => {
            const dragged = event.dataTransfer.getData(OFFER_MIME);
            if (!dragged) return;
            event.preventDefault();
            setOver(null);
            const offers = droppedOffers(dragged, useStudio.getState().librarySelection);
            // One product takes the cell; several picked get a cell each.
            if (offers.length === 1) void fillSlot(page.id, slot.id, offers);
            else addOffersToPage(page.id, offers);
          }}
        >
          <b>Slip en vare her</b>
          <span>træk den fra listen til venstre</span>
        </div>
      ))}
    </div>
  );
}
