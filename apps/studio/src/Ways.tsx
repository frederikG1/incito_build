import { useState } from 'react';
import { useStudio } from './state.js';

/**
 * The two ways into a page that are not a file you hand in.
 *
 * `Genskab sider` takes pages off your desk — a photograph, a scan, a
 * PDF. These take them from somewhere else:
 *
 *   **Et link.** A leaflet published through Tjek carries its own
 *   layout in the page it is served on: every offer is a rectangle with
 *   coordinates, so the grid is READ rather than estimated. No model,
 *   no cost, and the same answer twice. It is the cheapest and most
 *   exact route in this studio, which is why it is first.
 *
 *   **A drawing.** No reference at all: an image model is asked for a
 *   page layout, and that drawing is read the same way a scanned page
 *   is. The drawing never reaches the sheet — it decides where the
 *   cells are and is then thrown away, and what prints is the chain's
 *   own tiles. That is the difference between this and pasting a
 *   generated picture onto a page.
 *
 * A strip that folds, like the mood-artwork one and for the same
 * reason: most sessions use one of the two, and neither is worth
 * permanent chrome above the page you are looking at.
 */

const OPEN_KEY = 'incitio.ways.open';

function remembered(): boolean {
  try {
    return window.localStorage.getItem(OPEN_KEY) === '1';
  } catch {
    return false;
  }
}

export function Ways() {
  const s = useStudio();
  const [shown, setShown] = useState(remembered);

  function show(next: boolean) {
    setShown(next);
    try {
      window.localStorage.setItem(OPEN_KEY, next ? '1' : '0');
    } catch { /* private browsing; it still folds for this session */ }
  }

  if (!s.brand) return null;
  const busy = Boolean(s.busy);

  return (
    <section className={shown ? 'ways' : 'ways ways--shut'} aria-label="Hent eller tegn sider">
      <div className="ways__head">
        <button className="ways__disclose" onClick={() => show(!shown)} aria-expanded={shown}>
          <span className="ways__caret" aria-hidden="true">{shown ? '▾' : '▸'}</span>
          <h2 className="ways__title">Hent eller tegn sider</h2>
        </button>
        {!shown && <span className="ways__said">link til en udgivelse · tegnet layout</span>}
      </div>

      {shown && (
        <div className="ways__row">
          {/*
            * The link route.
            *
            * Marked as free in as many words, beside the button. It is
            * the only route in this studio that costs nothing, and
            * nobody would guess that from a field that looks like every
            * other field.
            */}
          <div className="ways__way">
            <label className="ways__field ways__field--wide">
              <span className="ways__label">
                Udgivelse <em>— link til en trykt avis</em>
              </span>
              <input
                type="url"
                value={s.publicationUrl}
                placeholder="https://publication-viewer.tjek…/v1/previews/…"
                onChange={(event) => s.setPublicationUrl(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !busy) void s.importPublication();
                }}
              />
              <span className="ways__hint">
                Layoutet læses ud af udgivelsen selv — gratis, uden modelkald.
              </span>
            </label>

            <label className="ways__field ways__field--slim">
              <span className="ways__label">Sider</span>
              <input
                type="text"
                value={s.publicationPages}
                placeholder="alle"
                onChange={(event) => s.setPublicationPages(event.target.value)}
              />
              <span className="ways__hint">fx 4, 1-6 eller 2,5,9</span>
            </label>

            <div className="ways__opts">
              <label title="Tag udgivelsens egne varer med på siderne">
                <input
                  type="checkbox"
                  checked={s.publicationWithOffers}
                  onChange={(event) => s.setPublicationWithOffers(event.target.checked)}
                />
                varerne med
              </label>
              <label title="Læg siderne bag den avis der allerede er åben">
                <input
                  type="checkbox"
                  checked={s.publicationAppend}
                  onChange={(event) => s.setPublicationAppend(event.target.checked)}
                  disabled={!s.document}
                />
                læg til
              </label>
            </div>

            <button
              className="primary ways__go"
              disabled={busy || !s.publicationUrl.trim()}
              onClick={() => void s.importPublication()}
            >
              Hent layout
            </button>
          </div>

          <div className="ways__way">
            <label className="ways__field ways__field--wide">
              <span className="ways__label">
                Tegnet layout <em>— ingen reference, modellen tegner den</em>
              </span>
              <input
                type="text"
                value={s.layoutNote}
                placeholder='fx "én stor vare øverst, tre små under"'
                onChange={(event) => s.setLayoutNote(event.target.value)}
                disabled={!s.decorReady}
              />
              <span className="ways__hint">
                Tegningen trykkes aldrig — den bruges kun til at placere varerne.
              </span>
            </label>

            <label className="ways__field ways__field--slim">
              <span className="ways__label">Pladser</span>
              <input
                type="number"
                min={1}
                max={12}
                value={s.layoutCells}
                onChange={(event) => s.setLayoutCells(Number(event.target.value))}
                disabled={!s.decorReady}
              />
              <span className="ways__hint">varer på siden</span>
            </label>

            <div className="ways__opts">
              <label title="Læg siden bag den avis der allerede er åben">
                <input
                  type="checkbox"
                  checked={s.layoutAppend}
                  onChange={(event) => s.setLayoutAppend(event.target.checked)}
                  disabled={!s.document}
                />
                læg til
              </label>
            </div>

            <button
              className="accent ways__go"
              disabled={busy || !s.feed || !s.decorReady || !s.curationReady}
              title={s.decorReady
                ? 'Gemini tegner et layout, og varerne placeres i det'
                : 'Tilføj GEMINI_API_KEY i .env og genstart API-serveren'}
              onClick={() => void s.generateLayout()}
            >
              Tegn og fyld
            </button>
          </div>

          {/*
            * Said once, under both, because the two halves need
            * different keys and a single "no API key" would send
            * someone to the wrong line of `.env`.
            */}
          {!s.decorReady && (
            <p className="ways__off">
              Et tegnet layout kræver <code>GEMINI_API_KEY</code> i <code>.env</code> —
              og fakturering på Google-projektet. Linket ovenfor virker uden nøgler.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
