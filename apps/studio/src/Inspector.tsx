import {
  TILE_PARTS, TILE_PART_NAMES, partLimits, partOverride, partTouched,
} from '@incitio/schema';
import type { TilePart } from '@incitio/schema';
import { useStudio } from './state.js';

/**
 * The boxes whose wording lives on the box itself.
 *
 * The headline and the underline are absent because they have fields of
 * their own further up this panel; the price and the certification
 * marks because neither is a caption. Mirrors `REWRITABLE` in
 * TileEditor — the same rule, stated where each half of the editor can
 * see it.
 */
const REWRITABLE: readonly TilePart[] = [
  'brand', 'quantity', 'meta', 'tags',
];

/**
 * The per-tile panel.
 *
 * These edits are the "human finesse" the pipeline must not overwrite:
 * they live on the placement as overrides, so regenerating the geometry
 * does not silently discard a headline someone rewrote by hand.
 *
 * The panel is the precise half of the editing model — exact numbers,
 * every field in one place. The direct half lives on the tile itself
 * (see TileEditor): drag to pan, ⌘-wheel to zoom, double-click to
 * rewrite. Both write the same overrides, so neither is the "real" one.
 */
export function Inspector() {
  const {
    document, selectedOfferId, selectedPart, updateOverrides, updatePart,
    selectPart, resetPart, setPartHidden, resetTile, select,
  } = useStudio();

  if (!document || !selectedOfferId) {
    return (
      <aside className="inspector inspector--empty">
        <p>Klik på en vare for at rette den.</p>
        <ul className="inspector__keys">
          <li><b>Træk</b> en vare over på en anden for at bytte dem</li>
          <li><b>Klik</b> og træk igen for at flytte det du peger på</li>
          <li><b>⌘ + scroll</b> eller knib for at ændre størrelsen</li>
          <li><b>Dobbeltklik</b> på en tekst for at rette den på siden</li>
          <li><b>⌫</b> tager et element af siden — det kan hentes tilbage</li>
        </ul>
      </aside>
    );
  }

  const offer = document.offers.find((o) => o.id === selectedOfferId);
  const placement = document.pages
    .flatMap((page) => page.placements)
    .find((p) => p.offerId === selectedOfferId);

  if (!offer || !placement) {
    return (
      <aside className="inspector inspector--empty">
        <p>Varen er ikke længere på en side.</p>
      </aside>
    );
  }

  const { overrides } = placement;
  /*
   * The box the panel is currently about.
   *
   * `null` means the tile as a whole, which is the artwork — the same
   * reading the keyboard and the tile overlay use, so the sliders below
   * always drive the thing the arrow keys would move.
   */
  const held: TilePart = selectedPart ?? 'media';
  const geometry = partOverride(overrides, held);
  const limits = partLimits(held);
  const arranged = TILE_PARTS.some((part) => partTouched(overrides, part));

  return (
    <aside className="inspector">
      <header className="inspector__head">
        <h2>{overrides.displayName ?? offer.name}</h2>
        <button className="inspector__close" onClick={() => select(null)} aria-label="Luk">×</button>
      </header>

      <dl className="inspector__facts">
        <dt>Pris</dt><dd>{offer.price.toFixed(2)} {offer.currency}</dd>
        <dt>Kategori</dt><dd>{offer.category}</dd>
        <dt>Varenr.</dt><dd>{offer.id}</dd>
      </dl>

      <h3 className="inspector__group">Tekst</h3>

      <label className="inspector__field">
        <span>Overskrift på flisen</span>
        <input
          type="text"
          value={overrides.displayName ?? ''}
          placeholder={offer.name}
          onChange={(e) =>
            updateOverrides(offer.id, { displayName: e.target.value || null })}
        />
        <small>Tom = feedets egen tekst.</small>
      </label>

      <label className="inspector__field">
        <span>Underlinje</span>
        <input
          type="text"
          value={overrides.description ?? offer.description}
          placeholder={offer.description || 'ingen'}
          onChange={(e) => updateOverrides(offer.id, { description: e.target.value })}
        />
        <small>
          Tom = ingen underlinje.{' '}
          {overrides.description !== null && offer.description !== '' && (
            <button
              className="inspector__link"
              onClick={() => updateOverrides(offer.id, { description: null })}
            >Hent feedets tekst</button>
          )}
        </small>
      </label>

      <h3 className="inspector__group">
        Elementer
        {arranged && (
          <button className="inspector__link" onClick={() => resetTile(offer.id)}>
            Nulstil alle
          </button>
        )}
      </h3>

      {/*
        * Every box the tile draws, in the order it draws them.
        *
        * The panel lists them rather than only showing the one in hand,
        * because a box that has been taken off the page cannot be
        * clicked to get it back — and a hidden element with no way home
        * is a destructive edit wearing the clothes of a reversible one.
        */}
      <ul className="inspector__parts">
        {TILE_PARTS.map((part) => {
          const state = partOverride(overrides, part);
          const held = selectedPart === part || (selectedPart === null && part === 'media');
          return (
            <li
              key={part}
              className={[
                'inspector__part',
                held && 'is-held',
                state.hidden && 'is-hidden',
              ].filter(Boolean).join(' ')}
            >
              <button
                className="inspector__part-name"
                onClick={() => selectPart(part === 'media' ? null : part)}
              >
                {TILE_PART_NAMES[part]}
                {partTouched(overrides, part) && <i aria-hidden="true">•</i>}
              </button>
              {part !== 'media' && (
                <button
                  className="inspector__part-eye"
                  title={state.hidden ? 'Vis igen' : 'Tag af siden'}
                  aria-label={state.hidden ? 'Vis igen' : 'Tag af siden'}
                  onClick={() => setPartHidden(offer.id, part, !state.hidden)}
                >{state.hidden ? '◌' : '●'}</button>
              )}
            </li>
          );
        })}
      </ul>

      <h3 className="inspector__group">
        {TILE_PART_NAMES[held]}
        {partTouched(overrides, held) && (
          <button className="inspector__link" onClick={() => resetPart(offer.id, held)}>
            Nulstil
          </button>
        )}
      </h3>

      <label className="inspector__field">
        <span>Størrelse <b>{geometry.scale.toFixed(2)}×</b></span>
        <input
          type="range" min={limits.minScale} max={limits.maxScale} step={0.01}
          value={geometry.scale}
          onChange={(e) => updatePart(offer.id, held, { scale: Number(e.target.value) })}
        />
      </label>

      <label className="inspector__field">
        <span>Vandret <b>{geometry.offsetX.toFixed(2)}</b></span>
        <input
          type="range" min={-limits.reach} max={limits.reach} step={limits.step}
          value={geometry.offsetX}
          onChange={(e) => updatePart(offer.id, held, { offsetX: Number(e.target.value) })}
        />
      </label>

      <label className="inspector__field">
        <span>Lodret <b>{geometry.offsetY.toFixed(2)}</b></span>
        <input
          type="range" min={-limits.reach} max={limits.reach} step={limits.step}
          value={geometry.offsetY}
          onChange={(e) => updatePart(offer.id, held, { offsetY: Number(e.target.value) })}
        />
      </label>

      {/* Only for the boxes that keep their words on themselves. The
          headline and the underline have their own fields above, and
          the price and the certification marks are not captions. */}
      {REWRITABLE.includes(held) && (
        <label className="inspector__field">
          <span>Tekst</span>
          <input
            type="text"
            value={geometry.text ?? ''}
            placeholder="feedets egen"
            onChange={(e) => updatePart(offer.id, held, { text: e.target.value })}
          />
          <small>
            Tom = linjen falder væk.{' '}
            {geometry.text !== null && (
              <button
                className="inspector__link"
                onClick={() => updatePart(offer.id, held, { text: null })}
              >Hent feedets tekst</button>
            )}
          </small>
        </label>
      )}

      <label className="inspector__check">
        <input
          type="checkbox"
          checked={overrides.pinned}
          onChange={(e) => updateOverrides(offer.id, { pinned: e.target.checked })}
        />
        <span>Fastlås — må ikke flyttes ved næste generering</span>
      </label>

      {/* Written out because the tile is where the work happens, and a
          shortcut nobody is told about is a shortcut nobody uses. */}
      <ul className="inspector__keys">
        <li><b>Piletaster</b> flytter <b>{TILE_PART_NAMES[held]}</b> — med shift længere</li>
        <li><b>+</b> / <b>−</b> ændrer størrelsen, <b>0</b> nulstiller</li>
        <li><b>⌫</b> tager elementet af siden</li>
        <li><b>Dobbeltklik</b> retter teksten direkte på siden</li>
        <li><b>Esc</b> slipper elementet, så flisen</li>
      </ul>
    </aside>
  );
}
