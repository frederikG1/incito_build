import { useRef, useState } from 'react';
import { curveFunction, type Histogram } from '@incitio/renderer';
import type { CurvePoint } from '@incitio/schema';
import styles from './Darkroom.module.css';

export type CurveChannel = 'rgb' | 'r' | 'g' | 'b';

const IDENTITY: CurvePoint[] = [[0, 0], [1, 1]];
const SIZE = 256;

/** One channel's counts as an area along the bottom, square-rooted so a white ground does not flatten everything else. */
function area(counts: number[]): string {
  const peak = Math.sqrt(Math.max(1, ...counts.slice(1, 255)));
  const y = (n: number) => SIZE - Math.min(1, Math.sqrt(n) / peak) * SIZE;
  return `M0 ${SIZE}${counts.map((n, i) => `L${i} ${y(n).toFixed(1)}`).join('')}L255 ${SIZE}Z`;
}

/**
 * The histogram with the tone curve drawn on top of it — the one place
 * where what the photograph HAS and what is being done TO it are seen
 * together: drag the curve where the counts are, and the counts move.
 *
 * Click the curve to add a point, drag it, double-click (or drag it out
 * of the box) to take it away. The two ends stay, as in Photoshop, and
 * move only up and down.
 */
export function CurveHistogram({ before, after, channel, points, onChange, onEnd }: {
  before: Histogram | null;
  after: Histogram | null;
  channel: CurveChannel;
  points: CurvePoint[] | undefined;
  onChange: (points: CurvePoint[]) => void;
  onEnd: () => void;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const [held, setHeld] = useState<number | null>(null);
  const pts = points ?? IDENTITY;
  const f = curveFunction(pts);
  const curve = Array.from({ length: 65 }, (_, i) => {
    const x = i / 64;
    return `${i ? 'L' : 'M'}${(x * SIZE).toFixed(1)} ${((1 - f(x)) * SIZE).toFixed(1)}`;
  }).join('');
  const counts = (h: Histogram | null) => (h ? (channel === 'rgb' ? h.l : h[channel]) : null);
  const was = counts(before);
  const now = counts(after);

  const at = (event: { clientX: number; clientY: number }): CurvePoint => {
    const box = svg.current!.getBoundingClientRect();
    return [(event.clientX - box.left) / box.width, 1 - (event.clientY - box.top) / box.height];
  };
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  const round = (v: number) => Math.round(v * 1000) / 1000;

  const drag = (index: number, start: PointerEvent | React.PointerEvent) => {
    const element = svg.current!;
    let working = pts.map((p) => [...p] as CurvePoint);
    if (index < 0) {
      // A new point, on the curve where it was clicked.
      const [x] = at(start);
      const p: CurvePoint = [round(clamp(x)), round(clamp(f(clamp(x))))];
      index = working.findIndex((q) => q[0] > p[0]);
      if (index < 0) index = working.length - 1;
      working.splice(index, 0, p);
      onChange(working);
    }
    setHeld(index);
    const last = working.length - 1;
    const move = (event: PointerEvent) => {
      const [x, y] = at(event);
      const next = working.map((p) => [...p] as CurvePoint);
      const inner = index > 0 && index < last;
      // Dragged right out of the box: gone.
      if (inner && (y < -0.12 || y > 1.12)) {
        next.splice(index, 1);
        onChange(next);
        return;
      }
      const lo = inner ? next[index - 1]![0] + 0.01 : index === 0 ? 0 : 1;
      const hi = inner ? next[index + 1]![0] - 0.01 : index === 0 ? 0 : 1;
      next[index] = [round(Math.min(hi, Math.max(lo, x))), round(clamp(y))];
      working = next;
      onChange(next);
    };
    const up = () => {
      element.removeEventListener('pointermove', move);
      element.removeEventListener('pointerup', up);
      element.removeEventListener('pointercancel', up);
      setHeld(null);
      onEnd();
    };
    element.addEventListener('pointermove', move);
    element.addEventListener('pointerup', up);
    element.addEventListener('pointercancel', up);
  };

  return (
    <svg
      ref={svg}
      className={`${styles.curve} ${styles[`curve_${channel}`]}`}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`Histogram og tonekurve, ${channel === 'rgb' ? 'alle kanaler' : channel.toUpperCase()}`}
      onPointerDown={(event) => {
        if ((event.target as Element).closest('[data-point]')) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        drag(-1, event);
      }}
    >
      {[64, 128, 192].map((v) => (
        <g key={v} className={styles.curveGrid}>
          <line x1={v} x2={v} y1={0} y2={SIZE} />
          <line y1={v} y2={v} x1={0} x2={SIZE} />
        </g>
      ))}
      {was && <path className={styles.histBefore} d={area(was)} />}
      {now && <path className={styles.histAfter} d={area(now)} />}
      <line className={styles.curveDiagonal} x1={0} y1={SIZE} x2={SIZE} y2={0} />
      <path className={styles.curveLine} d={curve} />
      {pts.map(([x, y], index) => (
        <circle
          key={index}
          data-point={index}
          className={`${styles.curvePoint}${held === index ? ` ${styles.isHeld}` : ''}`}
          cx={x * SIZE}
          cy={(1 - y) * SIZE}
          r={6}
          onPointerDown={(event) => {
            event.stopPropagation();
            svg.current!.setPointerCapture(event.pointerId);
            drag(index, event);
          }}
          onDoubleClick={() => {
            if (index === 0 || index === pts.length - 1) return;
            onChange(pts.filter((_, i) => i !== index));
            onEnd();
          }}
        />
      ))}
    </svg>
  );
}
