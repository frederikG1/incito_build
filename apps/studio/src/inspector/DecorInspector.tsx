import { useStudio, useStudioPick } from '../state.js';
import { Measure } from '../Measure.js';
import { decorToBox } from '../box.js';
import { QuickAdjust } from '../darkroom/QuickAdjust.js';

/*
 * A picture on the page, in hand — the chain's own or a drawn motif.
 *
 * The same panel a product gets, because it is the same job: it sat
 * as a strip of two unlabelled sliders over the sheet, which gave a
 * picture half the controls of a price tag. Every field is labelled,
 * and it is one undo step per drag, like everything else here.
 */
const CORNERS = [
  ['top-left', '↖', 'Øverst til venstre'],
  ['top-right', '↗', 'Øverst til højre'],
  ['bottom-left', '↙', 'Nederst til venstre'],
  ['bottom-right', '↘', 'Nederst til højre'],
] as const;

export function DecorInspector({ decorId }: { decorId: string }) {
  const { document, updatePageImage, removePageImage, selectDecor, endGesture } = useStudioPick('document', 'updatePageImage', 'removePageImage', 'selectDecor', 'endGesture');
  const page = document?.pages.find((entry) => entry.decorations.some((d) => d.id === decorId));
  const decor = page?.decorations.find((d) => d.id === decorId);
  if (!page || !decor) return null;
  const set = (patch: Parameters<typeof updatePageImage>[2], gesture?: string) => updatePageImage(page.id, decor.id, patch, gesture);
  const moved = decor.offsetX !== 0 || decor.offsetY !== 0;

  return (
    <aside className="inspector">
      <header className="inspector__head">
        <h2>{decor.subject ? decor.subject[0]!.toUpperCase() + decor.subject.slice(1) : 'Billede på siden'}</h2>
        <button className="inspector__close" onClick={() => selectDecor(null)} aria-label="Luk">×</button>
      </header>
      <p className="inspector__meta">
        {decor.id.startsWith('decor-') ? 'Tegnet af AI' : 'Dit eget billede'} · træk det rundt på siden
      </p>
      <div className="decorpanel__shot"><img src={decor.imageUrl} alt="" /></div>

      <Measure target={{
        key: `decor:${decor.id}`,
        pageId: page.id,
        selectors: [`img[data-decor-id="${CSS.escape(decor.id)}"]`],
        rotated: decor.rotate !== 0,
        free: true,
        exact: true,
        model: (size) => (decor.rect ? {
          x: (decor.rect.x + decor.offsetX / 100) * size.w,
          y: (decor.rect.y + decor.offsetY / 100) * size.h,
          w: decor.rect.w * size.w,
          h: decor.rect.h * size.h,
        } : null),
        write: (to, _from, size, gesture) => set({ ...decorToBox(to, size) }, gesture),
      }} />

      <div className="inspector__field">
        <span>Hjørne</span>
        <div className="segment" role="group" aria-label="Hjørne">
          {CORNERS.map(([anchor, arrow, name]) => (
            <button
              key={anchor}
              className={decor.anchor === anchor ? 'is-on' : ''}
              title={name}
              onClick={() => set({ anchor, offsetX: 0, offsetY: 0 })}
            >{arrow}</button>
          ))}
        </div>
      </div>

      <label className="inspector__field">
        <span>Størrelse <b>{Math.round(decor.scale * 100)} %</b></span>
        <input
          type="range" min={5} max={60} value={Math.round(decor.scale * 100)}
          onChange={(e) => set({ scale: Number(e.target.value) / 100 })}
          onPointerUp={endGesture}
        />
      </label>
      <label className="inspector__field">
        <span>Drejning <b>{decor.rotate}°</b></span>
        <input
          type="range" min={-30} max={30} value={decor.rotate}
          onChange={(e) => set({ rotate: Number(e.target.value) })}
          onPointerUp={endGesture}
        />
      </label>
      <label className="inspector__field">
        <span>Synlighed <b>{Math.round(decor.opacity * 100)} %</b></span>
        <input
          type="range" min={5} max={100} value={Math.round(decor.opacity * 100)}
          onChange={(e) => set({ opacity: Number(e.target.value) / 100 })}
          onPointerUp={endGesture}
        />
      </label>

      <div className="inspector__field">
        <span>Lag</span>
        <div className="segment" role="group" aria-label="Lag">
          <button className={decor.front ? '' : 'is-on'} onClick={() => set({ front: false })}>Bag varerne</button>
          <button className={decor.front ? 'is-on' : ''} onClick={() => set({ front: true })}>Foran varerne</button>
        </div>
      </div>

      <div className="decorpanel__row">
        <button className="inspector__promote" onClick={() => set({ flip: !decor.flip })}>
          {decor.flip ? '⇋ Spejlvendt' : '⇋ Spejlvend'}
        </button>
        <button
          className="inspector__promote"
          disabled={!moved && decor.rotate === 0}
          onClick={() => set({ offsetX: 0, offsetY: 0, rotate: 0 })}
          title="Tilbage i hjørnet, uden drejning"
        >Nulstil placering</button>
      </div>
      <QuickAdjust target={{ kind: 'decor', pageId: page.id, decorId: decor.id }} title={decor.subject || 'Billede på siden'} />

      <button className="inspector__drop" onClick={() => removePageImage(page.id, decor.id)}>
        Tag af siden
      </button>

      <details className="inspector__keysbox">
        <summary>Genveje</summary>
        <ul className="inspector__keys">
        <li><b>Træk</b> billedet på siden for at flytte det</li>
        <li><b>Piletaster</b> flytter det — med shift længere</li>
        <li><b>+ / −</b> ændrer størrelsen, <b>[ ]</b> drejer, <b>0</b> retter det op</li>
        <li><b>⌫</b> tager det af siden</li>
        <li><b>Esc</b> slipper det, så det lægger sig på plads</li>
      </ul>
      </details>
    </aside>
  );
}
