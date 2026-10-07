import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { adjustment, autoLevels, develop, histogram } from '@incitio/renderer';
import { BLEND_MODES, TONAL_KEYS, type BlendMode, type ImageAdjust, type ImageLevels } from '@incitio/schema';
import { CurveHistogram, type CurveChannel } from './CurveHistogram.js';
import { loadPixels, thumbnail, type Loaded } from './pixels.js';
import {
  combine, ellipseBitmap, ellipsePath, gridFor, invertBitmap, magicWand, rectBitmap, rectPath, selectedCount, selectionPath,
  type Bitmap, type Box, type Combine,
} from './selection.js';
import { useDeveloping, type AdjustTarget } from './target.js';
import styles from './Darkroom.module.css';

type Tool = 'rect' | 'ellipse' | 'wand' | 'crop';

const TOOLS: { id: Tool; name: string; key: string; glyph: ReactNode }[] = [
  { id: 'rect', name: 'Rektangel', key: 'M', glyph: <rect x="4" y="6" width="16" height="12" strokeDasharray="3 2" /> },
  { id: 'ellipse', name: 'Ellipse', key: 'E', glyph: <ellipse cx="12" cy="12" rx="8" ry="6" strokeDasharray="3 2" /> },
  { id: 'wand', name: 'Tryllestav', key: 'W', glyph: <><path d="M5 19 15 9" /><path d="M16 3v3M16 10v3M12.5 6.5h-2M21.5 6.5h-2M18.5 4l-1 1M14.5 9l-1 1M18.5 9l-1-1" /></> },
  { id: 'crop', name: 'Beskær', key: 'C', glyph: <path d="M7 3v14h14M3 7h14v14" /> },
];

const MODES: [Combine, string, string][] = [
  ['replace', 'Ny', 'Ny markering'],
  ['add', 'Tilføj', 'Læg til (hold shift)'],
  ['subtract', 'Fratræk', 'Træk fra (hold alt)'],
  ['intersect', 'Fælles', 'Kun det fælles'],
];

const BLEND_NAMES: Record<BlendMode, string> = {
  normal: 'Normal', multiply: 'Multiplicer', screen: 'Skærm', overlay: 'Overlejring',
  darken: 'Mørkere', lighten: 'Lysere', 'color-dodge': 'Farveudvisk', 'color-burn': 'Farvebrænd',
  'hard-light': 'Hårdt lys', 'soft-light': 'Blødt lys', difference: 'Difference', exclusion: 'Udelukkelse',
  hue: 'Farvetone', saturation: 'Mætning', color: 'Farve', luminosity: 'Lysstyrke',
};

const LEVELS: ImageLevels = { black: 0, white: 1, gamma: 1, outBlack: 0, outWhite: 1 };

interface SliderSpec {
  key: 'exposure' | 'brightness' | 'contrast' | 'hue' | 'saturation' | 'lightness' | 'sharpen' | 'blur' | 'skewX' | 'skewY';
  name: string;
  min: number;
  max: number;
  step: number;
  show: (v: number) => string;
}
const pct = (v: number) => `${v > 0 ? '+' : ''}${Math.round(v * 100)}`;
const GROUPS: { title: string; sliders: SliderSpec[] }[] = [
  { title: 'Lys', sliders: [
    { key: 'exposure', name: 'Eksponering', min: -3, max: 3, step: 0.05, show: (v) => `${v > 0 ? '+' : ''}${v.toFixed(2)} EV` },
    { key: 'brightness', name: 'Lysstyrke', min: -1, max: 1, step: 0.01, show: pct },
    { key: 'contrast', name: 'Kontrast', min: -1, max: 1, step: 0.01, show: pct },
  ] },
  { title: 'Farve', sliders: [
    { key: 'hue', name: 'Farvetone', min: -180, max: 180, step: 1, show: (v) => `${v > 0 ? '+' : ''}${v}°` },
    { key: 'saturation', name: 'Mætning', min: -1, max: 1, step: 0.01, show: pct },
    { key: 'lightness', name: 'Lyshed', min: -1, max: 1, step: 0.01, show: pct },
  ] },
  { title: 'Detalje', sliders: [
    { key: 'sharpen', name: 'Skarphed', min: 0, max: 3, step: 0.05, show: (v) => v.toFixed(2) },
    { key: 'blur', name: 'Sløring', min: 0, max: 0.05, step: 0.0005, show: (v) => `${(v * 100).toFixed(1)} %` },
  ] },
  { title: 'Form', sliders: [
    { key: 'skewX', name: 'Skæv vandret', min: -45, max: 45, step: 0.5, show: (v) => `${v}°` },
    { key: 'skewY', name: 'Skæv lodret', min: -45, max: 45, step: 0.5, show: (v) => `${v}°` },
  ] },
];

function Slider({ spec, value, onChange, onEnd }: { spec: SliderSpec; value: number; onChange: (v: number) => void; onEnd: () => void }) {
  return (
    <label className={styles.slider}>
      <span>{spec.name}</span>
      <output className={value === 0 ? styles.isZero : undefined}>{spec.show(value)}</output>
      <input
        type="range" min={spec.min} max={spec.max} step={spec.step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={onEnd}
        onKeyUp={onEnd}
        onDoubleClick={() => { onChange(0); onEnd(); }}
        title="Dobbeltklik nulstiller"
      />
    </label>
  );
}

/** Pointer position in grid units, inside the frame. */
function gridPoint(event: { clientX: number; clientY: number }, frame: HTMLElement, w: number, h: number): [number, number] {
  const box = frame.getBoundingClientRect();
  return [
    Math.min(w, Math.max(0, ((event.clientX - box.left) / box.width) * w)),
    Math.min(h, Math.max(0, ((event.clientY - box.top) / box.height) * h)),
  ];
}

const boxBetween = (a: [number, number], b: [number, number], square: boolean): Box => {
  let w = b[0] - a[0];
  let h = b[1] - a[1];
  if (square) {
    const s = Math.max(Math.abs(w), Math.abs(h));
    w = Math.sign(w || 1) * s;
    h = Math.sign(h || 1) * s;
  }
  return { x: Math.min(a[0], a[0] + w), y: Math.min(a[1], a[1] + h), w: Math.abs(w), h: Math.abs(h) };
};

/**
 * The photograph on its own, on a neutral grey, with every development
 * the page can draw — Photoshop's core, as numbers on the document.
 *
 * Left the tools (marquee, ellipse, magic wand, crop), in the middle the
 * photograph as the page will print it, right the histogram under the
 * curve and every slider. Everything writes through the studio's own
 * edits as it moves: the page behind updates live, ⌘Z undoes a slider
 * drag as one step, and the file the feed linked is never touched.
 */
export function Darkroom({ target, title, onClose }: { target: AdjustTarget; title: string; onClose: () => void }) {
  const dev = useDeveloping(target);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [tool, setTool] = useState<Tool>('wand');
  const [mode, setMode] = useState<Combine>('replace');
  const [tolerance, setTolerance] = useState(32);
  const [contiguous, setContiguous] = useState(true);
  const [selection, setSelection] = useState<{ bits: Bitmap; exact: string | null } | null>(null);
  const [drag, setDrag] = useState<{ box: Box; tool: Tool } | null>(null);
  const [before, setBefore] = useState(false);
  const [channel, setChannel] = useState<CurveChannel>('rgb');
  const stage = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState({ w: 0, h: 0 });

  const url = dev?.imageUrl ?? null;
  useEffect(() => {
    if (!url) return;
    let live = true;
    void loadPixels(url).then((result) => { if (live) setLoaded(result); });
    return () => { live = false; };
  }, [url]);

  const pixels = loaded?.ok ? loaded.pixels : null;
  const grid = useMemo(() => (
    pixels ? { w: pixels.w, h: pixels.h } : loaded && !loaded.ok ? gridFor(loaded.naturalW, loaded.naturalH) : null
  ), [pixels, loaded]);
  const adjust = dev?.adjust ?? {};

  // The photograph fitted into the stage, in its own proportions, so the overlay and the image share one box.
  useLayoutEffect(() => {
    const element = stage.current;
    if (!element || !grid) return;
    const measure = () => {
      const room = element.getBoundingClientRect();
      const k = Math.min((room.width - 48) / grid.w, (room.height - 48) / grid.h);
      setFit({ w: Math.max(1, grid.w * k), h: Math.max(1, grid.h * k) });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [grid?.w, grid?.h]);

  const small = useMemo(() => (pixels ? thumbnail(pixels) : null), [pixels]);
  const histBefore = useMemo(() => (small ? histogram(small.rgba) : null), [small]);
  const tonal = useMemo(() => Object.fromEntries(TONAL_KEYS.map((k) => [k, adjust[k]])) as ImageAdjust, [adjust]);
  const histAfter = useMemo(() => (small ? histogram(develop(small.rgba, small.w, small.h, tonal)) : null), [small, tonal]);

  const ants = useMemo(() => {
    if (!selection || !grid) return null;
    return selection.exact ?? selectionPath(selection.bits, grid.w, grid.h);
  }, [selection, grid]);

  // On the stage the WHOLE photograph shows, so the crop is drawn as a frame over it rather than applied.
  const stageLook = useMemo(() => adjustment({ ...adjust, crop: undefined }), [adjust]);

  const choose = (bits: Bitmap, exact: string | null, how: Combine) => {
    const merged = combine(selection?.bits ?? null, bits, how);
    setSelection(selectedCount(merged) ? { bits: merged, exact: how === 'replace' || !selection ? exact : null } : null);
  };

  const modeFor = (event: { shiftKey: boolean; altKey: boolean }): Combine => (
    event.shiftKey && event.altKey ? 'intersect' : event.shiftKey ? 'add' : event.altKey ? 'subtract' : mode
  );

  const selectSubject = () => {
    if (!pixels) return;
    const { rgba, w, h } = pixels;
    let ground: Bitmap | null = null;
    for (const [x, y] of [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]] as const) {
      ground = combine(ground, magicWand(rgba, w, h, x, y, tolerance, true), 'add');
    }
    const subject = invertBitmap(ground!);
    setSelection(selectedCount(subject) ? { bits: subject, exact: null } : null);
  };

  const commitMask = (invert: boolean) => {
    if (!dev || !grid || !ants) return;
    dev.write({ mask: { w: grid.w, h: grid.h, path: ants, feather: adjust.mask?.feather ?? 0, invert } });
    dev.endGesture();
  };

  const onStageDown = (event: React.PointerEvent) => {
    if (!grid || !frame.current || event.button !== 0) return;
    const start = gridPoint(event, frame.current, grid.w, grid.h);
    const how = modeFor(event);
    if (tool === 'wand') {
      if (!pixels) return;
      choose(magicWand(pixels.rgba, pixels.w, pixels.h, start[0], start[1], tolerance, contiguous), null, how);
      return;
    }
    const element = event.currentTarget as HTMLElement;
    element.setPointerCapture(event.pointerId);
    const move = (e: PointerEvent) => {
      setDrag({ box: boxBetween(start, gridPoint(e, frame.current!, grid.w, grid.h), e.shiftKey && how === 'replace'), tool });
    };
    const up = (e: PointerEvent) => {
      element.removeEventListener('pointermove', move);
      element.removeEventListener('pointerup', up);
      element.removeEventListener('pointercancel', up);
      setDrag(null);
      const box = boxBetween(start, gridPoint(e, frame.current!, grid.w, grid.h), e.shiftKey && how === 'replace');
      if (box.w < 2 || box.h < 2) {
        if (tool !== 'crop' && how === 'replace') setSelection(null);
        return;
      }
      if (tool === 'crop') {
        dev?.write({ crop: { x: box.x / grid.w, y: box.y / grid.h, w: Math.max(0.02, box.w / grid.w), h: Math.max(0.02, box.h / grid.h) } });
        dev?.endGesture();
        return;
      }
      const bits = tool === 'rect' ? rectBitmap(grid.w, grid.h, box) : ellipseBitmap(grid.w, grid.h, box);
      choose(bits, tool === 'rect' ? rectPath(box) : ellipsePath(box), how);
    };
    element.addEventListener('pointermove', move);
    element.addEventListener('pointerup', up);
    element.addEventListener('pointercancel', up);
  };

  // Keys of their own while the sheet is open; ⌘Z is left to the studio, so undo works here as everywhere.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement | null)?.closest('input, select, textarea')) return;
      const k = event.key.toLowerCase();
      const command = event.metaKey || event.ctrlKey;
      let handled = true;
      if (k === 'escape') { if (selection) setSelection(null); else onClose(); }
      else if (command && k === 'd') setSelection(null);
      else if (command && event.shiftKey && k === 'i') setSelection((s) => (s ? { bits: invertBitmap(s.bits), exact: null } : s));
      else if (command && k === 'a' && grid) setSelection({ bits: new Uint8Array(grid.w * grid.h).fill(1), exact: rectPath({ x: 0, y: 0, w: grid.w, h: grid.h }) });
      else if (!command && TOOLS.some((t) => t.key.toLowerCase() === k)) setTool(TOOLS.find((t) => t.key.toLowerCase() === k)!.id);
      else if (!command && k === '\\') setBefore((b) => !b);
      else if (!command && k.startsWith('arrow')) { /* swallowed: the tile behind must not move */ }
      else handled = false;
      if (handled) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [selection, grid, onClose]);

  if (!dev) return null;
  const set = (key: keyof ImageAdjust, field?: string) => (value: unknown) => dev.write({ [key]: value }, `adjust:${dev.key}:${field ?? key}`);
  const levels = adjust.levels ?? LEVELS;
  const setLevels = (patch: Partial<ImageLevels>) => set('levels')({ ...levels, ...patch });
  const curveKey = channel;
  const crop = adjust.crop;
  const mask = adjust.mask;

  const sheet = (
    <div className={styles.sheet} role="dialog" aria-modal="true" aria-label={`Billedværksted — ${title}`}>
      <header className={styles.bar}>
        <h2>{title}</h2>
        <div className={styles.barActions}>
          <button
            className={before ? styles.isOn : undefined}
            aria-pressed={before}
            onClick={() => setBefore((b) => !b)}
            title="Vis originalen (\)"
          >Før</button>
          <button onClick={() => { dev.reset(); setSelection(null); }}>Nulstil alt</button>
          <button className={styles.done} onClick={onClose}>Færdig</button>
        </div>
      </header>

      <div className={styles.options} role="toolbar" aria-label="Værktøjets indstillinger">
        {tool === 'crop' ? (
          <>
            <span className={styles.hint}>Træk en ramme om det, der skal blive.</span>
            {crop && <button onClick={() => { dev.write({ crop: undefined }); dev.endGesture(); }}>Fjern beskæring</button>}
          </>
        ) : (
          <>
            <div className={styles.segment} role="group" aria-label="Markering">
              {MODES.map(([id, name, hint]) => (
                <button key={id} className={mode === id ? styles.isOn : undefined} aria-pressed={mode === id} title={hint} onClick={() => setMode(id)}>{name}</button>
              ))}
            </div>
            {tool === 'wand' && (
              <>
                <label className={styles.inline}>
                  Tolerance
                  <input type="range" min={0} max={128} value={tolerance} onChange={(e) => setTolerance(Number(e.target.value))} />
                  <output>{tolerance}</output>
                </label>
                <label className={styles.inline}>
                  <input type="checkbox" checked={contiguous} onChange={(e) => setContiguous(e.target.checked)} />
                  Sammenhængende
                </label>
              </>
            )}
            <button onClick={selectSubject} disabled={!pixels} title="Markér alt, der ikke er bunden omkring varen">Vælg varen</button>
            {selection && (
              <>
                <span className={styles.rule} />
                <button onClick={() => setSelection((s) => (s ? { bits: invertBitmap(s.bits), exact: null } : s))}>Vend markering</button>
                <button className={styles.primary} onClick={() => commitMask(false)}>Vis kun markeringen</button>
                <button onClick={() => commitMask(true)}>Skjul markeringen</button>
              </>
            )}
          </>
        )}
      </div>

      <nav className={styles.tools} aria-label="Værktøjer">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            className={tool === t.id ? styles.isOn : undefined}
            aria-pressed={tool === t.id}
            disabled={t.id === 'wand' && loaded !== null && !loaded.ok}
            title={`${t.name} (${t.key})`}
            onClick={() => setTool(t.id)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">{t.glyph}</svg>
            <span>{t.name}</span>
          </button>
        ))}
      </nav>

      <div className={styles.stage} ref={stage}>
        {!url && <p className={styles.note}>Der er intet billede at justere.</p>}
        {url && grid && (
          <div
            ref={frame}
            className={`${styles.frame} ${styles[`tool_${tool}`]}`}
            style={{ width: fit.w, height: fit.h }}
            onPointerDown={onStageDown}
          >
            <img
              src={url}
              alt=""
              draggable={false}
              {...(before ? {} : stageLook.attrs)}
              style={before ? undefined : { ...stageLook.style, ...(stageLook.skew ? { transform: stageLook.skew } : {}) }}
            />
            {!before && stageLook.defs}
            <svg className={styles.overlay} viewBox={`0 0 ${grid.w} ${grid.h}`} preserveAspectRatio="none" aria-hidden="true">
              {crop && (
                <>
                  <path
                    className={styles.cropShade}
                    fillRule="evenodd"
                    d={`M0 0H${grid.w}V${grid.h}H0Z${rectPath({ x: crop.x * grid.w, y: crop.y * grid.h, w: crop.w * grid.w, h: crop.h * grid.h })}`}
                  />
                  <rect className={styles.cropEdge} x={crop.x * grid.w} y={crop.y * grid.h} width={crop.w * grid.w} height={crop.h * grid.h} />
                </>
              )}
              {ants && (
                <>
                  <path className={styles.antsUnder} d={ants} />
                  <path className={styles.ants} d={ants} />
                </>
              )}
              {drag && (
                drag.tool === 'ellipse'
                  ? <ellipse className={styles.ants} cx={drag.box.x + drag.box.w / 2} cy={drag.box.y + drag.box.h / 2} rx={drag.box.w / 2} ry={drag.box.h / 2} />
                  : <rect className={drag.tool === 'crop' ? styles.cropEdge : styles.ants} x={drag.box.x} y={drag.box.y} width={drag.box.w} height={drag.box.h} />
              )}
            </svg>
          </div>
        )}
        {loaded && !loaded.ok && <p className={styles.note}>{loaded.reason}</p>}
      </div>

      <aside className={styles.panel}>
        <section>
          <div className={styles.panelHead}>
            <h3>Kurver</h3>
            <div className={styles.channels} role="group" aria-label="Kanal">
              {(['rgb', 'r', 'g', 'b'] as const).map((c) => (
                <button key={c} className={`${styles[`ch_${c}`]}${channel === c ? ` ${styles.isOn}` : ''}`} aria-pressed={channel === c} onClick={() => setChannel(c)}>
                  {c === 'rgb' ? 'RGB' : c.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
          <CurveHistogram
            before={histBefore}
            after={histAfter}
            channel={channel}
            points={adjust.curves?.[curveKey]}
            onChange={(points) => set('curves', `curve-${curveKey}`)({ ...adjust.curves, [curveKey]: points })}
            onEnd={dev.endGesture}
          />
          <div className={styles.row}>
            <button onClick={() => {
              if (!histBefore) return;
              set('levels')({ ...levels, ...autoLevels(histBefore) });
              dev.endGesture();
            }} disabled={!histBefore} title="Stræk billedet ud til fuldt sort og hvidt">Auto</button>
            <button onClick={() => {
              const { [curveKey]: _, ...rest } = adjust.curves ?? {};
              set('curves')(Object.keys(rest).length ? rest : undefined);
              dev.endGesture();
            }} disabled={!adjust.curves?.[curveKey]}>Ret kurven ud</button>
          </div>
        </section>

        <section>
          <h3>Niveauer</h3>
          <div className={styles.levels}>
            <Slider spec={{ key: 'brightness', name: 'Sort', min: 0, max: 0.9, step: 0.005, show: (v) => String(Math.round(v * 255)) }} value={levels.black} onChange={(v) => setLevels({ black: Math.min(v, levels.white - 0.05) })} onEnd={dev.endGesture} />
            <Slider spec={{ key: 'brightness', name: 'Mellemtone', min: 0.2, max: 4, step: 0.01, show: (v) => v.toFixed(2) }} value={levels.gamma} onChange={(v) => setLevels({ gamma: v })} onEnd={dev.endGesture} />
            <Slider spec={{ key: 'brightness', name: 'Hvid', min: 0.1, max: 1, step: 0.005, show: (v) => String(Math.round(v * 255)) }} value={levels.white} onChange={(v) => setLevels({ white: Math.max(v, levels.black + 0.05) })} onEnd={dev.endGesture} />
            <Slider spec={{ key: 'brightness', name: 'Sort ud', min: 0, max: 1, step: 0.005, show: (v) => String(Math.round(v * 255)) }} value={levels.outBlack} onChange={(v) => setLevels({ outBlack: v })} onEnd={dev.endGesture} />
            <Slider spec={{ key: 'brightness', name: 'Hvid ud', min: 0, max: 1, step: 0.005, show: (v) => String(Math.round(v * 255)) }} value={levels.outWhite} onChange={(v) => setLevels({ outWhite: v })} onEnd={dev.endGesture} />
          </div>
        </section>

        {GROUPS.filter((g) => !(dev.whole && g.title === 'Form')).map((group) => (
          <section key={group.title}>
            <h3>{group.title}</h3>
            {group.sliders.map((spec) => (
              <Slider key={spec.key} spec={spec} value={(adjust[spec.key] as number | undefined) ?? 0} onChange={set(spec.key)} onEnd={dev.endGesture} />
            ))}
            {group.title === 'Detalje' && (
              <label className={styles.check}>
                <input type="checkbox" checked={adjust.edges ?? false} onChange={(e) => { set('edges')(e.target.checked); dev.endGesture(); }} />
                Find kanter
              </label>
            )}
          </section>
        ))}

        {!dev.whole && (
          <section>
            <h3>Maske</h3>
            {mask ? (
              <>
                <Slider
                  spec={{ key: 'blur', name: 'Blød kant', min: 0, max: 0.1, step: 0.001, show: (v) => `${(v * 100).toFixed(1)} %` }}
                  value={mask.feather}
                  onChange={(v) => set('mask', 'feather')({ ...mask, feather: v })}
                  onEnd={dev.endGesture}
                />
                <div className={styles.row}>
                  <button onClick={() => { set('mask')({ ...mask, invert: !mask.invert }); dev.endGesture(); }}>Vend masken</button>
                  <button onClick={() => { set('mask')(undefined); dev.endGesture(); }}>Fjern masken</button>
                </div>
              </>
            ) : (
              <p className={styles.say}>Markér med et værktøj til venstre, og vælg så hvad der skal vises.</p>
            )}
          </section>
        )}

        <section>
          <h3>Lag</h3>
          <label className={styles.select}>
            <span>Blanding med siden</span>
            <select value={adjust.blend ?? 'normal'} onChange={(e) => { set('blend')(e.target.value); dev.endGesture(); }}>
              {BLEND_MODES.map((m) => <option key={m} value={m}>{BLEND_NAMES[m]}</option>)}
            </select>
          </label>
          <p className={styles.say}>Multiplicer får en hvid bund til at forsvinde på en farvet side.</p>
        </section>
      </aside>
    </div>
  );
  return createPortal(sheet, document.body);
}
