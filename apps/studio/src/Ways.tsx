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
                Fra en trykt avis <em>— sæt linket ind</em>
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
                Siderne hentes præcis som udgivet og kan rettes bagefter.
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
                tag varerne med
              </label>
              <label title="Læg siderne bag den avis der allerede er åben">
                <input
                  type="checkbox"
                  checked={s.publicationAppend}
                  onChange={(event) => s.setPublicationAppend(event.target.checked)}
                  disabled={!s.document}
                />
                læg efter de nuværende sider
              </label>
            </div>

            <button
              className="primary ways__go"
              disabled={busy || !s.publicationUrl.trim()}
              onClick={() => void s.importPublication()}
            >
              Hent siderne
            </button>
          </div>

          <div className="ways__way">
            <label className="ways__field ways__field--wide">
              <span className="ways__label">
                Lad AI tegne et layout <em>— beskriv siden</em>
              </span>
              <input
                type="text"
                value={s.layoutNote}
                placeholder='fx "én stor vare øverst, tre små under"'
                onChange={(event) => s.setLayoutNote(event.target.value)}
                disabled={!s.decorReady}
              />
              <span className="ways__hint">
                Kun pladserne bruges — tegningen kommer ikke med på tryk.
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
                læg efter de nuværende sider
              </label>
            </div>

            <button
              className="accent ways__go"
              disabled={busy || !s.feed || !s.decorReady || !s.curationReady}
              title={!s.decorReady || !s.curationReady
                ? 'AI-hjælpen er slået fra på denne maskine'
                : s.feed ? 'AI tegner et layout, og ugens varer sættes ind i det' : 'Hent ugens varer fra fil først'}
              onClick={() => void s.generateLayout()}
            >
              Tegn og fyld
            </button>
          </div>

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
                Efterlign trykte sider <em>— med AI</em>
              </span>
              <span className="ways__hint">
                Aflevér fotos eller en PDF af de sider avisen skal ligne.
              </span>
            </div>
            <button
              className="primary ways__go"
              disabled={busy || !s.curationReady}
              title={s.curationReady ? '' : 'AI-hjælpen er slået fra på denne maskine'}
              onClick={() => { s.closePanel(); s.setReproduceOpen(true); }}
            >
              Aflevér sider
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
                Hurtigt udkast <em>— ugens varer, afdeling for afdeling</em>
              </span>
              <span className="ways__hint">
                Ugens varer lagt direkte i kædens egne layouts — et hurtigt første udkast.
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
              title={s.feed ? '' : 'Hent ugens varer fra fil først — i menuen øverst til venstre'}
              onClick={() => void s.build({ fresh: true })}
            >
              Byg udkast
            </button>
          </div>

      </div>
    </section>
  );
}
