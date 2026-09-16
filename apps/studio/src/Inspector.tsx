import { useState } from 'react';
import {
  PAGE_PARTS, PAGE_PART_NAMES, TILE_PARTS, TILE_PART_NAMES,
  pageGround, pageTextLimits, pageTextOverride, pageTextTouched,
  partLimits, partOverride, partTouched,
} from '@incitio/schema';
import type { CatalogPage, PagePart, TilePart } from '@incitio/schema';
import { useStudio } from './state.js';

/**
 * The page's own two lines: the heading, and the theme line under it.
 *
 * Listed rather than only shown when one is in hand, for the same
 * reason the tile lists its boxes: a line taken off the page cannot be
 * clicked to get it back, and a hidden element with no way home is a
 * destructive edit wearing the clothes of a reversible one.
 *
 * The words are typed here and in the sheet's own bar and on the page
 * itself — three doors into `page.title`/`page.subtitle`, which is one
 * string, so none of them can drift from the others.
 */
function PageTexts({ page }: { page: CatalogPage }) {
  const {
    selectedText, selectPageText, updatePageText, resetPageText, setPageTextHidden,
    setPageTitle, setPageSubtitle, endGesture,
  } = useStudio();

  const held: PagePart | null = selectedText?.pageId === page.id ? selectedText.part : null;
  const limits = pageTextLimits();

  return (
    <>
      <h3 className="inspector__group">Sidens tekster</h3>

      <ul className="inspector__parts">
        {PAGE_PARTS.map((part) => {
          const state = pageTextOverride(page, part);
          return (
            <li
              key={part}
              className={[
                'inspector__part',
                held === part && 'is-held',
                state.hidden && 'is-hidden',
              ].filter(Boolean).join(' ')}
            >
              <button
                className="inspector__part-name"
                onClick={() => selectPageText(page.id, held === part ? null : part)}
              >
                {PAGE_PART_NAMES[part]}
                {pageTextTouched(page, part) && <i aria-hidden="true">•</i>}
              </button>
              <button
                className="inspector__part-eye"
                title={state.hidden ? 'Vis igen' : 'Tag af siden'}
                aria-label={state.hidden ? 'Vis igen' : 'Tag af siden'}
                onClick={() => setPageTextHidden(page.id, part, !state.hidden)}
              >{state.hidden ? '◌' : '●'}</button>
            </li>
          );
        })}
      </ul>

      {held && (() => {
        const state = pageTextOverride(page, held);
        return (
          <>
            <h3 className="inspector__group">
              {PAGE_PART_NAMES[held]}
              {pageTextTouched(page, held) && (
                <button
                  className="inspector__link"
                  onClick={() => resetPageText(page.id, held)}
                >Nulstil</button>
              )}
            </h3>

            <label className="inspector__field">
              <span>Tekst</span>
              <input
                type="text"
                value={held === 'title' ? page.title : page.subtitle}
                placeholder={held === 'title' ? 'overskrift' : 'stemningslinje'}
                onChange={(e) => (held === 'title'
                  ? setPageTitle(page.id, e.target.value)
                  : setPageSubtitle(page.id, e.target.value))}
              />
              <small>Tom = linjen falder væk.</small>
            </label>

            <label className="inspector__field">
              <span>Størrelse <b>{state.scale.toFixed(2)}×</b></span>
              <input
                type="range" min={limits.minScale} max={limits.maxScale} step={0.01}
                value={state.scale}
                onChange={(e) => updatePageText(
                  page.id, held, { scale: Number(e.target.value) }, `text-scale:${page.id}:${held}`,
                )}
                onPointerUp={() => endGesture()}
              />
            </label>

            <label className="inspector__field">
              <span>Vandret <b>{state.offsetX.toFixed(2)}</b></span>
              <input
                type="range" min={-limits.reach} max={limits.reach} step={limits.step}
                value={state.offsetX}
                onChange={(e) => updatePageText(
                  page.id, held, { offsetX: Number(e.target.value) }, `text-move:${page.id}:${held}`,
                )}
                onPointerUp={() => endGesture()}
              />
            </label>

            <label className="inspector__field">
              <span>Lodret <b>{state.offsetY.toFixed(2)}</b></span>
              <input
                type="range" min={-limits.reach} max={limits.reach} step={limits.step}
                value={state.offsetY}
                onChange={(e) => updatePageText(
                  page.id, held, { offsetY: Number(e.target.value) }, `text-move:${page.id}:${held}`,
                )}
                onPointerUp={() => endGesture()}
              />
            </label>

            <ul className="inspector__keys">
              <li><b>Piletaster</b> flytter linjen — med shift længere</li>
              <li><b>+</b> / <b>−</b> ændrer størrelsen, <b>0</b> nulstiller</li>
              <li><b>⌫</b> tager linjen af siden</li>
              <li><b>Dobbeltklik</b> retter teksten direkte på siden</li>
              <li><b>Esc</b> slipper linjen</li>
            </ul>
          </>
        );
      })()}
    </>
  );
}

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
  const {
    document, brand, selectedOfferId, selectedText, setPageGround, setPageBackground,
  } = useStudio();
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
    // A line in hand names its own page — and is the one case where the
    // panel is about a page with nothing selected on it at all.
    selectedText
      ? document.pages.findIndex((page) => page.id === selectedText.pageId)
      : document.pages.findIndex((page) =>
        page.placements.some((p) => p.offerId === selectedOfferId)),
  );
  const page = document.pages[index]!;
  const chains = pageGround(brand, index);
  const value = page.ground ?? chains;
  const pipette = eyeDropper();

  return (
    <>
      {/* First, because it is what the page SAYS — the colour and the
          picture below are what it is printed on. */}
      <PageTexts page={page} />

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

      {/*
        * The picture under the sheet, and only its settings.
        *
        * The file itself is picked on the sheet's own bar, beside the
        * page it lands on — this panel is where it is then TUNED, which
        * is the same split as everywhere else in the editor: the
        * canvas takes the drop, the inspector takes the numbers.
        */}
      <h3 className="inspector__group">
        Baggrundsbillede
        {page.background && (
          <button className="inspector__link" onClick={() => setPageBackground(page.id, null)}>
            Fjern
          </button>
        )}
      </h3>

      {!page.background ? (
        <p className="ground__note">
          Ingen. Vælg <b>Baggrund</b> over siden for at lægge et billede under hele arket.
        </p>
      ) : (
        <>
          <label className="inspector__field">
            <span>Udfyldning</span>
            <select
              value={page.background.fit}
              onChange={(e) => setPageBackground(
                page.id,
                { fit: e.target.value as 'cover' | 'contain' | 'tile' },
              )}
            >
              <option value="cover">Fylder arket (beskæres)</option>
              <option value="contain">Hele billedet</option>
              <option value="tile">Gentaget mønster</option>
            </select>
            <small>{page.background.subject || 'uden navn'}</small>
          </label>

          <label className="inspector__field">
            <span>Gennemsigtighed {Math.round(page.background.opacity * 100)}%</span>
            <input
              type="range"
              min={5}
              max={100}
              step={1}
              value={Math.round(page.background.opacity * 100)}
              onChange={(e) => setPageBackground(
                page.id,
                { opacity: Number(e.target.value) / 100 },
                `background-opacity:${page.id}`,
              )}
            />
            <small>Skru ned, hvis billedet slår priserne ihjel.</small>
          </label>

          {/* Only for `cover`: that is the one fit where the sheet's
              aspect and the photograph's disagree and something is
              always cut away. `contain` shows all of it and `tile`
              starts in the corner — a crop control there would move
              nothing. */}
          {page.background.fit === 'cover' && (
            <>
              <label className="inspector__field">
                <span>Udsnit vandret {page.background.focusX}%</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={page.background.focusX}
                  onChange={(e) => setPageBackground(
                    page.id,
                    { focusX: Number(e.target.value) },
                    `background-focus:${page.id}`,
                  )}
                />
              </label>
              <label className="inspector__field">
                <span>Udsnit lodret {page.background.focusY}%</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={page.background.focusY}
                  onChange={(e) => setPageBackground(
                    page.id,
                    { focusY: Number(e.target.value) },
                    `background-focus:${page.id}`,
                  )}
                />
              </label>
            </>
          )}
        </>
      )}
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
    selectPart, resetPart, setPartHidden, resetTile, select, focusOffer,
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
          <li><b>Overskriften</b> og stemningslinjen trækkes på samme måde</li>
        </ul>
      </aside>
    );
  }

  const offer = document.offers.find((o) => o.id === selectedOfferId);
  const onPage = document.pages
    .find((page) => page.placements.some((p) => p.offerId === selectedOfferId));
  const placement = onPage?.placements.find((p) => p.offerId === selectedOfferId);
  /*
   * Whether it already leads. The lead is the FIRST placement, which is
   * how `focusOffer` seats it — see the swap there; a button that
   * promotes something already at the top is a click that does nothing.
   */
  const leads = onPage?.placements[0]?.offerId === selectedOfferId;

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

      {/*
        * Promote this offer to its page's leading slot.
        *
        * It used to sit on every sheet's bar, where it acted on the
        * SELECTION and was therefore disabled on all but one sheet at a
        * time — a control that is grey on nine pages out of ten teaches
        * people to stop reading the row it is in. Here it is beside
        * everything else that acts on the selected offer, and it is
        * only drawn when there is a page it could move it on.
        */}
      {onPage && (
        <button
          className="inspector__promote"
          onClick={() => focusOffer(onPage.id, offer.id)}
          disabled={leads}
          title={leads
            ? 'Varen fører allerede siden'
            : 'Byt varen op i sidens hovedplads'}
        >
          {leads ? 'Fører siden' : 'Sæt i fokus'}
        </button>
      )}

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
