import { useState } from 'react';
import { PAGE_PARTS, PAGE_PART_NAMES, pageGround, pageTextLimits, pageTextOverride, pageTextTouched } from '@incitio/schema';
import type { CatalogPage, PagePart } from '@incitio/schema';
import { useStudio, useStudioPick } from '../state.js';

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
  const { selectedText, selectPageText, updatePageText, resetPageText, setPageTextHidden, setPageTitle, setPageSubtitle, endGesture } = useStudioPick('selectedText', 'selectPageText', 'updatePageText', 'resetPageText', 'setPageTextHidden', 'setPageTitle', 'setPageSubtitle', 'endGesture');

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
                placeholder={held === 'title' ? 'overskrift' : 'underoverskrift'}
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

            <details className="inspector__keysbox">
              <summary>Genveje</summary>
              <ul className="inspector__keys">
              <li><b>Piletaster</b> flytter linjen — med shift længere</li>
              <li><b>+</b> / <b>−</b> ændrer størrelsen, <b>0</b> nulstiller</li>
              <li><b>⌫</b> tager linjen af siden</li>
              <li><b>Dobbeltklik</b> retter teksten direkte på siden</li>
              <li><b>Esc</b> slipper linjen</li>
            </ul>
            </details>
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
export function PageGround() {
  const { document, brand, selectedOfferId, selectedText, setPageGround, setPageBackground, spreadBackground } = useStudioPick('document', 'brand', 'selectedOfferId', 'selectedText', 'setPageGround', 'setPageBackground', 'spreadBackground');
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
        Baggrundsfarve
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

        {pipette && (
          <button
            className="ground__pick"
            disabled={dropping}
            title="Klik et sted på skærmen for at bruge den farve"
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
          >⌖ Tag farve fra skærmen</button>
        )}
      </div>

      <p className="ground__note">
        {page.ground
          ? <>Din egen farve. <b>Nulstil</b> giver {brand.name}s farve igen.</>
          : <>{brand.name}s egen farve for side {index + 1}.</>}
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
          Intet. Tryk <b>Billeder og baggrund</b> over siden for at lægge et billede under hele siden.
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
            <span>Synlighed {Math.round(page.background.opacity * 100)}%</span>
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
            <span>Samme baggrund på</span>
            <button
              className="inspector__link"
              title="Siderne efter denne får samme baggrund — ⌘Z fortryder"
              onClick={() => spreadBackground(page.id, 'resten')}
            >sider herefter</button>
            <button
              className="inspector__link"
              title="Alle avisens varesider får samme baggrund — ⌘Z fortryder"
              onClick={() => spreadBackground(page.id, 'alle')}
            >alle sider</button>
          </div>
        </>
      )}
    </>
  );
}
