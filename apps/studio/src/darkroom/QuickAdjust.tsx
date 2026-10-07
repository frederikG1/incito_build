import { useState } from 'react';
import { adjustTouched } from '@incitio/schema';
import { autoLevels, histogram } from '@incitio/renderer';
import { Darkroom } from './Darkroom.js';
import { loadPixels } from './pixels.js';
import { useDeveloping, type AdjustTarget } from './target.js';

/*
 * The photograph's development, the short way — the three sliders a
 * busy week uses, Auto, and "white ground away" — with the whole
 * workshop one click further. Everything else stays in there, so the
 * panel does not turn into Photoshop for somebody fixing one dark tub.
 */
const QUICK = [
  ['brightness', 'Lysstyrke'],
  ['contrast', 'Kontrast'],
  ['saturation', 'Mætning'],
] as const;

export function QuickAdjust({ target, title }: { target: AdjustTarget; title: string }) {
  const dev = useDeveloping(target);
  const [open, setOpen] = useState(false);
  const [auto, setAuto] = useState<string | null>(null);
  if (!dev || !dev.imageUrl) return null;
  const { adjust } = dev;

  const runAuto = async () => {
    const loaded = await loadPixels(dev.imageUrl!);
    if (!loaded.ok) { setAuto(loaded.reason); return; }
    setAuto(null);
    dev.write({ levels: { gamma: 1, outBlack: 0, outWhite: 1, ...adjust.levels, ...autoLevels(histogram(loaded.pixels.rgba)) } });
    dev.endGesture();
  };

  return (
    <>
      <h3 className="inspector__group">
        Juster billede
        {adjustTouched(adjust) && <span className="inspector__count">rettet</span>}
      </h3>
      {QUICK.map(([key, name]) => {
        const value = adjust[key] ?? 0;
        return (
          <label key={key} className="inspector__field">
            <span>{name} <b>{value > 0 ? '+' : ''}{Math.round(value * 100)}</b></span>
            <input
              type="range" min={-100} max={100} value={Math.round(value * 100)}
              onChange={(e) => dev.write({ [key]: Number(e.target.value) / 100 }, `adjust:${dev.key}:${key}`)}
              onPointerUp={dev.endGesture}
              onDoubleClick={() => { dev.write({ [key]: 0 }); dev.endGesture(); }}
            />
          </label>
        );
      })}
      <div className="decorpanel__row">
        <button className="inspector__promote" onClick={() => void runAuto()} title="Stræk billedet ud til fuldt sort og hvidt">Auto</button>
        <button
          className="inspector__promote"
          aria-pressed={adjust.blend === 'multiply'}
          onClick={() => { dev.write({ blend: adjust.blend === 'multiply' ? 'normal' : 'multiply' }); dev.endGesture(); }}
          title="Multiplicer: den hvide bund forsvinder på en farvet side"
        >{adjust.blend === 'multiply' ? '✓ Hvid bund væk' : 'Hvid bund væk'}</button>
      </div>
      {auto && <p className="inspector__packsay">{auto}</p>}
      <div className="decorpanel__row">
        <button className="inspector__promote" onClick={() => setOpen(true)}>Billedværksted…</button>
        <button className="inspector__promote" disabled={!adjustTouched(adjust)} onClick={dev.reset}>Nulstil</button>
      </div>
      {open && <Darkroom target={target} title={title} onClose={() => setOpen(false)} />}
    </>
  );
}
