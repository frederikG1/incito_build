import { useStudio } from './state.js';

/**
 * Every way a page can come into being, in one place.
 *
 * There were four of them and they were four separate buttons on the
 * toolbar — `Genskab sider`, `Hurtigt udkast`, `Hent/tegn`, and a test
 * button — which is one decision ("where do the pages come from")
 * spread across half the bar, with nothing to say which answer is the
 * good one. They are rows in one panel now, in the order somebody
 * should try them:
 *
 *   **Trykte sider.** Hand in the pages you want the avis to look
 *   like. The most expensive route and the only one that reliably
 *   produces a page worth printing, so it is first.
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
 * A panel the toolbar folds out, like the mood-artwork one and for the
 * same reason: most sessions use one of the two, and neither is worth
 * a permanent strip above the page you are looking at — not even a
 * folded one, which still costs its line. See `panel`.
 */

export function Ways() {
  const s = useStudio();

  if (!s.brand) return null;
  const busy = Boolean(s.busy);

  return (
    <section className="ways" aria-label="Nye sider">
      <div className="ways__row">
          {/*
            * The route that produces a page worth printing, first.
            *
            * Its own overlay rather than a row of fields — handing in
            * eight scans needs a file list, an order and a page range
            * per file, which is more than a row. The panel's job is to
            * say that this is one of four answers to the same
            * question, and to be the place the choice is made.
            */}
          <div className="ways__way">
            <div className="ways__field ways__field--wide">
              <span className="ways__label">
                Trykte sider <em>— aflevér de sider avisen skal ligne</em>
              </span>
              <span className="ways__hint">
                Én fil pr. side, eller et sideinterval af en PDF. Dyrest, og den
                eneste vej der pålideligt giver en side værd at trykke.
              </span>
            </div>
            <button
              className="primary ways__go"
              disabled={busy}
              onClick={() => { s.closePanel(); s.setReproduceOpen(true); }}
            >
              Aflevér sider
            </button>
          </div>

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
            * The fast look at a feed, last.
            *
            * `Sider` lives here and nowhere else now. It is the page
            * budget for THIS route and no other, and standing
            * permanently in the toolbar it looked like a setting for
            * the whole studio.
            */}
          <div className="ways__way">
            <div className="ways__field ways__field--wide">
              <span className="ways__label">
                Hurtigt udkast <em>— kategorisortering, ingen model</em>
              </span>
              <span className="ways__hint">
                Feedet lagt direkte i kædens egne layouts. Øjeblikkeligt og gratis —
                et hurtigt kig på ugens varer, ikke en avis.
              </span>
            </div>

            <label className="ways__field ways__field--slim">
              <span className="ways__label">Sider</span>
              <input
                type="number"
                min={1}
                max={60}
                value={s.maxPages}
                onChange={(event) => s.setMaxPages(Number(event.target.value))}
              />
              <span className="ways__hint">højst</span>
            </label>

            <button
              className="ways__go"
              disabled={busy || !s.feed}
              title={s.feed ? '' : 'Upload et feed først'}
              onClick={() => void s.build({ fresh: true })}
            >
              Byg udkast
            </button>
          </div>

          {/*
            * The five steps every test of the cluster feature starts
            * with, as one press — see `testCluster`.
            *
            * Here rather than in the toolbar, and said plainly. It is
            * a developer's shortcut and it spent months looking like
            * something a customer was meant to press.
            */}
          <div className="ways__way ways__way--aside">
            <div className="ways__field ways__field--wide">
              <span className="ways__label">Testflise <em>— til udvikling</em></span>
              <span className="ways__hint">
                Bygger et udkast om nødvendigt, samler de tre første varer med billede
                i første plads, og lader Gemini stille dem op.
              </span>
            </div>
            <button
              className="ways__go"
              disabled={busy || (!s.feed && !s.document)}
              onClick={() => void s.testCluster()}
            >
              Kør test
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
    </section>
  );
}
