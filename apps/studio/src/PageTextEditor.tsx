import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { PagePart } from '@incitio/schema';
import { PAGE_PART_NAMES, pageTextLimits, pageTextOverride } from '@incitio/schema';
import { useStudio } from './state.js';

/**
 * The editing overlay on one of a page's own lines.
 *
 * Rendered through `PageView`'s `textDecorator`, which the print render
 * never passes — the same contract `TileEditor` has through
 * `slotDecorator`, one level up. And deliberately the same interaction,
 * because a heading is not a special case of anything:
 *
 *   click             take the line in hand
 *   drag              move it, anywhere on the sheet
 *   ⌘/ctrl + wheel    resize it
 *   double-click      rewrite it in place
 *   ⌫                 take it off the page
 *
 * What it writes is `CatalogPage.texts`, so a heading moved here prints
 * where it was put and survives a save, a reopen and the PDF run.
 *
 * The wording is the one thing it does NOT write through the override:
 * the strings stay in `page.title`/`page.subtitle`, which is where the
 * sheet bar and the inspector have always bound them.
 */
export interface PageTextEditorProps {
  pageId: string;
  part: PagePart;
}

const clamp = (value: number, low: number, high: number) =>
  Math.min(high, Math.max(low, value));

interface Bounds { minX: number; maxX: number; minY: number; maxY: number }

/**
 * How far this line can go before it leaves the sheet.
 *
 * The page clips — see `.page` — so a heading dragged past the edge
 * simply disappears. The override is still written and "Nulstil" still
 * brings it back, but "I dragged it and it vanished" is
 * indistinguishable from a broken editor. Fencing the drag at the paper
 * says the same thing by letting the line refuse to go further, which
 * is exactly what `withinSlot` does for a tile's boxes at the cell
 * wall.
 *
 * Derived from where the line is RIGHT NOW in pixels, then converted
 * into the page percent the offsets are stored in. A line wider than
 * the sheet — a heading someone has set at 3× — has no room in that
 * axis and keeps whatever it has, rather than being snapped back.
 */
function withinPage(
  element: HTMLElement,
  sheet: DOMRect,
  start: { offsetX: number; offsetY: number },
  perX: number,
  perY: number,
  reach: number,
): Bounds {
  const here = element.getBoundingClientRect();
  const span = (
    before: number, after: number, per: number, from: number,
  ): [number, number] => {
    // `before` is the room above/to the left, `after` the room
    // below/to the right. Both are travel already spent, so they
    // bracket the offset the line currently carries.
    if (before < 0 || after < 0) return [from, from];
    return [
      Math.max(from - before * per, -reach),
      Math.min(from + after * per, reach),
    ];
  };

  const [minX, maxX] = span(here.left - sheet.left, sheet.right - here.right, perX, start.offsetX);
  const [minY, maxY] = span(here.top - sheet.top, sheet.bottom - here.bottom, perY, start.offsetY);
  return { minX, maxX, minY, maxY };
}

/** The style properties that decide whether the input looks like print. */
const TYPE_PROPERTIES = [
  'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight',
  'letterSpacing', 'textTransform', 'textAlign', 'color',
] as const;

function typeOf(element: Element): CSSProperties {
  const computed = window.getComputedStyle(element);
  const style: Record<string, string> = {};
  for (const property of TYPE_PROPERTIES) style[property] = computed[property];
  return style as CSSProperties;
}

export function PageTextEditor({ pageId, part }: PageTextEditorProps) {
  const page = useStudio((s) => s.document?.pages.find((p) => p.id === pageId));
  const held = useStudio((s) => s.selectedText?.pageId === pageId && s.selectedText.part === part);
  const selectPageText = useStudio((s) => s.selectPageText);
  const updatePageText = useStudio((s) => s.updatePageText);
  const setPageTitle = useStudio((s) => s.setPageTitle);
  const setPageSubtitle = useStudio((s) => s.setPageSubtitle);
  const endGesture = useStudio((s) => s.endGesture);

  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const [editing, setEditing] = useState<{ value: string; type: CSSProperties } | null>(null);
  /** Live readout during a move or a resize. Null when the line is at rest. */
  const [hud, setHud] = useState<string | null>(null);

  const words = page ? (part === 'title' ? page.title : page.subtitle) : '';

  /*
   * Zoom is a modified wheel, and it has to be a native listener —
   * React registers `onWheel` passively, so preventDefault from it is
   * ignored. Ctrl/⌘ zooms; a plain wheel still scrolls the catalogue,
   * and a trackpad pinch arrives as ctrl+wheel.
   */
  useEffect(() => {
    const element = root.current;
    if (!element || !held || !page) return undefined;

    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const { minScale, maxScale } = pageTextLimits();
      const now = pageTextOverride(page, part).scale;
      const next = clamp(now * Math.exp(-event.deltaY * 0.0015), minScale, maxScale);
      updatePageText(pageId, part, { scale: next }, `text-scale:${pageId}:${part}`);
      setHud(`${PAGE_PART_NAMES[part]}  ${next.toFixed(2)}×`);
    };

    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [held, page, part, pageId, updatePageText]);

  /* The readout fades on its own; a zoom has no pointer-up to hang it on. */
  useEffect(() => {
    if (hud === null) return undefined;
    const timer = window.setTimeout(() => setHud(null), 900);
    return () => window.clearTimeout(timer);
  }, [hud]);

  useLayoutEffect(() => {
    if (!editing) return;
    input.current?.focus();
    input.current?.select();
  }, [editing !== null]);

  function edit(): void {
    const element = root.current?.parentElement?.firstElementChild;
    if (!element) return;
    selectPageText(pageId, part);
    setEditing({ value: words, type: typeOf(element) });
  }

  function commit(value: string): void {
    const text = value.trim();
    if (part === 'title') setPageTitle(pageId, text);
    else setPageSubtitle(pageId, text);
    endGesture();
    setEditing(null);
  }

  /**
   * Move the line. One history entry for the whole drag.
   *
   * In PAGE percent, measured off the page itself: one percent of the
   * page is one `cqw`, so what is stored and what the pointer covered
   * are the same thing — and a canvas zoomed out to a thumbnail still
   * moves the heading by what the hand did rather than by what the
   * numbers would be at A4.
   */
  function onPointerDown(event: React.PointerEvent<HTMLDivElement>): void {
    if (!page || editing || event.button !== 0) return;
    const element = root.current;
    if (!element) return;

    /*
     * Pressing takes the line in hand and starts moving it in the same
     * gesture — the pointer is already down on the thing that was
     * meant, and a correct two-step nobody performs is not correct.
     */
    if (!held) selectPageText(pageId, part);

    const sheet = element.closest('.page')?.getBoundingClientRect();
    if (!sheet || sheet.width === 0 || sheet.height === 0) return;

    const { reach } = pageTextLimits();
    const start = pageTextOverride(page, part);
    const perX = 100 / sheet.width;
    const perY = 100 / sheet.height;
    const from = { x: event.clientX, y: event.clientY };
    const bounds = withinPage(element, sheet, start, perX, perY, reach);

    // Capture keeps the drag alive when the pointer leaves the words,
    // which it does on the first pixel: the box hugs them.
    try { element.setPointerCapture(event.pointerId); } catch { /* uncapturable */ }

    const onMove = (move: PointerEvent) => {
      const x = clamp(start.offsetX + (move.clientX - from.x) * perX, bounds.minX, bounds.maxX);
      const y = clamp(start.offsetY + (move.clientY - from.y) * perY, bounds.minY, bounds.maxY);
      updatePageText(pageId, part, { offsetX: x, offsetY: y }, `text-move:${pageId}:${part}`);
      setHud(`${PAGE_PART_NAMES[part]}  ${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(1)}  ${y >= 0 ? '+' : '−'}${Math.abs(y).toFixed(1)}`);
    };

    const onUp = () => {
      try { element.releasePointerCapture(event.pointerId); } catch { /* never held */ }
      element.removeEventListener('pointermove', onMove);
      element.removeEventListener('pointerup', onUp);
      element.removeEventListener('pointercancel', onUp);
      endGesture();
      setHud(null);
    };

    element.addEventListener('pointermove', onMove);
    element.addEventListener('pointerup', onUp);
    element.addEventListener('pointercancel', onUp);
  }

  if (!page) return null;

  const className = [
    'handle', 'handle--text',
    held && 'handle--armed',
    editing && 'handle--editing',
  ].filter(Boolean).join(' ');

  return (
    <div
      ref={root}
      className={className}
      onPointerDown={onPointerDown}
      onDoubleClick={(event) => { event.stopPropagation(); edit(); }}
    >
      <b className="handle__tag">{PAGE_PART_NAMES[part]}</b>

      {hud && <span className="handle__hud">{hud}</span>}

      {editing && (
        <textarea
          ref={input}
          className="handle__text handle__text--fill"
          value={editing.value}
          style={editing.type}
          onChange={(event) => setEditing({ ...editing, value: event.target.value })}
          onBlur={(event) => commit(event.target.value)}
          onPointerDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === 'Escape') { setEditing(null); return; }
            // Enter commits. Both lines are set `nowrap` or sized to one
            // line in print, so a hard newline is never what was meant.
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              commit(editing.value);
            }
          }}
        />
      )}
    </div>
  );
}
