import { useEffect, useState } from 'react';
import {
  PAGE_PARTS, PAGE_PART_NAMES, TILE_PARTS, TILE_PART_NAMES,
  packLimits, packOverride, packTouched,
  pageGround, pageTextLimits, pageTextOverride, pageTextTouched,
  partLimits, partOverride, partTouched,
} from '@incitio/schema';
import type { CatalogPage, PagePart, PlacementOverrides, TilePart } from '@incitio/schema';
import { PLACE_PROMPTS, placePrompt } from '@incitio/curator/place-prompt';
import { useStudio } from './state.js';
import { priceOf, saidPrice } from './price.js';

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
    spreadBackground,
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
          Ingen. Tryk <b>Billeder</b> over siden for at lægge et billede under hele arket.
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

          {/*
            * The same backdrop under the rest of the book.
            *
            * An avis has one look, and setting it a page at a time is
            * a file picker, four sliders and a scroll, once per sheet.
            * Copies what was decided here as well as the picture, so
            * the other pages get the fit and the strength that were
            * tuned on this one — and it is one undo step.
            */}
          <div className="inspector__spread">
            <button
              className="inspector__link"
              onClick={() => spreadBackground(page.id, 'resten')}
            >Brug på resten af avisen</button>
            <button
              className="inspector__link"
              onClick={() => spreadBackground(page.id, 'alle')}
            >på alle sider</button>
          </div>
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
/**
 * Every product's depth in one cluster, so "in front" means in front of
 * THESE. A pack nobody has ordered reads as a row of zeros, which is
 * what makes the first press land on 1 rather than on nothing.
 */
function packDepths(overrides: PlacementOverrides, count: number): number[] {
  return Array.from({ length: Math.max(count, 1) }, (_, index) => (
    packOverride(overrides, index).depth
  ));
}

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

function DecorInspector({ decorId }: { decorId: string }) {
  const {
    document, updatePageImage, removePageImage, selectDecor, endGesture,
  } = useStudio();
  const page = document?.pages.find((entry) => entry.decorations.some((d) => d.id === decorId));
  const decor = page?.decorations.find((d) => d.id === decorId);
  if (!page || !decor) return null;
  const set = (patch: Parameters<typeof updatePageImage>[2]) => updatePageImage(page.id, decor.id, patch);
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
      <button className="inspector__drop" onClick={() => removePageImage(page.id, decor.id)}>
        Tag af siden
      </button>

      <ul className="inspector__keys">
        <li><b>Træk</b> billedet på siden for at flytte det</li>
        <li><b>Piletaster</b> flytter det — med shift længere</li>
        <li><b>+ / −</b> ændrer størrelsen, <b>[ ]</b> drejer, <b>0</b> retter det op</li>
        <li><b>⌫</b> tager det af siden</li>
        <li><b>Esc</b> slipper det, så det lægger sig på plads</li>
      </ul>
    </aside>
  );
}

/*
 * Free text on the page, in hand. The words are typed here and show on
 * the sheet as they are typed; the box is dragged on the sheet itself.
 */
const NOTE_INKS = ['#16181d', '#ffffff', '#c31414', '#871623', '#1c5c34'];
const NOTE_BACKINGS: [string | null, string][] = [
  [null, 'Ingen'], ['#ffffff', 'Hvid'], ['#c31414', 'Rød'], ['#16181d', 'Sort'], ['#fff1b8', 'Gul'],
];

function NoteInspector({ noteId }: { noteId: string }) {
  const { document, updateNote, removeNote, selectNote, endGesture } = useStudio();
  const page = document?.pages.find((entry) => (entry.notes ?? []).some((n) => n.id === noteId));
  const note = page?.notes.find((n) => n.id === noteId);
  if (!page || !note) return null;
  const set = (patch: Parameters<typeof updateNote>[2], gesture?: string) =>
    updateNote(page.id, note.id, patch, gesture);

  return (
    <aside className="inspector">
      <header className="inspector__head">
        <h2>Tekst på siden</h2>
        <button className="inspector__close" onClick={() => selectNote(null)} aria-label="Luk">×</button>
      </header>
      <p className="inspector__meta">Træk den rundt på siden · piletaster flytter den</p>

      <label className="inspector__field">
        <span>Tekst</span>
        <textarea
          className="notepanel__text"
          value={note.text}
          rows={3}
          autoFocus
          onFocus={(event) => { if (event.target.value === 'Skriv din tekst') event.target.select(); }}
          onChange={(event) => set({ text: event.target.value }, `note-text:${note.id}`)}
          onBlur={endGesture}
        />
      </label>

      <label className="inspector__field">
        <span>Størrelse <b>{Math.round(note.size * 1000) / 10}</b></span>
        <input
          type="range" min={0.8} max={16} step={0.1} value={note.size * 100}
          onChange={(e) => set({ size: Number(e.target.value) / 100 })}
          onPointerUp={endGesture}
        />
      </label>
      <label className="inspector__field">
        <span>Bredde <b>{Math.round(note.w * 100)} %</b></span>
        <input
          type="range" min={5} max={100} value={Math.round(note.w * 100)}
          onChange={(e) => set({ w: Number(e.target.value) / 100 })}
          onPointerUp={endGesture}
        />
      </label>
      <label className="inspector__field">
        <span>Drejning <b>{note.rotate}°</b></span>
        <input
          type="range" min={-45} max={45} value={note.rotate}
          onChange={(e) => set({ rotate: Number(e.target.value) })}
          onPointerUp={endGesture}
        />
      </label>

      <div className="inspector__field">
        <span>Farve</span>
        <div className="notepanel__swatches">
          {NOTE_INKS.map((ink) => (
            <button
              key={ink}
              className={note.color === ink ? 'is-on' : ''}
              style={{ background: ink }}
              title={ink}
              onClick={() => set({ color: ink })}
            />
          ))}
          <input type="color" value={note.color} onChange={(e) => set({ color: e.target.value }, `note-ink:${note.id}`)} title="Anden farve" />
        </div>
      </div>

      <div className="inspector__field">
        <span>Bagved</span>
        <div className="segment" role="group" aria-label="Bagved">
          {NOTE_BACKINGS.map(([backing, name]) => (
            <button
              key={name}
              className={note.background === backing ? 'is-on' : ''}
              onClick={() => set({ background: backing, h: backing ? note.h : note.h })}
            >{name}</button>
          ))}
        </div>
      </div>

      <div className="inspector__field">
        <span>Skrift</span>
        <div className="segment" role="group" aria-label="Skrift">
          <button className={note.bold ? 'is-on' : ''} onClick={() => set({ bold: !note.bold })}><b>Fed</b></button>
          {(['left', 'center', 'right'] as const).map((align) => (
            <button
              key={align}
              className={note.align === align ? 'is-on' : ''}
              title={align === 'left' ? 'Venstre' : align === 'right' ? 'Højre' : 'Midte'}
              onClick={() => set({ align })}
            >{align === 'left' ? '⇤' : align === 'right' ? '⇥' : '↔'}</button>
          ))}
        </div>
      </div>

      <button className="inspector__drop" onClick={() => removeNote(page.id, note.id)}>
        Tag af siden
      </button>
    </aside>
  );
}

type InspectorTab = 'indhold' | 'billede' | 'bokse';
const INSPECTOR_TABS: [InspectorTab, string][] = [
  ['indhold', 'Indhold'],
  ['billede', 'Billede'],
  ['bokse', 'Bokse'],
];

export function Inspector() {
  // Shut by default: the prompt is three hundred words, and most
  // sessions never open it.
  const [showPrompt, setShowPrompt] = useState(false);
  const {
    document, selectedOfferId, selectedPart, updateOverrides, updatePart,
    selectPart, resetPart, setPartHidden, resetTile, select, focusOffer,
    removeOfferFromPage,
    selectedPack, selectPackItem, updatePackItem, resetPackItem, setPackItemHidden,
    endGesture, setTileImage, applyClusterLayout,
    ghosts, toggleGhost,
    clusterWay, setClusterWay, clusterImageModel, setClusterImageModel, clusterRun,
    clusterPlaceModel, setClusterPlaceModel, clusterPrompt, setClusterPrompt, promptRuns,
    placeStrict, setPlaceStrict,
    clusterPromptId, setClusterPromptId,
    standUpOneCluster, busy, decorReady, selectedDecorId, selectedNoteId, splitAndStandUp,
  } = useStudio();
  const [tab, setTab] = useState<InspectorTab>('indhold');
  /*
   * The tab follows the hand. Clicking a box on the sheet, or a product
   * in a pack, picks up something that lives in another tab — and the
   * sliders for it being one click away is the old below-the-fold
   * problem again.
   */
  useEffect(() => {
    if (selectedPart !== null) setTab('bokse');
  }, [selectedPart]);
  useEffect(() => {
    if (selectedPack !== null) setTab('billede');
  }, [selectedPack]);

  // Nothing selected — or a selection that no page holds any more,
  // as after a cell is refilled — shows the page's own panel.
  const nothing = (
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

  if (selectedNoteId) return <NoteInspector noteId={selectedNoteId} />;
  if (selectedDecorId) return <DecorInspector decorId={selectedDecorId} />;
  if (!document || !selectedOfferId) return nothing;

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

  if (!offer || !placement) return nothing;

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

      {/*
        * One line of facts instead of a three-row table, and then three
        * tabs.
        *
        * The panel stacked nine sections for one selected vare — its
        * words, its pack, every box, the model, the page's own ground —
        * and the one somebody wanted was always below the fold. The
        * tabs split it by what you are touching: what the tile SAYS,
        * the pictures in it, and the boxes it is built from. Nothing
        * left; it is sorted.
        */}
      <p className="inspector__meta" title={`Varenr. ${offer.id}`}>
        {[
          `felt ${placement.slotId}`,
          `${offer.price.toFixed(2).replace('.', ',')} ${offer.currency}`,
          offer.category,
        ].filter(Boolean).join(' · ')}
      </p>
      <div className="inspector__tabs" role="tablist">
        {INSPECTOR_TABS.map(([id, name]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? 'is-on' : ''}
            onClick={() => setTab(id)}
          >{name}</button>
        ))}
      </div>


      {tab === 'billede' && (
      <>
      {/*
        * The products in the tile, and then the one in hand — first,
        * before anything else the panel can do.
        *
        * They used to sit two thirds of the way down, under the page's
        * texts, the page's ground and the page's background picture. A
        * person clicks a VARE and the panel answered with questions
        * about the sheet: everything about the thing they had just
        * pointed at was below the fold. Now the panel opens with what
        * is in the tile, which of them is in hand, and what can be done
        * to it — and the page's own settings wait at the bottom, where
        * something you change once per sheet belongs.
        */}
      {offer.imagePack.length > 1 && (
        <>
          <h3 className="inspector__group">
            Varer i flisen
            <span className="inspector__count">{offer.imagePack.length}</span>
          </h3>
          <ul className="inspector__pack">
            {offer.imagePack.map((url, index) => {
              const state = packOverride(overrides, index);
              const member = offer.members[index];
              return (
                <li
                  key={`${index}-${url}`}
                  className={[
                    'inspector__packitem',
                    selectedPack === index && 'is-held',
                    state.hidden && 'is-hidden',
                  ].filter(Boolean).join(' ')}
                >
                  <button
                    className="inspector__packshot"
                    title={member ? `Vare ${index + 1} · ${member}` : `Vare ${index + 1}`}
                    onClick={() => selectPackItem(selectedPack === index ? null : index)}
                  >
                    <img src={url} alt="" />
                    {packTouched(overrides, index) && <i aria-hidden="true">•</i>}
                  </button>
                  <button
                    className="inspector__part-eye"
                    title={state.hidden ? 'Vis igen' : 'Tag af siden'}
                    aria-label={state.hidden ? 'Vis igen' : 'Tag af siden'}
                    onClick={() => setPackItemHidden(offer.id, index, !state.hidden)}
                  >{state.hidden ? '◌' : '●'}</button>
                </li>
              );
            })}
          </ul>
          <p className="inspector__packsay">
            {selectedPack === null
              ? 'Klik en vare for at flytte, skalere eller lægge den forrest.'
              : `Vare ${selectedPack + 1} er i hånden — rettelserne står herunder.`}
          </p>
        </>
      )}

      {selectedPack !== null && offer.imagePack[selectedPack] !== undefined && (
        <>
          <h3 className="inspector__group">
            Vare {selectedPack + 1}
            {packTouched(overrides, selectedPack) && (
              <button
                className="inspector__link"
                onClick={() => resetPackItem(offer.id, selectedPack)}
              >Nulstil</button>
            )}
          </h3>
          {(() => {
            const state = packOverride(overrides, selectedPack);
            const limit = packLimits();
            const set = (patch: Partial<typeof state>) =>
              updatePackItem(offer.id, selectedPack, patch);
            return (
              <>
                {/*
                  * Which product stands in front.
                  *
                  * Buttons and not a slider: nobody thinks "layer
                  * three", they think "the pears in front of the kale".
                  * Each press moves this product one step past the
                  * product that is currently nearest the front, or
                  * behind the one furthest back — see
                  * `PackOverride.depth`.
                  */}
                <div className="inspector__field">
                  <span>Foran eller bag de andre</span>
                  <div className="segment" role="group" aria-label="Dybde">
                    <button
                      className={state.depth > 0 ? 'is-on' : ''}
                      title="Stil varen foran de andre"
                      onClick={() => set({ depth: Math.min(
                        limit.depth,
                        Math.max(...packDepths(overrides, offer.imagePack.length)) + 1,
                      ) })}
                    >Forrest</button>
                    <button
                      className={state.depth === 0 ? 'is-on' : ''}
                      title="Lad stilarket bestemme — den midterste vare står forrest"
                      onClick={() => set({ depth: 0 })}
                    >Auto</button>
                    <button
                      className={state.depth < 0 ? 'is-on' : ''}
                      title="Stil varen bag de andre"
                      onClick={() => set({ depth: Math.max(
                        -limit.depth,
                        Math.min(...packDepths(overrides, offer.imagePack.length)) - 1,
                      ) })}
                    >Bagest</button>
                  </div>
                </div>

                <label className="inspector__field">
                  <span>Størrelse <b>{state.scale.toFixed(2)}×</b></span>
                  <input
                    type="range" min={limit.minScale} max={limit.maxScale} step={0.01}
                    value={state.scale}
                    onChange={(e) => set({ scale: Number(e.target.value) })}
                    onPointerUp={endGesture}
                  />
                </label>
                <label className="inspector__field">
                  <span>Vandret <b>{state.offsetX.toFixed(1)}</b></span>
                  <input
                    type="range" min={-limit.reach} max={limit.reach} step={limit.step}
                    value={state.offsetX}
                    onChange={(e) => set({ offsetX: Number(e.target.value) })}
                    onPointerUp={endGesture}
                  />
                </label>
                <label className="inspector__field">
                  <span>Lodret <b>{state.offsetY.toFixed(1)}</b></span>
                  <input
                    type="range" min={-limit.reach} max={limit.reach} step={limit.step}
                    value={state.offsetY}
                    onChange={(e) => set({ offsetY: Number(e.target.value) })}
                    onPointerUp={endGesture}
                  />
                </label>
                {/* The one box besides a decoration that may sit
                    off-square: a product pasted onto a page is what a
                    printed leaflet tilts, and nothing else. */}
                <label className="inspector__field">
                  <span>Drejning <b>{state.rotate.toFixed(0)}°</b></span>
                  <input
                    type="range" min={-limit.turn} max={limit.turn} step={1}
                    value={state.rotate}
                    onChange={(e) => set({ rotate: Number(e.target.value) })}
                    onPointerUp={endGesture}
                  />
                </label>
              </>
            );
          })()}
        </>
      )}
      </>
      )}


      {tab === 'indhold' && (
      <>
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

      {/*
        * Take the product off the page.
        *
        * Not a deletion: it goes to the bench — every offer in the
        * document that no page shows — so it can be dealt out again
        * here or on another page, and the count in the toolbar says how
        * many are waiting. The cell it leaves stays empty rather than
        * the page reflowing, because a page somebody is editing should
        * not rearrange itself under their hands.
        */}
      {onPage && (
        <button
          className="inspector__drop"
          onClick={() => removeOfferFromPage(onPage.id, offer.id)}
          title="Varen bliver i avisen og går i reserve"
        >
          Tag af siden
        </button>
      )}

      <label className="inspector__check">
        <input
          type="checkbox"
          checked={overrides.pinned}
          onChange={(e) => updateOverrides(offer.id, { pinned: e.target.checked })}
        />
        <span>Fastlås — må ikke flyttes ved næste generering</span>
      </label>
      </>
      )}

      {tab === 'bokse' && (
      <>
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
      </>
      )}

      {tab === 'billede' && (
      <>
      {/*
        * The products inside a cluster, when the tile draws one.
        *
        * Listed for the same reason the boxes above are: a variant
        * taken off the page cannot be clicked to get it back. It is
        * also the only place the pack's order is visible, which is what
        * decides who stands at the front — see the stacking note in
        * `OfferTile`.
        */}
      {/*
        * Running the composition by hand.
        *
        * The image model is billing-gated on Google's side, and waiting
        * for a billing account is not a reason to be unable to see
        * whether the prompt works. Everything here exists so the same
        * job can be done in Gemini's own app: the prompt as the server
        * would have sent it, the cutouts numbered in the order the
        * prompt names them, and a way back in for the result.
        */}
      {/*
        * One picture, several variants — three bottles in one packshot.
        * The arrangement below works on separate cutouts, so this cuts
        * the picture into one per variant first, then stands them up.
        */}
      {offer.members.length <= 1 && (offer.imageUrl || offer.imagePack.length > 1) && (
        <div className="way way--split">
          <h3 className="inspector__group">Stil op med Gemini</h3>
          <button
            className="way__go"
            disabled={Boolean(busy) || !decorReady}
            title={decorReady ? 'Gemini stiller varerne i billedet op i feltet (G)' : 'Kræver en Gemini-nøgle'}
            onClick={() => void splitAndStandUp(offer.id)}
          >
            Stil op med Gemini
          </button>
          <p className="way__aside">
            Varerne i billedet stilles op som en tilbudsavis — og kan bagefter flyttes
            hver for sig. Prisen og teksten er de samme.
          </p>
        </div>
      )}

      {offer.members.length > 1 && (
        <>
          <h3 className="inspector__group">Gemini</h3>

          {/*
            * One box, because it is one decision with one button.
            *
            * Gemini does both jobs here now: the arrangement is asked
            * for as numbers from a text-and-vision model, which has a
            * free tier, and only the round trip reaches an image
            * model, which does not. The controls say which is which,
            * and the line after a run says what actually happened —
            * including when a busy model handed the job on.
            */}
          <div className="way">
            <button
              className="way__go"
              disabled={Boolean(busy) || (clusterWay === 'rundtur' && !decorReady)}
              title={clusterWay === 'rundtur' && !decorReady
                ? 'Rundturen kræver en Gemini-nøgle'
                : 'Lad Gemini stille denne flises varer op'}
              onClick={() => void standUpOneCluster(offer.id)}
            >
              {clusterWay === 'koordinater' ? 'Stil op med Gemini' : 'Tegn og mål med Gemini'}
            </button>

            <label className="way__field">
              <span>Metode</span>
              <select
                value={clusterWay}
                onChange={(event) => setClusterWay(event.target.value as typeof clusterWay)}
              >
                <option value="koordinater">Koordinater — ét kald, intet billede</option>
                <option value="rundtur">Rundtur — tegn billedet og mål det</option>
              </select>
            </label>

            {clusterWay === 'koordinater' ? (
              <label className="way__field">
                <span>Opstillingsmodel</span>
                <select
                  value={clusterPlaceModel}
                  onChange={(event) => setClusterPlaceModel(event.target.value)}
                >
                  <option value="">gemini-3.8-flash — standard</option>
                  <option value="gemini-3.7-flash">gemini-3.7-flash</option>
                  <option value="gemini-3-flash-preview">gemini-3-flash-preview</option>
                  <option value="gemini-3.5-flash-lite">gemini-3.5-flash-lite — hurtigst</option>
                </select>
                {/*
                  * Whether a busy model may be stepped over.
                  *
                  * On by default here, because the whole reason to
                  * pick a model is to see what THAT model does — and
                  * a reserve that quietly answers instead turns the
                  * comparison into a comparison of nothing. Measured:
                  * two runs asking for 3.8-flash took 49 s and 67 s
                  * and were both answered by flash-lite.
                  */}
                <label className="way__strict" title={placeStrict
                  ? 'Kun den valgte model svarer. Er den optaget, fejler kørslen og siger det.'
                  : 'Er den valgte model optaget, svarer den næste i rækken i stedet'}>
                  <input
                    type="checkbox"
                    checked={placeStrict}
                    onChange={(event) => setPlaceStrict(event.target.checked)}
                  />
                  <span>kun denne model — ingen reserve</span>
                </label>
              </label>
            ) : (
              <label className="way__field">
                <span>Billedmodel</span>
                <select
                  value={clusterImageModel}
                  onChange={(event) => setClusterImageModel(event.target.value)}
                >
                  <option value="">Serverens standard</option>
                  <option value="gemini-3.1-flash-image">gemini-3.1-flash-image</option>
                  <option value="gemini-3-pro-image">gemini-3-pro-image</option>
                  <option value="nano-banana-pro-preview">nano-banana-pro-preview</option>
                </select>
              </label>
            )}

            <p className="way__aside">
              {clusterWay === 'koordinater'
                ? 'Gemini ser udklippene og siger hvor hver vare skal stå. Tekstmodellen'
                  + ' er med i gratis-niveauet; er den optaget, sendes kaldet videre til'
                  + ' den næste model, og linjen nedenfor siger hvem der svarede.'
                : 'Gemini tegner først et fotografi og måler det bagefter. Billedmodellerne'
                  + ' har ingen gratis-kvote — de kræver fakturering på Google-projektet.'}
            </p>

            {/*
              * What the last run did. Measured: the model that
              * answered, its own token count and the wall clock.
              *
              * And, on its own line under them, what it cost. That one
              * is an ESTIMATE and says so — list price by the token,
              * converted at a fixed rate (see `price.ts`) — because
              * the only figure that is actually true is the bill. It
              * is worth having anyway: a tile that quietly costs forty
              * times the one before it should be visible while
              * somebody is still iterating on it.
              */}
            {clusterRun && (
              <div className="way__run">
                <p>
                  {(clusterRun.elapsedMs / 1000).toFixed(1)}s
                  {clusterRun.model ? ` · ${clusterRun.model}` : ''}
                  {/* Not a footnote: this is the line that says the
                      tile in front of you was not made by the model
                      you chose. */}
                  {clusterRun.insteadOf
                    ? <b className="way__swap"> ⚠ ikke {clusterRun.insteadOf} — den var optaget</b>
                    : ''}
                  {clusterRun.drawnBy ? ` · tegnet af ${clusterRun.drawnBy}` : ''}
                  {clusterRun.tokens ? ` · ${(clusterRun.tokens / 1000).toFixed(1)}k tokens` : ''}
                  {clusterRun.view === 'top' ? ' · fladt, set oppefra' : ''}
                  {clusterRun.view === 'side' ? ' · stående på én linje' : ''}
                </p>
                {clusterRun.tokens !== null && (() => {
                  const dkk = priceOf(
                    clusterRun.model, clusterRun.inputTokens, clusterRun.outputTokens,
                  );
                  return (
                    <p className="way__price">
                      {dkk === null
                        // Never a guessed number: a price in kroner
                        // that was invented looks like one that was
                        // measured.
                        ? `ingen pris for ${clusterRun.model} — tilføj den i price.ts`
                        : (
                          <>
                            {saidPrice(dkk)} <i>anslået</i>
                            {' · '}
                            {(clusterRun.inputTokens / 1000).toFixed(1)}k ind
                            {' / '}
                            {(clusterRun.outputTokens / 1000).toFixed(1)}k ud
                          </>
                        )}
                    </p>
                  );
                })()}
                <p>
                  Stillede {clusterRun.placed} af {clusterRun.of} varer op.
                  {clusterRun.order.length > 0
                    && ` Bagest først: ${clusterRun.order.join(' · ')}.`}
                </p>
                {clusterRun.complaints.map((said) => (
                  <p className="way__warn" key={said}>⚠ {said}</p>
                ))}
              </div>
            )}

            {/*
              * The prompt, where the person looking at the tile is.
              *
              * This is the fastest loop anybody has found for making a
              * tile better — change a line, press the button, look —
              * and it was only possible in the repository until now.
              * Empty means the standing prompt; what is typed here
              * replaces it for this browser until it is cleared.
              */}
            {/*
              * Which of the standing prompts this tile is made with.
              *
              * Two ways of saying the same craft — numbered rules, or
              * the same thing told in sentences — and a model does not
              * read the two the same way. Kept as a switch rather than
              * a decision taken once in the repository: the only place
              * the question can be answered is on a tile, and picking
              * one must never be what loses the other.
              */}
            <div className="way__prompt">
              <span className="way__which">Prompt</span>
              <div className="segment">
                {PLACE_PROMPTS.map((entry) => (
                  <button
                    key={entry.id}
                    className={clusterPromptId === entry.id ? 'is-on' : ''}
                    title={entry.said}
                    onClick={() => setClusterPromptId(entry.id)}
                  >
                    {entry.name}
                  </button>
                ))}
              </div>
              {clusterPrompt && <span className="way__badge">din egen bruges</span>}
            </div>

            <div className="way__prompt">
              <button className="inspector__link" onClick={() => setShowPrompt(!showPrompt)}>
                {showPrompt ? 'Skjul prompten' : 'Vis prompten'}
              </button>
            </div>

            {showPrompt && (
              <>
                {/* The chosen one, until somebody types over it — and
                    then what they typed, for every run, whichever
                    button is lit. */}
                <textarea
                  className="way__text"
                  value={clusterPrompt || placePrompt(clusterPromptId)}
                  spellCheck={false}
                  onChange={(event) => setClusterPrompt(event.target.value)}
                />
                <div className="way__prompt">
                  <button
                    className="inspector__link"
                    disabled={!clusterPrompt}
                    onClick={() => setClusterPrompt('')}
                  >Tilbage til “{PLACE_PROMPTS.find((e) => e.id === clusterPromptId)?.name}”</button>
                </div>

                {/*
                  * The last few runs.
                  *
                  * A prompt is improved by changing a line and
                  * looking — which needs the line before it to still
                  * be somewhere. Each row says what it produced, and
                  * Hent puts those words back in the box so the two
                  * can be run against the same tile.
                  */}
                {promptRuns.length > 0 && (
                  <ol className="way__runs">
                    {promptRuns.map((run) => (
                      <li key={run.at}>
                        <span>
                          {new Date(run.at).toLocaleTimeString('da-DK', {
                            hour: '2-digit', minute: '2-digit',
                          })}
                          {' · '}{run.placed}/{run.of} varer
                          {' · '}{(run.elapsedMs / 1000).toFixed(0)}s
                          {' · '}{run.model || 'standard'}
                          {/* What it was made with: a hand-written
                              prompt, or one of the shipped ones by
                              name. A run from before there were two
                              can only say "standard". */}
                          {' · '}
                          {run.prompt
                            ? 'din prompt'
                            : PLACE_PROMPTS.find((e) => e.id === run.promptId)?.name
                              ?? 'standard'}
                        </span>
                        <button
                          className="inspector__link"
                          disabled={run.prompt === clusterPrompt}
                          onClick={() => setClusterPrompt(run.prompt)}
                          title={run.prompt
                            ? 'Læg denne prompt tilbage i feltet'
                            : 'Tilbage til standardprompten'}
                        >Hent</button>
                      </li>
                    ))}
                  </ol>
                )}
              </>
            )}
          </div>

          {/*
            * The proof, when there is one.
            *
            * Only the round trip makes a picture, and this is what it
            * is FOR: laid over the tile, a product that landed where
            * the composition put it lies inside its own photograph,
            * and one that did not stands beside it. Nothing else in
            * this panel can tell the two apart.
            */}
          {(() => {
            const ghost = ghosts.find((entry) => entry.offerId === offer.id);
            return ghost && (
            <div className="proof">
              <button
                className="inspector__link"
                title="Læg Geminis billede over flisen, så du kan se om varerne står som på det"
                onClick={() => toggleGhost(offer.id)}
              >
                {ghost.shown ? 'Skjul Geminis billede' : 'Vis Geminis billede over flisen'}
              </button>
              {/* What the arithmetic did, for the tile that comes out
                  wrong — see `reference.report`. */}
              <textarea
                className="proof__numbers"
                readOnly
                value={ghost.report.join('\n')}
              />
              <button
                className="inspector__link"
                onClick={() => {
                  void navigator.clipboard?.writeText(ghost.report.join('\n'));
                }}
              >Kopiér tallene</button>
            </div>
            );
          })()}

          {/*
            * A picture from outside, and the two things it can be.
            *
            * What used to stand here was the way round a key that
            * could not draw: the prompt and the numbered cutouts, to
            * be run in Gemini's own app by hand. The key draws now,
            * and the studio does the whole job in one press, so that
            * detour is gone. What is left is the case it never
            * covered — a designer with a photograph of their own.
            */}
          <h3 className="inspector__group">Eget billede</h3>

          <label className="drop drop--layout">
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) await applyClusterLayout(offer.id, file);
              }}
            />
            <span>
              Brug billedet som opstilling
              <em>dine egne udklip flytter sig — intet gentegnet</em>
            </span>
          </label>

          <label className="drop">
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) await setTileImage(offer.id, file);
              }}
            />
            <span>
              Læg billedet på flisen som det er
              <em>billedets egne pixels, etiketter og alt</em>
            </span>
          </label>
        </>
      )}

      {/* The SHEET's own settings, at the foot of a panel about a vare.
          They are reachable from here because a page has no other panel
          — but they are set once per sheet and asked about last. */}
      <PageGround />
      </>
      )}

      {tab === 'bokse' && (
      <>
      {/*
        * The four sliders for the variant in hand.
        *
        * Drawn instead of the box's own, not beside them: with a
        * product picked up, "size" means that product, and two panels
        * both called Størrelse is the ambiguity this panel exists to
        * remove.
        */}
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
      </>
      )}

      {/* Written out because the tile is where the work happens, and a
          shortcut nobody is told about is a shortcut nobody uses. */}
      <ul className="inspector__keys">
        <li><b>Piletaster</b> flytter <b>{TILE_PART_NAMES[held]}</b> — med shift længere</li>
        <li><b>+</b> / <b>−</b> ændrer størrelsen, <b>0</b> nulstiller</li>
        <li><b>⌫</b> tager elementet af siden</li>
        <li><b>Dobbeltklik</b> retter teksten direkte på siden</li>
        <li><b>Esc</b> slipper elementet, så flisen</li>
        {offer.members.length > 1 && (
          <li><b>G</b> stiller varerne op igen med Gemini</li>
        )}
      </ul>
    </aside>
  );
}
