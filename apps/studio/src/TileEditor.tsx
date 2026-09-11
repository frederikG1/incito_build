import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { TilePart } from '@incitio/schema';
import { TILE_PART_NAMES, TILE_PARTS, partLimits, partOverride } from '@incitio/schema';
import { useStudio } from './state.js';

/**
 * The editing overlay on one slot.
 *
 * Rendered through `PageView`'s `slotDecorator`, which the print render
 * never passes — so the editor gets handles, panning and inline text
 * and the PDF gets none of it, from the same components.
 *
 * The interaction model is deliberately small, and borrowed from image
 * editors because that is what people already know:
 *
 *   click             select the tile
 *   click again       take hold of the one box under the pointer
 *   drag (unselected) swap it with another tile, on any page
 *   drag (selected)   move the box in hand — the artwork, if none
 *   ⌘/ctrl + wheel    resize the box in hand
 *   double-click      rewrite the text you clicked on, in place
 *   ⌫                 take the box off the page
 *   ⠿ corner grip     swap, also while the tile is selected
 *
 * Every box the tile draws is addressable, not just the artwork: the
 * renderer marks each one with `data-part`, this file hit-tests for it,
 * and both ends agree through `TilePart`. Nothing here knows the name
 * of a single box.
 *
 * Everything it writes is a placement override, so a regeneration does
 * not silently discard it and the PDF prints exactly what is on screen.
 */
export interface TileEditorProps {
  pageId: string;
  slotId: string;
  /** Absent on an empty slot: there is nothing to nudge, only to drop on. */
  offerId?: string;
}

/** `pageId::slotId` — the address of one placement in the document. */
function address(pageId: string, slotId: string): string {
  return `${pageId}::${slotId}`;
}

function parse(value: string): { pageId: string; slotId: string } | null {
  const [pageId, slotId] = value.split('::');
  return pageId && slotId ? { pageId, slotId } : null;
}

const MIME = 'application/x-incitio-slot';

/**
 * The boxes whose words can be rewritten on the page.
 *
 * The headline and the supporting line write the placement's own
 * `displayName`/`description` — they had fields before boxes were
 * movable, and those fields are what the inspector binds to. The rest
 * write the box's own `text`. The price mark and the certification
 * column are absent on purpose: a price is a number the feed is
 * accountable for, and a certification is artwork the chain has
 * contracted for. Neither is a caption to retype.
 */
const REWRITABLE: readonly TilePart[] = [
  'name', 'brand', 'quantity', 'description', 'meta', 'tags',
];

const isPart = (value: string): value is TilePart =>
  (TILE_PARTS as readonly string[]).includes(value);

interface Editing {
  part: TilePart;
  value: string;
  /** Where the text sits, in the overlay's own coordinates. */
  box: Box;
  /** Enough of the printed type to make the input look like the page. */
  type: CSSProperties;
}

interface Box { left: number; top: number; width: number; height: number }

/** One box of the tile, found under the pointer and measured. */
interface Found { part: TilePart; box: Box }

/**
 * The label hangs above its box, unless the box is already at the top
 * of the tile — there it would be drawn off the page and read as
 * missing. Measured rather than guessed from the part's name: the same
 * box sits at the top of a compact tile and halfway down a hero.
 */
function outline(box: Box): string {
  return box.top < 14 ? 'handle__part handle__part--tight' : 'handle__part';
}

const clamp = (value: number, low: number, high: number) =>
  Math.min(high, Math.max(low, value));

interface Bounds { minX: number; maxX: number; minY: number; maxY: number }

/**
 * How far this box can go before it leaves its own cell.
 *
 * The slot clips — deliberately, so nothing a person moves can land on
 * the neighbouring offer — and without this the first drag past the
 * edge simply makes the line disappear. The override is still written,
 * so it is not lost, but "I dragged it and it vanished" is
 * indistinguishable from a broken editor. Fencing the drag at the cell
 * wall says the same thing by letting the box refuse to go further.
 *
 * Derived from where the box is right now, in pixels, then converted
 * into the same units the offsets are stored in. A box wider than its
 * own cell has no room in that axis, and keeps whatever it has.
 */
function withinSlot(
  element: HTMLElement,
  part: TilePart,
  start: { offsetX: number; offsetY: number },
  perX: number,
  perY: number,
  reach: number,
): Bounds | null {
  const slot = element.parentElement?.getBoundingClientRect();
  const target = element.parentElement?.querySelector(`[data-part="${part}"]`);
  if (!slot || !(target instanceof HTMLElement)) return null;
  const here = target.getBoundingClientRect();

  const span = (
    before: number, after: number, per: number, from: number,
  ): [number, number] => {
    // `before` is the room to the left/above, `after` the room to the
    // right/below. Both are already spent travel, so they bracket the
    // offset the box currently carries.
    if (before < 0 || after < 0) return [from, from];
    return [
      Math.max(from - before * per, -reach),
      Math.min(from + after * per, reach),
    ];
  };

  const [minX, maxX] = span(here.left - slot.left, slot.right - here.right, perX, start.offsetX);
  const [minY, maxY] = span(here.top - slot.top, slot.bottom - here.bottom, perY, start.offsetY);
  return { minX, maxX, minY, maxY };
}

/**
 * The artwork's offsets are stored normalised (−1…1) and the renderer
 * turns them into a translate of ±20% of the media box, so a pixel of
 * pointer travel is this much override. Written once here rather than
 * guessed twice.
 */
function offsetPerPixel(size: number): number {
  return size > 0 ? 1 / (size * 0.2) : 0;
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

export function TileEditor({ pageId, slotId, offerId }: TileEditorProps) {
  const swapPlacements = useStudio((s) => s.swapPlacements);
  const updateOverrides = useStudio((s) => s.updateOverrides);
  const updatePart = useStudio((s) => s.updatePart);
  const endGesture = useStudio((s) => s.endGesture);
  const select = useStudio((s) => s.select);
  const selectPart = useStudio((s) => s.selectPart);
  const selected = useStudio((s) => s.selectedOfferId === offerId && offerId !== undefined);
  const selectedPart = useStudio((s) => s.selectedPart);
  const overrides = useStudio((s) => s.document?.pages
    .find((page) => page.id === pageId)
    ?.placements.find((placement) => placement.slotId === slotId)
    ?.overrides);

  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const [over, setOver] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [editing, setEditing] = useState<Editing | null>(null);
  /** The box under the pointer, outlined so it is clear what a click takes. */
  const [hover, setHover] = useState<Found | null>(null);
  /** Where the box in hand currently sits, for the persistent outline. */
  const [marked, setMarked] = useState<Box | null>(null);
  /** Live readout during a move or a resize. Null when the tile is at rest. */
  const [hud, setHud] = useState<string | null>(null);

  /** The box this tile's gestures act on. The artwork, unless told otherwise. */
  const inHand: TilePart = selected ? selectedPart ?? 'media' : 'media';

  /**
   * Find the box under these page coordinates, and measure it.
   *
   * Through `elementsFromPoint` rather than off the event target,
   * because this overlay covers the whole tile — the thing the pointer
   * is really over is always underneath it. Innermost first, so the
   * price mark wins over the artwork box it hangs inside.
   */
  function findPart(clientX: number, clientY: number): Found | null {
    const element = root.current;
    if (!element) return null;

    const hit = document
      .elementsFromPoint(clientX, clientY)
      .find((candidate) => candidate instanceof HTMLElement
        && candidate.dataset['part'] !== undefined
        && element.parentElement?.contains(candidate));

    if (!(hit instanceof HTMLElement)) return null;
    const name = hit.dataset['part'];
    if (name === undefined || !isPart(name)) return null;

    const here = element.getBoundingClientRect();
    const there = hit.getBoundingClientRect();
    return {
      part: name,
      box: {
        left: there.left - here.left,
        top: there.top - here.top,
        width: there.width,
        height: there.height,
      },
    };
  }

  /** Measure the box in hand where it is now. */
  function measure(part: TilePart): Box | null {
    const element = root.current;
    const target = element?.parentElement?.querySelector(`[data-part="${part}"]`);
    if (!element || !(target instanceof HTMLElement)) return null;
    const here = element.getBoundingClientRect();
    const there = target.getBoundingClientRect();
    return {
      left: there.left - here.left,
      top: there.top - here.top,
      width: there.width,
      height: there.height,
    };
  }

  /*
   * The outline follows the box it marks.
   *
   * Measured after every paint that could have moved it — the override
   * changing, the selection changing — because the box is moved by a
   * transform the browser resolves, not by anything this file computes.
   * Re-deriving the rectangle is the only way it stays on the words.
   */
  useLayoutEffect(() => {
    if (!selected || !selectedPart) { setMarked(null); return; }
    setMarked(measure(selectedPart));
  }, [selected, selectedPart, overrides]);

  /*
   * Zoom is a modified wheel, and it has to be a native listener.
   *
   * Native, because React registers `onWheel` on the root as passive,
   * so preventDefault from it is ignored. Modified, because a plain
   * wheel belongs to the page: with a tile selected, scrolling down the
   * catalogue zoomed its artwork instead — which is the behaviour every
   * image editor learned to stop doing. Ctrl/⌘ zooms, and a trackpad
   * pinch arrives as ctrl+wheel, so pinching works without asking.
   */
  useEffect(() => {
    const element = root.current;
    if (!element || !selected || !offerId || !overrides) return undefined;

    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const { minScale, maxScale } = partLimits(inHand);
      const now = partOverride(overrides, inHand).scale;
      const next = clamp(now * Math.exp(-event.deltaY * 0.0015), minScale, maxScale);
      updatePart(offerId, inHand, { scale: next }, `scale:${offerId}:${inHand}`);
      setHud(`${TILE_PART_NAMES[inHand]}  ${next.toFixed(2)}×`);
    };

    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [selected, offerId, overrides, inHand, updatePart]);

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

  /*
   * An inline editor is positioned against a rect measured once. Any
   * reflow invalidates it, and a text box floating half a tile away
   * from its own words is worse than no inline editing at all.
   */
  useEffect(() => {
    if (!editing) return undefined;
    const close = () => setEditing(null);
    window.addEventListener('resize', close);
    return () => window.removeEventListener('resize', close);
  }, [editing !== null]);

  /** Open the in-place editor over the text at these page coordinates. */
  function edit(clientX: number, clientY: number): void {
    const element = root.current;
    if (!element || !offerId || !overrides) return;

    const found = findPart(clientX, clientY);
    /*
     * A double-click somewhere with no words under it means the
     * headline: it is the line people rewrite, and hunting for the
     * words first is busywork. The same fallback catches a
     * double-click on the artwork, or on the gap between two lines.
     */
    const part = found && REWRITABLE.includes(found.part) ? found.part : 'name';
    const target = element.parentElement?.querySelector(`[data-part="${part}"]`);
    if (!(target instanceof HTMLElement)) return;

    const box = measure(part);
    if (!box) return;

    selectPart(part);
    setEditing({
      part,
      value: target.textContent ?? '',
      box,
      type: typeOf(target),
    });
  }

  function commit(value: string): void {
    if (!editing || !offerId) return;
    const text = value.trim();
    if (editing.part === 'name') {
      // An empty headline is not an edit, it is a tile with no name, so
      // clearing it falls back to the feed's wording. An empty support
      // line is a real decision — see PlacementOverrides.description.
      updateOverrides(offerId, { displayName: text || null });
    } else if (editing.part === 'description') {
      updateOverrides(offerId, { description: text });
    } else {
      // Every other box keeps its wording on itself. Empty removes the
      // line rather than printing an empty one; the inspector is where
      // the feed's own wording is fetched back.
      updatePart(offerId, editing.part, { text });
    }
    endGesture();
    setEditing(null);
  }

  /**
   * Move the box in hand. One history entry for the whole drag.
   *
   * Two currencies, because the two kinds of box mean different things
   * by "over there". The artwork moves inside its own frame, so its
   * offsets are fractions of that frame and survive the tile changing
   * size. Every other box moves across the page, so its offsets are
   * percentages of the page — which is what `cqw`/`cqh` spend, and what
   * makes the PDF land them where the screen did.
   */
  function onPointerDown(event: React.PointerEvent<HTMLDivElement>): void {
    if (!selected || !offerId || !overrides || editing) return;
    if (event.button !== 0) return;
    // The grip is for swapping; a drag started on it is not a move.
    if ((event.target as HTMLElement).closest('.handle__grip')) return;

    const element = root.current;
    if (!element) return;

    /*
     * Pressing on a box takes hold of it and starts moving it in the
     * same gesture. Selecting first and dragging second would be a
     * correct two-step that nobody performs: the pointer is already
     * down on the thing they mean.
     */
    const found = findPart(event.clientX, event.clientY);
    const part: TilePart = found?.part ?? inHand;
    if (part !== selectedPart) selectPart(part === 'media' ? null : part);

    const { reach } = partLimits(part);
    const start = partOverride(overrides, part);
    let perX: number;
    let perY: number;
    let bounds: Bounds = { minX: -reach, maxX: reach, minY: -reach, maxY: reach };

    if (part === 'media') {
      // Pan in the media box's units, not the slot's: on a feature tile
      // the artwork is half the width of the cell it sits in. Not
      // fenced in either: panning artwork is cropping it, and a
      // packshot that cannot be pushed past the edge cannot be framed.
      const media = element.parentElement?.querySelector('.tile__media');
      const frame = (media ?? element).getBoundingClientRect();
      perX = offsetPerPixel(frame.width);
      perY = offsetPerPixel(frame.height);
    } else {
      // One percent of the page is one `cqw`. Measured off the page
      // itself so a zoomed-out canvas still moves a box by what the
      // pointer covered, not by what the numbers would be at full size.
      const page = element.closest('.page')?.getBoundingClientRect();
      if (!page || page.width === 0 || page.height === 0) return;
      perX = 100 / page.width;
      perY = 100 / page.height;
      bounds = withinSlot(element, part, start, perX, perY, reach) ?? bounds;
    }

    const from = { x: event.clientX, y: event.clientY };
    let moved = false;

    // Capture keeps the drag alive when the pointer leaves the tile —
    // moving to the edge of a frame means leaving it. Not every
    // pointer can be captured, and failing to is not worth a dead drag.
    try { element.setPointerCapture(event.pointerId); } catch { /* uncapturable */ }

    const onMove = (move: PointerEvent) => {
      const dx = (move.clientX - from.x) * perX;
      const dy = (move.clientY - from.y) * perY;
      if (!moved && Math.abs(move.clientX - from.x) + Math.abs(move.clientY - from.y) < 2) return;
      moved = true;
      const x = clamp(start.offsetX + dx, bounds.minX, bounds.maxX);
      const y = clamp(start.offsetY + dy, bounds.minY, bounds.maxY);
      updatePart(offerId, part, { offsetX: x, offsetY: y }, `move:${offerId}:${part}`);
      const round = (value: number) => (part === 'media' ? value.toFixed(2) : value.toFixed(1));
      setHud(`${TILE_PART_NAMES[part]}  ${x >= 0 ? '+' : '−'}${round(Math.abs(x))}  ${y >= 0 ? '+' : '−'}${round(Math.abs(y))}`);
    };

    const onUp = () => {
      try { element.releasePointerCapture(event.pointerId); } catch { /* never captured */ }
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

  const className = [
    'handle',
    selected && 'handle--armed',
    editing && 'handle--editing',
    over && 'handle--over',
    dragging && 'handle--dragging',
  ].filter(Boolean).join(' ');

  return (
    <div
      ref={root}
      className={className}
      /*
       * Unselected, the whole tile is the drag handle — picking a tile
       * up and dropping it on another is the most common edit. Selected,
       * the surface belongs to the box in hand and only the grip still
       * drags, so the two gestures never have to be told apart mid-drag.
       */
      draggable={!selected && !editing}
      onClick={() => { if (offerId && !selected) select(offerId); }}
      onDoubleClick={(event) => {
        if (!offerId) return;
        if (!selected) select(offerId);
        edit(event.clientX, event.clientY);
      }}
      onPointerDown={onPointerDown}
      /*
       * What a click would take hold of, outlined before it is taken.
       * Only once the tile is selected: on an unselected tile the whole
       * surface is one drag handle, and outlining its parts would
       * advertise an interaction that is not available yet.
       */
      onPointerMove={(event) => {
        if (!selected || editing || event.buttons !== 0) return;
        const found = findPart(event.clientX, event.clientY);
        setHover((was) => (was?.part === found?.part ? was : found));
      }}
      onPointerLeave={() => setHover(null)}
      onDragStart={(event) => {
        setDragging(true);
        event.dataTransfer.setData(MIME, address(pageId, slotId));
        // Some browsers refuse a drag that carries no text/plain.
        event.dataTransfer.setData('text/plain', address(pageId, slotId));
        event.dataTransfer.effectAllowed = 'move';
      }}
      onDragEnd={() => { setDragging(false); setOver(false); }}
      onDragOver={(event) => {
        // Without preventDefault the browser refuses the drop entirely,
        // and the tile just springs back with no explanation.
        if (!event.dataTransfer.types.includes(MIME)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        const from = parse(event.dataTransfer.getData(MIME));
        if (!from) return;
        swapPlacements(from, { pageId, slotId });
      }}
    >
      <span
        className="handle__grip"
        title="Træk for at bytte"
        draggable={selected}
        aria-hidden="true"
      >⠿</span>

      {/* The box a click would take, and the box already in hand. Drawn
          in the overlay rather than as an outline on the tile itself,
          because the tile is the print component and must not learn
          what an editor selection is. */}
      {selected && !editing && hover && hover.part !== selectedPart && (
        <span className={outline(hover.box)} style={hover.box}>
          <b>{TILE_PART_NAMES[hover.part]}</b>
        </span>
      )}
      {selected && !editing && selectedPart && marked && (
        <span className={`${outline(marked)} handle__part--held`} style={marked}>
          <b>{TILE_PART_NAMES[selectedPart]}</b>
        </span>
      )}

      {hud && <span className="handle__hud">{hud}</span>}

      {editing && (
        <textarea
          ref={input}
          className="handle__text"
          value={editing.value}
          style={{
            ...editing.type,
            left: editing.box.left,
            top: editing.box.top,
            width: editing.box.width,
            height: editing.box.height,
          }}
          onChange={(event) => setEditing({ ...editing, value: event.target.value })}
          onBlur={(event) => commit(event.target.value)}
          onPointerDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === 'Escape') { setEditing(null); return; }
            // Enter commits; the tile's own lines wrap on their own and
            // a hard newline in a headline is never what was meant.
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
