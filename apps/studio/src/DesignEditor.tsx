import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  LAYER_TYPES, OFFER_TYPES,
  type DesignLayer, type DesignParagraph, type LayerType, type Offer, type OfferDesign, type OfferType,
} from '@incitio/schema';
import { incitoVars, pricePieces, renderLiquid } from '@incitio/renderer';
import { EDITOR_PX, useStudio } from './state.js';
import { PxFields } from './Measure.js';
import type { Box } from './box.js';
import { addLayer, removeLayer } from './design-new.js';
import { PriceStyleFields, isPriceParagraph, postfixOf, withPostfix } from './PriceStyleFields.js';
import { LAYER_WORDS, Preview, TYPE_WORDS, layerWord, round } from './design-parts.js';
import {
  align, bounds, caught, cloneLayers, distribute, emptyHistory, moveLayers, placeLayers, record, rectOf, redo, restack,
  snapMove, snapResize, undo,
  type Align, type Guide, type Handle, type History, type Rect,
} from './design-edit.js';

/**
 * The design editor — one offer design, drawn and pushed around the way
 * a drawing program does it.
 *
 * Pick a field and drag it; its edges and middle catch the cell's and
 * the other fields' (⌘ held lets go). Eight handles resize, shift keeps
 * the proportions. Shift-click or drag a box to take several; ⌥-drag
 * drags a copy. ⌘Z / ⌘⇧Z take whole gestures back and forth, ⌘C ⌘V ⌘D
 * copy, paste and duplicate, ⌘[ ⌘] restack, the arrows nudge a pixel.
 *
 * A gesture is drawn as a draft and saved once, when it ends — the
 * chain's designs are saved for every avis, and a drag is one change,
 * not a hundred.
 */

/* ---------------------------------------------------------- the cell */

/**
 * The size a design is measured at, in the publication's pixels.
 *
 * A design's fields are shares of the offer's cell — the same design is
 * drawn in a big cell and a small one — so a pixel is only a pixel at a
 * stated cell size. This is that size, kept per chain on this machine.
 * It changes what the numbers say, never the design.
 */
const CELL_DEFAULT = { w: 300, h: 300 };
function useCellSize(brandId: string | null): [{ w: number; h: number }, (cell: { w: number; h: number }) => void] {
  const key = `incitio.designCell.${brandId ?? ''}`;
  const [cell, setCell] = useState<{ w: number; h: number }>(() => {
    try {
      const stored = JSON.parse(window.localStorage.getItem(key) ?? 'null') as { w?: number; h?: number } | null;
      if (stored && stored.w && stored.h && stored.w > 0 && stored.h > 0) return { w: stored.w, h: stored.h };
    } catch { /* private window */ }
    return CELL_DEFAULT;
  });
  const remember = (next: { w: number; h: number }) => {
    setCell(next);
    try { window.localStorage.setItem(key, JSON.stringify(next)); } catch { /* private window */ }
  };
  return [cell, remember];
}

/** A switch kept on this machine: snapping, the grid. */
function useToggle(key: string, initial: boolean): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(() => {
    try { const v = window.localStorage.getItem(key); return v === null ? initial : v === '1'; } catch { return initial; }
  });
  return [on, (next) => { setOn(next); try { window.localStorage.setItem(key, next ? '1' : '0'); } catch { /* fine */ } }];
}

const layerBox = (l: Rect, cell: { w: number; h: number }): Box => ({
  x: l.x1 * cell.w, y: l.y1 * cell.h, w: (l.x2 - l.x1) * cell.w, h: (l.y2 - l.y1) * cell.h,
});
const boxRect = (box: Box, cell: { w: number; h: number }): Rect => ({
  x1: round(box.x / cell.w), x2: round((box.x + box.w) / cell.w),
  y1: round(box.y / cell.h), y2: round((box.y + box.h) / cell.h),
});

/** What ⌘C holds: fields, between designs too. */
let clipboard: DesignLayer[] = [];

const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const GRID_PX = 10;
const ZOOMS = [0.5, 0.75, 1, 1.5, 2, 3];

type Gesture =
  | { kind: 'move'; ids: string[]; x: number; y: number; start: OfferDesign; axisLock: boolean }
  | { kind: 'resize'; id: string; handle: Handle; x: number; y: number; start: OfferDesign }
  | { kind: 'marquee'; x: number; y: number; add: string[] };

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const mod = (event: { metaKey: boolean; ctrlKey: boolean }) => (isMac ? event.metaKey : event.ctrlKey);

export function DesignEditor({
  design, examples, example, onExample, onChange, onBack,
}: {
  design: OfferDesign; examples: Offer[]; example: Offer | null;
  onExample: (id: string) => void; onChange: (design: OfferDesign) => void; onBack: () => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const [draft, setDraft] = useState<OfferDesign | null>(null);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [marquee, setMarquee] = useState<Rect | null>(null);
  const [zoom, setZoom] = useState(1);
  const [snapOn, setSnapOn] = useToggle('incitio.design.snap', true);
  const [gridOn, setGridOn] = useToggle('incitio.design.grid', false);
  const [cell, setCell] = useCellSize(useStudio((s) => s.brandId));
  const [cellDraft, setCellDraft] = useState<{ w?: string; h?: string }>({});
  const [history, setHistory] = useState<History>(emptyHistory);
  const stage = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);

  const shown = draft ?? design;
  // A price to try the design with — 19,95 and 45,- set differently — without touching the product.
  const [testPrice, setTestPrice] = useState<number | null>(null);
  const shownOffer = example && testPrice !== null ? { ...example, price: testPrice, priceFrom: false } : example;
  const brand = useStudio((s) => s.brand);
  const setOfferDesigns = useStudio((s) => s.setOfferDesigns);
  const pricesInChain = (brand?.offerDesigns ?? []).reduce(
    (n, d) => n + d.layers.reduce((m, l) => m + l.paragraphs.filter((p) => isPriceParagraph(p, examples)).length, 0), 0);
  /*
   * One price style for the whole chain: what this paragraph says about
   * the figure goes onto every price paragraph in every design. Its size,
   * colour and place stay each design's own.
   */
  const applyEverywhere = (from: DesignParagraph) => {
    if (!brand) return;
    if (!window.confirm(`Brug denne pris-stil på alle ${pricesInChain} priser i kædens ${brand.offerDesigns.length} designs?`)) return;
    const postfix = postfixOf(from.text_content);
    const next = brand.offerDesigns.map((d) => (d.id === design.id ? design : d)).map((d) => ({
      ...d,
      layers: d.layers.map((l) => ({
        ...l,
        paragraphs: l.paragraphs.map((p) => (isPriceParagraph(p, examples) ? {
          ...p,
          text_content: /format_price/.test(p.text_content) ? withPostfix(p.text_content, postfix) : p.text_content,
          text_weight: from.text_weight,
          text_letter_spacing: from.text_letter_spacing ?? null,
          incito_price: from.incito_price,
        } : p)),
      })),
    }));
    setOfferDesigns(next, brand.designTag);
  };
  /*
   * The price itself, not just any paragraph that could print one: what
   * prints a figure for the product on show first, then what names the
   * price outright, a saving or a percentage last.
   */
  const toPrice = () => {
    const score = (p: DesignParagraph) => {
      if (!isPriceParagraph(p, examples)) return 0;
      // A paragraph the design has switched off is the last place to look.
      const off = p.is_hidden ? -2 : 0;
      if (shownOffer && pricePieces(renderLiquid(p.text_content, incitoVars(shownOffer)))) return 4 + off;
      return (/format_price|offerPrice/.test(p.text_content) ? 3 : 2) + off;
    };
    const best = design.layers
      .map((l) => ({ l, n: Math.max(0, ...l.paragraphs.map(score)) }))
      .sort((a, b) => b.n - a.n)[0];
    if (best && best.n > 0) setPicked([String(best.l.id)]);
  };
  const pickedSet = useMemo(() => new Set(picked), [picked]);
  const pickedLayers = shown.layers.filter((l) => pickedSet.has(String(l.id)));
  const single = pickedLayers.length === 1 ? pickedLayers[0]! : null;

  // A different design opened: its own history, nothing picked.
  useEffect(() => { setHistory(emptyHistory()); setPicked([]); setDraft(null); }, [design.id]);

  /* ------------------------------------------------ changing, undoably */

  // Read through refs inside the key handler, which binds once.
  const live = useRef({ design, history, picked });
  live.current = { design, history, picked };

  const commit = useCallback((next: OfferDesign, key: string | null = null, before?: OfferDesign) => {
    const { design: current, history: h } = live.current;
    setHistory(record(h, before ?? current, key));
    setDraft(null);
    onChange(next);
  }, [onChange]);

  const stepBack = useCallback(() => {
    const { design: current, history: h } = live.current;
    const back = undo(h, current);
    if (!back) return;
    setHistory(back.history);
    setDraft(null);
    onChange(back.design);
    setPicked((ids) => ids.filter((id) => back.design.layers.some((l) => String(l.id) === id)));
  }, [onChange]);

  const stepForward = useCallback(() => {
    const { design: current, history: h } = live.current;
    const fwd = redo(h, current);
    if (!fwd) return;
    setHistory(fwd.history);
    setDraft(null);
    onChange(fwd.design);
  }, [onChange]);

  const setLayer = (id: string, patch: Partial<DesignLayer>, key: string | null = null) => commit({
    ...design, layers: design.layers.map((l) => (String(l.id) === id ? { ...l, ...patch } : l)),
  }, key);
  const setParagraph = (id: string, pid: string, patch: Partial<DesignParagraph>, key: string | null) => {
    const target = design.layers.find((l) => String(l.id) === id);
    if (!target) return;
    setLayer(id, { paragraphs: target.paragraphs.map((p) => (p.id === pid ? { ...p, ...patch } : p)) }, key);
  };

  const arrange = (how: Align) => {
    const rects = align(pickedLayers.map(rectOf), how);
    commit(placeLayers(design, new Map(pickedLayers.map((l, i) => [String(l.id), rects[i]!]))));
  };
  const spread = (axis: 'x' | 'y') => {
    const rects = distribute(pickedLayers.map(rectOf), axis);
    commit(placeLayers(design, new Map(pickedLayers.map((l, i) => [String(l.id), rects[i]!]))));
  };
  const remove = (ids: string[]) => {
    if (ids.length === 0) return;
    commit(ids.reduce((d, id) => removeLayer(d, id), design));
    setPicked([]);
  };
  const duplicate = (layers: DesignLayer[], shift = true) => {
    if (layers.length === 0) return;
    const by = shift ? { x: GRID_PX / cell.w, y: GRID_PX / cell.h } : { x: 0, y: 0 };
    const { design: next, ids } = cloneLayers(live.current.design, layers, by);
    commit(next);
    setPicked(ids);
  };

  /* --------------------------------------------------- the keyboard */

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
        || target instanceof HTMLSelectElement || target?.isContentEditable === true;
      if (typing) return;
      const { design: d, picked: ids } = live.current;
      const layers = d.layers.filter((l) => ids.includes(String(l.id)));
      const key = event.key.toLowerCase();
      const take = () => { event.preventDefault(); event.stopPropagation(); };

      if (mod(event) && key === 'z') { take(); if (event.shiftKey) stepForward(); else stepBack(); return; }
      if (mod(event) && key === 'y') { take(); stepForward(); return; }
      if (mod(event) && key === 'a') { take(); setPicked(d.layers.map((l) => String(l.id))); return; }
      if (mod(event) && key === 'c' && layers.length) { take(); clipboard = structuredClone(layers); return; }
      if (mod(event) && key === 'x' && layers.length) { take(); clipboard = structuredClone(layers); remove(ids); return; }
      if (mod(event) && key === 'v' && clipboard.length) { take(); duplicate(clipboard); return; }
      if (mod(event) && key === 'd' && layers.length) { take(); duplicate(layers); return; }
      if (mod(event) && (key === ']' || key === '[') && layers.length) {
        take();
        commit(restack(d, ids, key === ']' ? 'forward' : 'backward', event.shiftKey));
        return;
      }
      if (mod(event) && (key === '=' || key === '+')) { take(); setZoom((z) => ZOOMS.find((v) => v > z) ?? z); return; }
      if (mod(event) && key === '-') { take(); setZoom((z) => [...ZOOMS].reverse().find((v) => v < z) ?? z); return; }
      if (mod(event) && key === '0') { take(); setZoom(1); return; }
      if ((key === 'delete' || key === 'backspace') && layers.length) { take(); remove(ids); return; }
      if (key === 'escape' && ids.length) { take(); setPicked([]); return; }
      if (key === 'tab' && d.layers.length) {
        take();
        const at = d.layers.findIndex((l) => String(l.id) === ids[ids.length - 1]);
        const next = d.layers[(at + (event.shiftKey ? -1 : 1) + d.layers.length) % d.layers.length]!;
        setPicked([String(next.id)]);
        return;
      }
      const arrows: Record<string, [number, number]> = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] };
      if (arrows[key] && layers.length) {
        take();
        const step = event.shiftKey ? 10 : 1;
        const [x, y] = arrows[key]!;
        commit(moveLayers(d, ids, (x * step) / cell.w, (y * step) / cell.h), 'nudge');
      }
    };
    // Captured before the studio's own keys: here ⌘Z is the design's, not the avis's.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [stepBack, stepForward, commit, cell.w, cell.h]);

  /* ---------------------------------------------------- the pointer */

  // A pointer the browser no longer tracks cannot be captured; the drag still works without.
  const capture = (pointerId: number) => { try { stage.current?.setPointerCapture(pointerId); } catch { /* fine */ } };
  const toShare = (event: { clientX: number; clientY: number }) => {
    const box = stage.current!.getBoundingClientRect();
    return { x: (event.clientX - box.left) / box.width, y: (event.clientY - box.top) / box.height, box };
  };
  const snapOptions = (box: DOMRect, event: { metaKey: boolean; ctrlKey: boolean }) => ({
    threshold: { x: 6 / box.width, y: 6 / box.height },
    grid: gridOn ? GRID_PX / cell.w : null,
    off: !snapOn || mod(event),
  });
  // Whole pixels of the cell, so where a drag lands is a number the fields can say.
  const px = (dx: number, dy: number) => ({ dx: Math.round(dx * cell.w) / cell.w, dy: Math.round(dy * cell.h) / cell.h });

  const downOnField = (event: ReactPointerEvent, layer: DesignLayer) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    stage.current?.focus();
    const id = String(layer.id);
    let ids = picked.includes(id) ? picked : [id];
    if (event.shiftKey) {
      ids = picked.includes(id) ? picked.filter((p) => p !== id) : [...picked, id];
      setPicked(ids);
      return;
    }
    setPicked(ids);
    let start = design;
    // ⌥-drag: a copy goes with the pointer, the original stays.
    if (event.altKey) {
      const { design: copied, ids: copies } = cloneLayers(design, design.layers.filter((l) => ids.includes(String(l.id))), { x: 0, y: 0 });
      start = copied;
      ids = copies;
      setPicked(copies);
      setDraft(copied);
    }
    const at = toShare(event);
    gesture.current = { kind: 'move', ids, x: at.x, y: at.y, start, axisLock: false };
    capture(event.pointerId);
  };

  const downOnHandle = (event: ReactPointerEvent, layer: DesignLayer, handle: Handle) => {
    event.preventDefault();
    event.stopPropagation();
    const at = toShare(event);
    gesture.current = { kind: 'resize', id: String(layer.id), handle, x: at.x, y: at.y, start: design };
    capture(event.pointerId);
  };

  const downOnStage = (event: ReactPointerEvent) => {
    if (event.button !== 0) return;
    stage.current?.focus();
    const at = toShare(event);
    const add = event.shiftKey ? picked : [];
    if (!event.shiftKey) setPicked([]);
    gesture.current = { kind: 'marquee', x: at.x, y: at.y, add };
    capture(event.pointerId);
  };

  const move = (event: ReactPointerEvent) => {
    const g = gesture.current;
    if (!g || !stage.current) return;
    const at = toShare(event);
    const options = snapOptions(at.box, event);
    if (g.kind === 'marquee') {
      const box = { x1: Math.min(g.x, at.x), y1: Math.min(g.y, at.y), x2: Math.max(g.x, at.x), y2: Math.max(g.y, at.y) };
      setMarquee(box);
      setPicked([...new Set([...g.add, ...caught(design, box)])]);
      return;
    }
    let { dx, dy } = px(at.x - g.x, at.y - g.y);
    if (g.kind === 'move') {
      // Shift: along one axis only, whichever the pointer has gone further along.
      if (event.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      const moving = g.start.layers.filter((l) => g.ids.includes(String(l.id)));
      const others = g.start.layers.filter((l) => !g.ids.includes(String(l.id)) && !l.is_hidden).map(rectOf);
      const snapped = snapMove(bounds(moving.map(rectOf)), dx, dy, others, options);
      const fx = event.shiftKey && dx === 0 ? 0 : snapped.dx;
      const fy = event.shiftKey && dy === 0 ? 0 : snapped.dy;
      setGuides(snapped.guides);
      setDraft(moveLayers(g.start, g.ids, fx, fy));
    } else {
      const layer = g.start.layers.find((l) => String(l.id) === g.id);
      if (!layer) return;
      const others = g.start.layers.filter((l) => String(l.id) !== g.id && !l.is_hidden).map(rectOf);
      const { rect, guides: lines } = snapResize(rectOf(layer), g.handle, dx, dy, others, {
        ...options, keepRatio: event.shiftKey, min: { x: 2 / cell.w, y: 2 / cell.h },
      });
      setGuides(lines);
      setDraft(placeLayers(g.start, new Map([[g.id, rect]])));
    }
  };

  const up = () => {
    const g = gesture.current;
    gesture.current = null;
    setGuides([]);
    setMarquee(null);
    if (!g || g.kind === 'marquee') return;
    // One step for the whole drag — against the design as it was before it (an ⌥-copy included).
    if (draft && JSON.stringify(draft.layers) !== JSON.stringify(design.layers)) commit(draft, null, design);
    else setDraft(null);
  };

  /* ------------------------------------------------------- drawing */

  const sel = pickedLayers.length > 1 ? bounds(pickedLayers.map(rectOf)) : null;
  const info = single ? layerBox(rectOf(single), cell) : sel ? layerBox(sel, cell) : null;
  const gridStyle = gridOn
    ? { backgroundSize: `${(GRID_PX / cell.w) * 100}% ${(GRID_PX / cell.h) * 100}%` }
    : undefined;

  return (
    <div className="deditor">
      <div className="deditor__left">
        <div className="deditor__top">
          <button className="thin" onClick={onBack}>‹ Alle designs</button>
          <button className="thin pricestyle__go" onClick={toPrice} disabled={!design.layers.some((l) => l.paragraphs.some((p) => isPriceParagraph(p, examples)))}
            title="Vælg prisen og vis hvordan den sættes">Prisens udseende</button>
          <label className="designs__example">
            Vis med
            <select value={example?.id ?? ''} onChange={(e) => onExample(e.target.value)}>
              {examples.map((o) => <option key={o.id} value={o.id}>{o.name}{o.imageUrl ? '' : ' (uden billede)'}</option>)}
            </select>
          </label>
        </div>

        <div className="dtools" role="toolbar" aria-label="Værktøjer">
          <div className="dtools__group">
            <button onClick={stepBack} disabled={history.past.length === 0} title="Fortryd (⌘Z)" aria-label="Fortryd"><Icon d="M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3" /></button>
            <button onClick={stepForward} disabled={history.future.length === 0} title="Gentag (⌘⇧Z)" aria-label="Gentag"><Icon d="m15 14 5-5-5-5M20 9H9a5 5 0 0 0 0 10h3" /></button>
          </div>
          <div className="dtools__group">
            <button className={snapOn ? 'is-on' : ''} aria-pressed={snapOn} onClick={() => setSnapOn(!snapOn)} title="Fastgør til kanter og midter (hold ⌘ for at slippe)">
              <Icon d="M4 4v6a8 8 0 0 0 16 0V4M4 4h4v6M20 4h-4v6" /> Fastgør
            </button>
            <button className={gridOn ? 'is-on' : ''} aria-pressed={gridOn} onClick={() => setGridOn(!gridOn)} title={`Gitter hver ${GRID_PX} px`}>
              <Icon d="M4 4h16v16H4zM4 10h16M4 15h16M10 4v16M15 4v16" /> Gitter
            </button>
          </div>
          <div className="dtools__group" aria-label="Justér">
            {([
              ['left', 'Venstre kant', 'M4 3v18M8 7h10v4H8zM8 14h6v4H8z'],
              ['hcenter', 'Midt vandret', 'M12 3v18M6 7h12v4H6zM8 14h8v4H8z'],
              ['right', 'Højre kant', 'M20 3v18M6 7h10v4H6zM10 14h6v4h-6z'],
              ['top', 'Top', 'M3 4h18M7 8h4v10H7zM14 8h4v6h-4z'],
              ['vcenter', 'Midt lodret', 'M3 12h18M7 6h4v12H7zM14 8h4v8h-4z'],
              ['bottom', 'Bund', 'M3 20h18M7 6h4v10H7zM14 10h4v6h-4z'],
            ] as [Align, string, string][]).map(([how, said, d]) => (
              <button key={how} disabled={pickedLayers.length === 0} onClick={() => arrange(how)}
                title={`${said} — ${pickedLayers.length > 1 ? 'mod markeringen' : 'mod feltet'}`} aria-label={said}>
                <Icon d={d} />
              </button>
            ))}
            <button disabled={pickedLayers.length < 3} onClick={() => spread('x')} title="Fordel vandret" aria-label="Fordel vandret"><Icon d="M4 4v16M20 4v16M10 8h4v8h-4z" /></button>
            <button disabled={pickedLayers.length < 3} onClick={() => spread('y')} title="Fordel lodret" aria-label="Fordel lodret"><Icon d="M4 4h16M4 20h16M8 10h8v4H8z" /></button>
          </div>
          <div className="dtools__group">
            <button disabled={pickedLayers.length === 0} onClick={() => commit(restack(design, picked, 'forward'))} title="Frem (⌘]) — ⌘⇧] helt frem" aria-label="Frem"><Icon d="M8 8h12v12H8zM4 4h12v4M4 4v12h4" /></button>
            <button disabled={pickedLayers.length === 0} onClick={() => commit(restack(design, picked, 'backward'))} title="Tilbage (⌘[) — ⌘⇧[ helt tilbage" aria-label="Tilbage"><Icon d="M4 4h12v12H4zM20 8v12H8v-4" /></button>
            <button disabled={pickedLayers.length === 0} onClick={() => duplicate(pickedLayers)} title="Dupliker (⌘D)" aria-label="Dupliker"><Icon d="M8 8h12v12H8zM4 16V4h12" /></button>
            <button disabled={pickedLayers.length === 0} onClick={() => remove(picked)} title="Slet (⌫)" aria-label="Slet"><Icon d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></button>
          </div>
          <div className="dtools__group dtools__zoom">
            <button onClick={() => setZoom((z) => [...ZOOMS].reverse().find((v) => v < z) ?? z)} disabled={zoom <= ZOOMS[0]!} title="Zoom ud (⌘−)" aria-label="Zoom ud">−</button>
            <button onClick={() => setZoom(1)} title="Tilpas (⌘0)" className="dtools__pct">{Math.round(zoom * 100)} %</button>
            <button onClick={() => setZoom((z) => ZOOMS.find((v) => v > z) ?? z)} disabled={zoom >= ZOOMS[ZOOMS.length - 1]!} title="Zoom ind (⌘+)" aria-label="Zoom ind">+</button>
          </div>
        </div>

        <div className="deditor__viewport">
          <div
            className={`deditor__stage${gridOn ? ' has-grid' : ''}`} ref={stage} tabIndex={0}
            style={{ width: `${zoom * 100}%` }}
            onPointerMove={move} onPointerUp={up} onPointerCancel={up} onPointerDown={downOnStage}
          >
            <Preview design={shown} offer={shownOffer} px={EDITOR_PX * Math.max(1, zoom)} aspect={cell.w / cell.h} />
            {gridOn && <div className="deditor__grid" style={gridStyle} />}
            <div className="deditor__boxes">
              {[...shown.layers].reverse().map((l) => {
                const id = String(l.id);
                const on = pickedSet.has(id);
                return (
                  <div
                    key={id}
                    className={`deditor__box${on ? ' is-picked' : ''}${l.is_hidden ? ' is-hidden' : ''}`}
                    style={{ left: `${l.x1 * 100}%`, top: `${l.y1 * 100}%`, width: `${(l.x2 - l.x1) * 100}%`, height: `${(l.y2 - l.y1) * 100}%` }}
                    onPointerDown={(e) => downOnField(e, l)}
                    title={`${layerWord(l)} — træk for at flytte · ⌥-træk kopierer`}
                  >
                    {on && single && <span className="deditor__label">{layerWord(l)}</span>}
                    {on && single && HANDLES.map((h) => (
                      <span key={h} className={`deditor__handle deditor__handle--${h}`} onPointerDown={(e) => downOnHandle(e, l, h)} />
                    ))}
                  </div>
                );
              })}
              {sel && (
                <div className="deditor__sel" style={{ left: `${sel.x1 * 100}%`, top: `${sel.y1 * 100}%`, width: `${(sel.x2 - sel.x1) * 100}%`, height: `${(sel.y2 - sel.y1) * 100}%` }} />
              )}
              {guides.map((g, n) => (
                <div
                  key={n}
                  className={`deditor__guide deditor__guide--${g.axis}`}
                  style={g.axis === 'x'
                    ? { left: `${g.at * 100}%`, top: `${g.from * 100}%`, height: `${(g.to - g.from) * 100}%` }
                    : { top: `${g.at * 100}%`, left: `${g.from * 100}%`, width: `${(g.to - g.from) * 100}%` }}
                />
              ))}
              {marquee && (
                <div className="deditor__marquee" style={{ left: `${marquee.x1 * 100}%`, top: `${marquee.y1 * 100}%`, width: `${(marquee.x2 - marquee.x1) * 100}%`, height: `${(marquee.y2 - marquee.y1) * 100}%` }} />
              )}
            </div>
          </div>
        </div>

        <p className="deditor__status">
          {info
            ? <>
              <b>{single ? layerWord(single) : `${pickedLayers.length} felter`}</b>
              <span>X {Math.round(info.x)}</span><span>Y {Math.round(info.y)}</span>
              <span>B {Math.round(info.w)}</span><span>H {Math.round(info.h)}</span><span>px</span>
            </>
            : <span>Klik et felt, eller træk en ramme om flere. ⌥-træk kopierer · shift holder retningen · ⌘ slipper fastgørelsen</span>}
        </p>

        <div className="deditor__cell">
          <span>Feltet måles som</span>
          {(['w', 'h'] as const).map((side, index) => (
            <span key={side} className="deditor__cellside">
              {index > 0 && <b>×</b>}
              <input
                inputMode="numeric"
                aria-label={side === 'w' ? 'Feltets bredde' : 'Feltets højde'}
                value={cellDraft[side] ?? String(cell[side])}
                onChange={(e) => setCellDraft((d) => ({ ...d, [side]: e.target.value }))}
                onBlur={(e) => {
                  const value = Math.round(Number(e.target.value));
                  if (value >= 20 && value <= 2000) setCell({ ...cell, [side]: value });
                  setCellDraft((d) => ({ ...d, [side]: undefined }));
                }}
                onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
              />
            </span>
          ))}
          <span>px</span>
          <small>den størrelse varen får på siden — fx 300 × 300 for to pr. række på en side der er 600 bred</small>
        </div>
      </div>

      <div className="deditor__right">
        <label className="deditor__field">
          <span>Navn / tag <i>— designs med samme tag bruges på skift</i></span>
          <input value={design.tag} onChange={(e) => commit({ ...design, tag: e.target.value || design.tag }, 'tag')} />
        </label>
        <div className="deditor__row">
          <label className="deditor__field">
            <span>Bruges til</span>
            <select value={design.offer_priority ?? 'b'} onChange={(e) => commit({ ...design, offer_priority: e.target.value as 'a' | 'b' })}>
              <option value="a">A-varer (sidens hovedvarer)</option>
              <option value="b">B-varer (de øvrige)</option>
            </select>
          </label>
          <label className="deditor__field">
            <span>Kun til pristype</span>
            <select value={design.offer_type ?? ''} onChange={(e) => commit({ ...design, offer_type: (e.target.value || null) as OfferType | null })}>
              <option value="">Alle</option>
              {OFFER_TYPES.map((t) => <option key={t} value={t}>{TYPE_WORDS[t]}</option>)}
            </select>
          </label>
        </div>

        <div className="deditor__layershead">
          <h3>Lag</h3>
          <select
            className="deditor__add"
            value=""
            aria-label="Tilføj et felt"
            onChange={(e) => {
              const type = e.target.value as LayerType;
              if (!type) return;
              const { design: next, layer: added } = addLayer(design, type);
              commit(next);
              setPicked([String(added.id)]);
            }}
          >
            <option value="">+ Tilføj felt</option>
            {LAYER_TYPES.map((type) => <option key={type} value={type}>{LAYER_WORDS[type] ?? type}</option>)}
          </select>
        </div>
        {design.layers.length === 0 && <p className="deditor__hint">Designet har ingen felter. Tilføj et billede, en tekst og en pris.</p>}
        <ol className="deditor__layers">
          {shown.layers.map((l) => {
            const id = String(l.id);
            return (
              <li key={id} className={pickedSet.has(id) ? 'is-picked' : ''}>
                <button
                  className="deditor__layer"
                  onClick={(e) => setPicked(e.shiftKey || mod(e)
                    ? (pickedSet.has(id) ? picked.filter((p) => p !== id) : [...picked, id])
                    : [id])}
                  title="Klik vælger · shift-klik tilføjer"
                >{layerWord(l)}{l.name && l.type ? <small> · {l.name}</small> : null}</button>
                <button className="quiet" title="Frem" aria-label="Frem" onClick={() => commit(restack(design, [id], 'forward'))}>↑</button>
                <button className="quiet" title="Tilbage" aria-label="Tilbage" onClick={() => commit(restack(design, [id], 'backward'))}>↓</button>
                <button className="quiet" title={l.is_hidden ? 'Vis feltet' : 'Skjul feltet'} onClick={() => setLayer(id, { is_hidden: !l.is_hidden })}>
                  {l.is_hidden ? '◌' : '●'}
                </button>
              </li>
            );
          })}
        </ol>

        {pickedLayers.length > 1 && (
          <section className="deditor__props">
            <div className="deditor__layershead">
              <h3>{pickedLayers.length} felter valgt</h3>
              <button className="thin" onClick={() => remove(picked)}>Slet</button>
            </div>
            <p className="deditor__hint">Justér dem med knapperne over feltet, eller flyt dem samlet med musen og piletasterne.</p>
          </section>
        )}

        {single && (
          <section className="deditor__props">
            <div className="deditor__layershead">
              <h3>{layerWord(single)}</h3>
              <button className="thin" onClick={() => remove([String(single.id)])} title="Fjern feltet fra designet">Slet felt</button>
            </div>
            <PxFields
              key={String(single.id)}
              box={layerBox(rectOf(single), cell)}
              frame={cell}
              frameSaid="feltet"
              free
              unlocked
              onBox={(box) => commit(placeLayers(design, new Map([[String(single.id), boxRect(box, cell)]])), `box:${single.id}`)}
            />
            <div className="deditor__row">
              <label className="deditor__field">
                <span>Baggrund</span>
                <span className="deditor__color">
                  <input type="color" value={toHex(single.bg_color)} onChange={(e) => setLayer(String(single.id), { bg_color: toRgb(e.target.value) }, `bg:${single.id}`)} aria-label="Vælg baggrundsfarve" />
                  <input value={single.bg_color ?? ''} placeholder="rgb(209,3,12)" onChange={(e) => setLayer(String(single.id), { bg_color: e.target.value || null }, `bg:${single.id}`)} />
                </span>
              </label>
              <label className="deditor__field">
                <span>Hjørner</span>
                <input value={String(single.border_radius ?? '')} placeholder="100%" onChange={(e) => setLayer(String(single.id), { border_radius: e.target.value || null }, `r:${single.id}`)} />
              </label>
            </div>
            {/* The CMS counts opacity 0–100, as the renderer reads it; fully opaque is no value at all. */}
            <label className="deditor__field">
              <span>Synlighed <i>{Math.round(single.opacity ?? 100)} %</i></span>
              <input type="range" min={0} max={100} step={5} value={single.opacity ?? 100}
                onChange={(e) => {
                  const value = Number(e.target.value);
                  const { opacity: _gone, ...rest } = single;
                  if (value >= 100) commit(placeLayerAs(design, rest as DesignLayer), `op:${single.id}`);
                  else setLayer(String(single.id), { opacity: value }, `op:${single.id}`);
                }} />
            </label>
            {single.bg_image_url?.signed && (
              <p className="deditor__art"><img src={single.bg_image_url.signed} alt="" /> Kædens grafik i feltet</p>
            )}
            {single.paragraphs.map((p) => (
              <div key={p.id} className={`deditor__para${p.is_hidden ? ' is-hidden' : ''}`}>
                <textarea
                  value={p.text_content}
                  rows={Math.min(6, Math.max(1, p.text_content.split('\n').length))}
                  onChange={(e) => setParagraph(String(single.id), p.id, { text_content: e.target.value }, `t:${p.id}`)}
                  title="Liquid som i CMS’et: {{offerName}}, {% if offerSavings %}…{% endif %}"
                />
                <div className="deditor__row deditor__row--small">
                  <label>Str. <input type="number" value={p.text_size ?? p.text_max_size ?? ''} onChange={(e) => setParagraph(String(single.id), p.id, p.text_max_size ? { text_max_size: Number(e.target.value) || null } : { text_size: Number(e.target.value) || null }, `s:${p.id}`)} /></label>
                  <label className="deditor__color">Farve
                    <input type="color" value={toHex(p.text_color)} onChange={(e) => setParagraph(String(single.id), p.id, { text_color: toRgb(e.target.value) }, `c:${p.id}`)} aria-label="Vælg tekstfarve" />
                    <input value={p.text_color ?? ''} onChange={(e) => setParagraph(String(single.id), p.id, { text_color: e.target.value || null }, `c:${p.id}`)} />
                  </label>
                  <span className="seg deditor__align" role="group" aria-label="Justering">
                    {(['left', 'center', 'right'] as const).map((a) => (
                      <button key={a} className={(p.text_align ?? 'left') === a ? 'is-on' : ''} onClick={() => setParagraph(String(single.id), p.id, { text_align: a }, null)}
                        aria-label={{ left: 'Venstre', center: 'Midt', right: 'Højre' }[a]}>
                        {{ left: '⇤', center: '↔', right: '⇥' }[a]}
                      </button>
                    ))}
                  </span>
                  <label>
                    <input type="checkbox" checked={p.text_weight === 'bold'} onChange={(e) => setParagraph(String(single.id), p.id, { text_weight: e.target.checked ? 'bold' : 'normal' }, null)} /> Fed
                  </label>
                  <label>
                    <input type="checkbox" checked={!p.is_hidden} onChange={(e) => setParagraph(String(single.id), p.id, { is_hidden: !e.target.checked }, null)} /> Vis
                  </label>
                </div>
                {isPriceParagraph(p, examples) && (
                  <PriceStyleFields
                    p={p}
                    onChange={(patch, key) => setParagraph(String(single.id), p.id, patch, key)}
                    testPrice={testPrice}
                    onTestPrice={setTestPrice}
                    count={pricesInChain}
                    onAll={() => applyEverywhere(p)}
                  />
                )}
              </div>
            ))}
          </section>
        )}
      </div>
    </div>
  );
}

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

/** A colour as the picker wants it: "#rrggbb". The CMS writes rgb(); either is read. */
function toHex(color: string | null | undefined): string {
  if (!color) return '#000000';
  if (/^#[0-9a-f]{6}$/i.test(color)) return color;
  const rgb = /rgba?\(\s*(\d+)\D+(\d+)\D+(\d+)/i.exec(color);
  if (!rgb) return '#000000';
  return `#${rgb.slice(1, 4).map((v) => Math.min(255, Number(v)).toString(16).padStart(2, '0')).join('')}`;
}

/** Back to the CMS's own way of writing a colour. */
function toRgb(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255})`;
}

/** A layer replaced whole — for taking a key off it, which a patch cannot. */
function placeLayerAs(design: OfferDesign, layer: DesignLayer): OfferDesign {
  return { ...design, layers: design.layers.map((l) => (String(l.id) === String(layer.id) ? layer : l)) };
}
