import { useRef, useState, type CSSProperties, type DragEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type WheelEvent } from 'react';
import type { CatalogPage, IncitoSource, Offer, PageTemplate } from '@incitio/schema';
import { INCITO_CSS, incitoCellBoxes, incitoCells, incitoFontCss, incitoHtml, incitoSheet } from './incito.js';
import { boundIncito } from './paged.js';
import { shifted, snap, type Guide, type Rect } from './snap.js';

export interface IncitoPageProps {
  page: CatalogPage & { incito: IncitoSource };
  offers?: Map<string, Offer>;
  /** Editor only: the element in hand, and how to take one — see `incitoBlocks`. */
  selectedBlock?: string | null;
  onSelectBlock?: (path: string | null) => void;
  /** Editor only: put an element at this offset, in the sheet's points. One gesture per drag. */
  onMoveBlock?: (path: string, at: { dx: number; dy: number }, gesture: string) => void;
  /** Editor only: grow or shrink the element in hand — ⌘/ctrl + scroll. */
  onScaleBlock?: (path: string, by: number) => void;
  onMoveEnd?: () => void;
  /** Editor only: something from the shelf was dropped on one of the publication's offers. */
  onDropOnOffer?: (offerViewId: string, event: globalThis.DragEvent) => void;
  /** Which drags are products — the shelf's own type — so nothing else lights a cell up. */
  dropType?: string;
  /** The page's layout — what a page made from a picture draws its cells from. */
  template?: PageTemplate | null;
  /** Drawn over the sheet: the chain's tiles in the cells of a picture page. */
  children?: ReactNode;
}

/**
 * A page printed exactly as it was published — see `incito.ts`.
 *
 * Drawn at the publication's own size (600 × 1000 for these) inside an
 * SVG `foreignObject`, which scales it to whatever box it stands in —
 * a 176-px card in the book, the canvas, an A4 sheet in the PDF —
 * without a script and without re-laying out a single line: the page
 * is typeset once, at its own size, and then scaled as a picture is.
 *
 * The sheet keeps the publication's aspect. A publication is 0.6 and
 * the chain's print format is 0.707; stretching one into the other is
 * what made imported pages look nearly-but-not-quite right.
 */
export function IncitoPage({
  page, offers, selectedBlock, onSelectBlock, onMoveBlock, onScaleBlock, onMoveEnd,
  onDropOnOffer, dropType, template, children,
}: IncitoPageProps) {
  const drag = useRef<{
    path: string; x: number; y: number; dx: number; dy: number; k: number; moved: boolean;
    box: Rect | null; targets: Rect[]; frame: DOMRect;
  } | null>(null);
  // The lines a drag is lined up on, in the page's own pixels on screen.
  const [guides, setGuides] = useState<Guide[]>([]);
  const { theme, fonts } = page.incito;
  // The page's own size, not the viewer's section around it — see `incitoSheet`.
  const { width, height } = incitoSheet(page.incito);
  const cells = incitoCells(page, offers ?? new Map());
  const html = incitoHtml(
    boundIncito(page, offers ?? new Map(), template), cells?.now ?? new Map(), page.incitoEdits ?? {}, cells?.printed ?? new Map(),
    incitoCellBoxes(page, template),
  );
  const editable = Boolean(onSelectBlock);
  // The element in hand wears the same ring the tiles do. Written as a
  // rule rather than into the markup, so a selection never retypesets the page.
  const ring = editable && selectedBlock
    ? `[data-page-id="${page.id}"] [data-incito-block="${selectedBlock}"] { outline: 3px solid #2d6cdf; outline-offset: 2px; }`
    : '';
  const style: CSSProperties = {
    aspectRatio: `${width} / ${height}`,
    background: theme.background,
  };

  return (
    <section
      className={`page page--incito${editable ? ' page--incito-editable' : ''}`}
      style={style}
      {...(editable ? {
        /*
         * Press to take an element, and move it in the same gesture —
         * a tile's box answers the same way. Distances are converted to
         * the sheet's own points, so a drag moves the element under the
         * pointer at any zoom.
         */
        onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
          if (event.button !== 0) return;
          // A tile over the sheet is the tile's business, not the sheet's.
          if ((event.target as Element).closest?.('.page--overlay')) return;
          const hit = (event.target as Element).closest?.('[data-incito-block]');
          const path = hit?.getAttribute('data-incito-block') ?? null;
          onSelectBlock!(path);
          if (!path || !onMoveBlock) return;
          const frame = event.currentTarget.getBoundingClientRect();
          const was = page.incitoEdits?.[path];
          /*
           * What it may line up with: the page's edges and middle, and
           * every other element and product on it. Measured once, at
           * the start — nothing else moves while this does.
           */
          const rectOf = (element: Element): Rect => {
            const r = element.getBoundingClientRect();
            return { left: r.left, top: r.top, width: r.width, height: r.height };
          };
          const targets: Rect[] = [rectOf(event.currentTarget)];
          for (const other of event.currentTarget.querySelectorAll('[data-incito-block], .tile__media > img, .tile__pack > img')) {
            if (other === hit || hit?.contains(other) || other.contains(hit!)) continue;
            const r = rectOf(other);
            if (r.width >= 4 && r.height >= 4) targets.push(r);
          }
          drag.current = {
            path, x: event.clientX, y: event.clientY,
            dx: was?.dx ?? 0, dy: was?.dy ?? 0,
            k: frame.width / width, moved: false,
            box: hit ? rectOf(hit) : null, targets, frame,
          };
          try {
            event.currentTarget.setPointerCapture(event.pointerId);
          } catch { /* a pointer the browser no longer knows — the drag still works without capture */ }
          event.preventDefault();
        },
        onPointerMove: (event: ReactPointerEvent<HTMLElement>) => {
          const held = drag.current;
          if (!held || !onMoveBlock) return;
          const ox = event.clientX - held.x;
          const oy = event.clientY - held.y;
          // A few pixels of wobble on a click is not a move.
          if (!held.moved && Math.hypot(ox, oy) < 3) return;
          held.moved = true;
          // Alt lets go of the snapping, as in every tool of this kind.
          const pull = held.box && !event.altKey
            ? snap(shifted(held.box, ox, oy), held.targets)
            : { dx: 0, dy: 0, guides: [] };
          setGuides(pull.guides.map((guide) => (guide.axis === 'x'
            ? { ...guide, at: guide.at - held.frame.left, from: guide.from - held.frame.top, to: guide.to - held.frame.top }
            : { ...guide, at: guide.at - held.frame.top, from: guide.from - held.frame.left, to: guide.to - held.frame.left })));
          onMoveBlock(held.path, { dx: held.dx + (ox + pull.dx) / held.k, dy: held.dy + (oy + pull.dy) / held.k }, `incito-drag-${held.path}`);
        },
        onPointerUp: () => {
          if (drag.current?.moved) onMoveEnd?.();
          drag.current = null;
          setGuides([]);
        },
        /*
         * A product from the shelf, dropped on a product on the page,
         * takes its cell — and its layout. The cell under the pointer
         * lights up while the drag is over it, so where it will land is
         * never a guess.
         */
        onDragOver: (event: DragEvent<HTMLElement>) => {
          if (!onDropOnOffer || (dropType && !event.dataTransfer.types.includes(dropType))) return;
          const cell = (event.target as Element).closest?.('[data-offer-view]');
          for (const lit of event.currentTarget.querySelectorAll('.is-drop')) if (lit !== cell) lit.classList.remove('is-drop');
          if (!cell) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
          cell.classList.add('is-drop');
        },
        onDragLeave: (event: DragEvent<HTMLElement>) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node)) {
            for (const lit of event.currentTarget.querySelectorAll('.is-drop')) lit.classList.remove('is-drop');
          }
        },
        onDrop: (event: DragEvent<HTMLElement>) => {
          for (const lit of event.currentTarget.querySelectorAll('.is-drop')) lit.classList.remove('is-drop');
          const cell = (event.target as Element).closest?.('[data-offer-view]');
          const viewId = cell?.getAttribute('data-offer-view');
          if (!viewId || !onDropOnOffer) return;
          event.preventDefault();
          onDropOnOffer(viewId, event.nativeEvent);
        },
        onWheel: (event: WheelEvent<HTMLElement>) => {
          if (!selectedBlock || !onScaleBlock || !(event.metaKey || event.ctrlKey)) return;
          event.preventDefault();
          onScaleBlock(selectedBlock, event.deltaY < 0 ? 0.03 : -0.03);
        },
      } : {})}
      data-page-id={page.id}
      data-page-kind="incito"
    >
      {/* As raw CSS: rendered as a text child, React escapes the quotes in
          `url("…")` and `[data-name="superscript"]` in static markup, and
          both rules — the chain's fonts and the raised øre — silently die. */}
      <style dangerouslySetInnerHTML={{ __html: `${INCITO_CSS}\n${incitoFontCss(fonts)}\n${ring}` }} />
      <svg
        className="page__incito"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        width="100%"
        height="100%"
        aria-hidden="true"
      >
        <foreignObject x="0" y="0" width={width} height={height}>
          <div
            className="tjek-incito"
            style={{
              width,
              height,
              fontFamily: theme.fontFamily,
              color: theme.color,
              lineHeight: theme.lineHeight,
              backgroundColor: theme.background,
            }}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </foreignObject>
      </svg>
      {children}
      {guides.map((guide, index) => (
        <span
          key={`${guide.axis}-${index}`}
          className={`incito__guide incito__guide--${guide.axis}`}
          style={guide.axis === 'x'
            ? { left: guide.at, top: guide.from, height: guide.to - guide.from }
            : { top: guide.at, left: guide.from, width: guide.to - guide.from }}
        />
      ))}
    </section>
  );
}

/**
 * Whether a page should be printed as published.
 *
 * As long as every product on it stands in one of the publication's
 * own cells — including a product that has replaced the one printed
 * there, which is set in that one's layout (see `incitoCells`). Only a
 * product in a cell the publication never had turns the page into tiles.
 */
export function printsExactly(page: CatalogPage): page is CatalogPage & { incito: IncitoSource } {
  if (!page.incito || !page.exact) return false;
  return incitoCells(page as CatalogPage & { incito: IncitoSource }, new Map()) !== null;
}
