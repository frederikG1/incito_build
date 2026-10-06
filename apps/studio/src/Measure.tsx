import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { incitoSheet } from '@incitio/renderer';
import { useStudio } from './state.js';
import { PAGE_PX, marginsOf, sameBox, withField, type Box, type Field, type PagePx } from './box.js';
import styles from './Measure.module.css';

/**
 * "Mål" — the box in hand as numbers, in the CMS's pixels.
 *
 * Every thing that can be placed on a page answers the same five
 * questions here: how far from each edge, how wide, how tall. Typed
 * values land to the pixel; the arrow keys nudge by 1 (shift: 10), as
 * in an image editor.
 *
 * Read off the page as drawn, because that is the one place every kind
 * of box — a pinned picture, an element of a published sheet, a box in
 * a tile — has the same coordinates. A write that is not exact by
 * construction is measured again after it lands and corrected, in the
 * same undo step, so what the field says is where the box is.
 */

export interface MeasureTarget {
  /** Changes when the thing in hand does, so the fields reset. */
  key: string;
  pageId: string;
  /** Where to find it inside the page; the first that matches is measured. */
  selectors: string[];
  /** Turned on the page: measured by its own size, not the box around the turn. */
  rotated?: boolean;
  /** Width and height may differ from the proportions it has now. */
  free?: boolean;
  /** Its content decides the height (free text without a backing). */
  fixedHeight?: boolean;
  /** One write lands exactly — no measuring again. */
  exact?: boolean;
  /**
   * What the document itself says, where it says it exactly. Beats the
   * screen, which rounds a turned picture to whole screen pixels — and
   * a value read back rounded is a value written back wrong.
   */
  model?: (page: PagePx) => Partial<Box> | null;
  /** Write the box `to`; `from` is where it is now. `gesture` makes the whole change one undo step. */
  write: (to: Box, from: Box, page: PagePx, gesture: string, read: (selector: string) => Box | null) => void;
}

interface Reading { box: Box; page: PagePx }

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

/** The page as drawn in the editor: the largest one with this id, which is the canvas, not a thumbnail. */
function pageElement(pageId: string): HTMLElement | null {
  let best: HTMLElement | null = null;
  for (const element of document.querySelectorAll<HTMLElement>(`.page[data-page-id="${CSS.escape(pageId)}"]`)) {
    if (!best || element.getBoundingClientRect().width > best.getBoundingClientRect().width) best = element;
  }
  return best;
}

export function Measure({ target }: { target: MeasureTarget }) {
  const document_ = useStudio((s) => s.document);
  const pageAspect = useStudio((s) => s.brand?.pageAspect ?? 0.707);
  const endGesture = useStudio((s) => s.endGesture);
  const [reading, setReading] = useState<Reading | null>(null);
  // The target is rebuilt on every render; reading it through a ref keeps `read` stable.
  const held = useRef(target);
  held.current = target;
  const where = `${target.pageId}|${target.selectors.join('|')}|${target.rotated ? 1 : 0}`;

  const page = document_?.pages.find((p) => p.id === target.pageId);
  // An imported publication is measured in its own sheet's points; a chain page is 600 wide.
  const naturalSize = useCallback((element: HTMLElement): PagePx => {
    if (element.classList.contains('page--incito') && page?.incito) {
      const sheet = incitoSheet(page.incito);
      if (sheet.width > 0 && sheet.height > 0) return { w: sheet.width, h: sheet.height };
    }
    return { w: PAGE_PX, h: PAGE_PX / pageAspect };
  }, [page?.incito, pageAspect]);

  const read = useCallback((selectors?: string[], rotated?: boolean): Reading | null => {
    const t = held.current;
    selectors ??= t.selectors;
    rotated ??= t.rotated;
    const sheet = pageElement(t.pageId);
    if (!sheet) return null;
    let element: HTMLElement | null = null;
    for (const selector of selectors) {
      element = sheet.querySelector<HTMLElement>(selector);
      if (element) break;
    }
    if (!element) return null;
    const p = sheet.getBoundingClientRect();
    if (p.width === 0) return null;
    const natural = naturalSize(sheet);
    const k = natural.w / p.width;
    const r = element.getBoundingClientRect();
    let box: Box;
    if (rotated) {
      // A turn spins about the centre, so the centre is true; the size is the element's own.
      const zoom = sheet.offsetWidth > 0 ? p.width / sheet.offsetWidth : 1;
      const w = element.offsetWidth * zoom;
      const h = element.offsetHeight * zoom;
      const cx = (r.left + r.right) / 2 - p.left;
      const cy = (r.top + r.bottom) / 2 - p.top;
      box = { x: (cx - w / 2) * k, y: (cy - h / 2) * k, w: w * k, h: h * k };
    } else {
      box = { x: (r.left - p.left) * k, y: (r.top - p.top) * k, w: r.width * k, h: r.height * k };
    }
    const stated = t.model?.(natural);
    if (stated) box = { ...box, ...stated };
    return { box, page: natural };
  }, [where, naturalSize]);

  // Measured after every change to the avis — a drag on the page shows here as it happens.
  useLayoutEffect(() => {
    const id = requestAnimationFrame(() => setReading(read()));
    return () => cancelAnimationFrame(id);
  }, [document_, read]);
  useEffect(() => {
    const again = () => setReading(read());
    window.addEventListener('resize', again);
    return () => window.removeEventListener('resize', again);
  }, [read]);

  const place = async (to: Box) => {
    const gesture = `measure:${target.key}:${Date.now()}`;
    const reader = (selector: string) => read([selector], false)?.box ?? null;
    try {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const now = read();
        if (!now) return;
        if (attempt > 0 && sameBox(now.box, to)) break;
        held.current.write(to, now.box, now.page, gesture, reader);
        await frame();
        if (held.current.exact) break;
      }
    } finally {
      endGesture();
      setReading(read());
    }
  };

  if (!reading) return null;
  return (
    <PxFields
      key={target.key}
      box={reading.box}
      frame={reading.page}
      frameSaid="siden"
      free={target.free}
      fixedHeight={target.fixedHeight}
      onBox={(to) => void place(to)}
    />
  );
}

/**
 * Width, height and the distance to each edge, in pixels — the fields
 * themselves, for anything measured against a frame: a box on a page
 * (`Measure`), a field in an offer design (`Varedesigns`).
 */
export function PxFields({ box, frame, frameSaid, free, fixedHeight, unlocked, onBox }: {
  box: Box;
  frame: PagePx;
  /** What the frame is called in the heading: "siden", "feltet". */
  frameSaid: string;
  /** Width and height may change apart; offers the lock. */
  free?: boolean;
  fixedHeight?: boolean;
  /** Start with width and height apart — a design's field is a box, not a picture. */
  unlocked?: boolean;
  onBox: (box: Box) => void;
}) {
  const [locked, setLocked] = useState(!unlocked);
  const [draft, setDraft] = useState<Partial<Record<Field, string>>>({});
  const ratioLocked = !free || locked;
  const margins = marginsOf(box, frame);
  const shown: Record<Field, number> = { x: margins.left, y: margins.top, right: margins.right, bottom: margins.bottom, w: box.w, h: box.h };

  const commit = (field: Field, value: number) => {
    setDraft((d) => ({ ...d, [field]: undefined }));
    if (!Number.isFinite(value)) return;
    onBox(withField(box, field, value, frame, ratioLocked));
  };
  const keys = (field: Field) => (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') { commit(field, Number(event.currentTarget.value.replace(',', '.'))); return; }
    if (event.key === 'Escape') { setDraft((d) => ({ ...d, [field]: undefined })); event.currentTarget.blur(); return; }
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    const step = (event.shiftKey ? 10 : 1) * (event.key === 'ArrowUp' ? 1 : -1);
    commit(field, Math.round(shown[field]) + step);
  };
  const input = (field: Field, label: string, disabled = false) => (
    <label className={styles.measure__field}>
      <span>{label}</span>
      <input
        inputMode="decimal"
        disabled={disabled}
        value={draft[field] ?? String(Math.round(shown[field]))}
        onChange={(event) => setDraft((d) => ({ ...d, [field]: event.target.value }))}
        onBlur={(event) => { if (draft[field] !== undefined) commit(field, Number(event.target.value.replace(',', '.'))); }}
        onKeyDown={keys(field)}
      />
      <i>px</i>
    </label>
  );

  return (
    <section className={styles.measure}>
      <h4>
        Mål
        <small>{frameSaid} er {Math.round(frame.w)} × {Math.round(frame.h)} px</small>
      </h4>
      <div className={free ? styles.measure__row : `${styles.measure__row} ${styles['measure__row--two']}`}>
        {input('w', 'Bredde')}
        {free && (
          <button
            className={locked ? `${styles.measure__lock} ${styles.on}` : styles.measure__lock}
            title={locked ? 'Bredde og højde følges ad' : 'Bredde og højde hver for sig'}
            aria-pressed={locked}
            onClick={() => setLocked(!locked)}
          >{locked ? '🔗' : '⛓︎'}</button>
        )}
        {input('h', 'Højde', fixedHeight)}
      </div>
      <p className={styles.measure__sub}>Afstand til kanten</p>
      <div className={styles.measure__grid}>
        {input('y', 'Top')}
        {input('x', 'Venstre')}
        {input('right', 'Højre')}
        {input('bottom', 'Bund')}
      </div>
      <p className="inspector__hint"><b>↑ ↓</b> 1 px · med <b>shift</b> 10 px · <b>Enter</b> sætter tallet</p>
    </section>
  );
}
