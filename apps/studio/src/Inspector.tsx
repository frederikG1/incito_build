import { useState } from 'react';
import {
  TILE_PARTS, TILE_PART_NAMES, pageGround, partLimits, partOverride, partTouched,
} from '@incitio/schema';
import type { TilePart } from '@incitio/schema';
import { useStudio } from './state.js';

/**
 * The browser's own screen colour picker.
 *
 * Chromium only, which is what this editor is developed and printed in
 * — and the one that matters, because the whole point is to sample a
 * colour off the reference page displayed beside the rebuilt one, and
 * only a screen-wide picker can reach a pixel in another element's
 * image. Where it is missing, the swatch below is an ordinary
 * `input[type=color]` and nothing else changes.
 */
interface EyeDropperApi {
  new (): { open: () => Promise<{ sRGBHex: string }> };
}
const eyeDropper = (): EyeDropperApi | null =>
  (window as unknown as { EyeDropper?: EyeDropperApi }).EyeDropper ?? null;

/**
 * The page's field, and where to get it from.
 *
 * A page-level control living in the tile panel, because this is where
 * everything else about how the page looks is changed — and because the
 * colour it is usually being matched to is the reference page sitting
 * on the canvas two hundred pixels to the left. The pipette reads a
 * pixel straight off it.
 *
 * It writes `page.ground`, never the brand's tokens: the chain's
 * palette is its identity, and one rebuilt page is not a reason to
 * repaint every page the chain will ever print. Empty means the chain
 * decides, which is what every ordinary page does.
 */
function PageGround() {
  const { document, brand, selectedOfferId, setPageGround } = useStudio();
  const [dropping, setDropping] = useState(false);

  if (!document || !brand || document.pages.length === 0) return null;

  /*
   * The page the panel is about: the one holding the selected tile, or
   * the first one. A ground belongs to a page and the panel belongs to
   * a tile, so the tile is what says which page is meant — and with
   * nothing selected there is usually only one page anyway, because
   * that is what "genskab en side" produces.
   */
  const index = Math.max(
    0,
    document.pages.findIndex((page) =>
      page.placements.some((p) => p.offerId === selectedOfferId)),
  );
  const page = document.pages[index]!;
  const chains = pageGround(brand, index);
  const value = page.ground ?? chains;
  const pipette = eyeDropper();

  return (
    <>
      <h3 className="inspector__group">
        Sidens bund
        {page.ground && (
          <button className="inspector__link" onClick={() => setPageGround(page.id, null)}>
            Nulstil
          </button>
        )}
      </h3>

      <div className="ground">
        <label className="ground__swatch" style={{ background: value }}>
          <input
            type="color"
            value={value}
            onChange={(e) => setPageGround(page.id, e.target.value)}
            aria-label="Bundfarve"
          />
        </label>

        <input
          className="ground__hex"
          type="text"
          value={value}
          spellCheck={false}
          onChange={(e) => {
            const raw = e.target.value.trim();
            setPageGround(page.id, raw.startsWith('#') ? raw : `#${raw}`);
          }}
          aria-label="Hex-kode"
        />

        {pipette && (
          <button
            className="ground__pick"
            disabled={dropping}
            title="Hold pipetten over farven på referencen"
            onClick={async () => {
              setDropping(true);
              try {
                const picked = await new pipette().open();
                setPageGround(page.id, picked.sRGBHex);
              } catch {
                // Escape closes the picker and rejects. Nothing to say:
                // the user cancelled on purpose.
              } finally {
                setDropping(false);
              }
            }}
          >⌖ Pipette</button>
        )}
      </div>

      <p className="ground__note">
        {page.ground
          ? <>Sat på siden. {brand.name}s egen er <code>{chains}</code>.</>
          : <>{brand.name}s egen farve for side {index + 1}.</>}
        {pipette && ' Pipetten kan tage farven direkte fra referencebilledet.'}
      </p>
    </>
  );
}

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
        {/* Page-level, so it is reachable with nothing selected — which
            is the state a freshly rebuilt page opens in. */}
        <PageGround />
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

      <PageGround />

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
