import {
  MAX_REFERENCE_PAGES, count, pageNumbers, referenceJobs, useStudio, wholeDocument,
  type PageRun,
} from './state.js';

/**
 * Genskab sider — the three stages, made visible.
 *
 * The pipeline has exactly three inputs and the panel has exactly three
 * steps, in that order, numbered. That is not decoration: this is the
 * way a catalogue is made here, and an unexplained failure ("the page
 * came back wrong") is almost always a missing input two steps earlier.
 * A person who can see which step is not yet green can fix it
 * themselves.
 *
 * Each step reports its own state rather than the panel reporting one
 * combined verdict, and the run button says what is missing instead of
 * being disabled for reasons the screen does not give.
 */
export function Reproduce() {
  const s = useStudio();
  if (!s.reproduceOpen) return null;

  const hasKey = s.curationReady;
  const jobs = referenceJobs(s.references);
  const missing = jobs.length === 0
    ? 'Vælg først en eller flere sider at genskabe'
    : !hasKey
      ? 'Serveren mangler ANTHROPIC_API_KEY'
      : '';

  /*
   * What the run will cost, before it is paid for.
   *
   * One model call a page, run one after another — see `reproduce` —
   * so both numbers grow with the list. Roughly forty seconds and seven
   * cents a page in practice; said as "about", because a page with
   * twenty tiles is not a page with four.
   */
  const minutes = Math.max(1, Math.round((jobs.length * 40) / 60));
  const capped = s.references.length > 0
    && referenceJobs(s.references).length >= MAX_REFERENCE_PAGES;

  return (
    <section className="repro" aria-label="Genskab sider">
      <header className="repro__head">
        <h2>Genskab sider</h2>
        <p>
          Giv systemet de sider, en kæde har trykt. Claude læser hver sides
          gitter, caster denne uges varer ind i det, og du får siderne tilbage
          i editoren som helt almindelige sider — til at rette, gemme og printe.
        </p>
        <button className="repro__close" onClick={() => s.setReproduceOpen(false)} title="Luk">
          ×
        </button>
      </header>

      <ol className="repro__steps">
        {/* ------------------------------------------------ 1: the pages */}
        <li className={jobs.length > 0 ? 'is-done' : 'is-now'}>
          <b>1</b>
          <div>
            <h3>Referencerne</h3>
            <p>
              Fotos, screenshots eller PDF'er af de sider, du vil efterligne.
              Én side pr. fil — eller ét sideinterval pr. PDF.
            </p>

            <label className="repro__file">
              <input
                type="file"
                multiple
                accept="image/png,image/jpeg,image/webp,image/gif,application/pdf,.pdf"
                onChange={async (e) => {
                  const files = [...(e.target.files ?? [])];
                  e.target.value = '';
                  if (files.length > 0) await s.addReferences(files);
                }}
              />
              <span>{s.references.length > 0 ? 'Tilføj flere' : 'Vælg filer'}</span>
            </label>

            {s.references.length > 0 && (
              <ul className="reflist">
                {s.references.map((reference, index) => {
                  const pages = pageNumbers(reference.pages);
                  /*
                   * A page the file does not have is a model call that
                   * fails, so it is worth saying before the run rather
                   * than after it. Only knowable because the length is
                   * read out of the PDF on upload — see `countPages`.
                   */
                  const beyond = reference.pageCount !== null
                    && pages.some((page) => page > reference.pageCount!);
                  const all = wholeDocument(reference.pageCount);
                  return (
                    <li key={reference.id}>
                      <span className="reflist__name" title={reference.name}>
                        {reference.name}
                      </span>

                      {/* Only for a PDF: a page field on a JPEG is a
                          control that cannot do anything, and one that
                          answers "1" forever teaches people to distrust
                          the rest of the panel. */}
                      {reference.isPdf && (
                        <label className="reflist__pages">
                          <span>Sider</span>
                          <input
                            type="text"
                            inputMode="numeric"
                            placeholder="1-6"
                            value={reference.pages}
                            onChange={(e) => s.setReferencePages(reference.id, e.target.value)}
                          />
                          <i className={pages.length === 0 || beyond ? 'is-bad' : ''}>
                            {pages.length === 0 ? 'ingen' : count(pages.length, 'side', 'sider')}
                            {/* The file's real length, so the field
                                reads as a choice rather than as the
                                only page the tool can see. */}
                            {reference.pageCount !== null && <> af {reference.pageCount}</>}
                            {beyond && <> — filen har ikke så mange</>}
                          </i>

                          {/* One click back to the whole file, for
                              someone who narrowed it and changed their
                              mind. Absent when it is already all of it. */}
                          {reference.pageCount !== null && reference.pages !== all && (
                            <button
                              type="button"
                              className="reflist__all"
                              title={`Alle ${reference.pageCount} sider`}
                              onClick={() => s.setReferencePages(reference.id, all)}
                            >alle</button>
                          )}
                        </label>
                      )}

                      <span className="reflist__gap" />
                      <button
                        title="Tidligere i avisen"
                        onClick={() => s.moveReference(reference.id, -1)}
                        disabled={index === 0}
                      >↑</button>
                      <button
                        title="Senere i avisen"
                        onClick={() => s.moveReference(reference.id, 1)}
                        disabled={index === s.references.length - 1}
                      >↓</button>
                      <button
                        title="Fjern"
                        className="reflist__drop"
                        onClick={() => s.removeReference(reference.id)}
                      >×</button>
                    </li>
                  );
                })}
              </ul>
            )}

            {jobs.length > 0 && (
              <em className="repro__chosen">
                {count(jobs.length, 'side', 'sider')} · ca. {minutes} min
                {capped && <> · flere end {MAX_REFERENCE_PAGES} tages ikke med</>}
                {' · '}
                <button className="repro__clear" onClick={() => s.clearReferences()}>ryd</button>
              </em>
            )}
          </div>
        </li>

        {/* ------------------------------------------------- 2: the feed */}
        <li className={s.feed ? 'is-done' : 'is-now'}>
          <b>2</b>
          <div>
            <h3>Varerne</h3>
            <p>
              Denne uges feed, i det format {s.brand?.name ?? 'kæden'} allerede
              udgiver. Det læses med kædens egen læser — samme vej ind som når du
              bygger et udkast.
            </p>
            {s.feed
              ? <em className="repro__chosen">{s.feed.source}</em>
              : (
                <em className="repro__chosen repro__chosen--none">
                  Intet feed indlæst — brug <b>Upload feed</b> øverst.
                </em>
              )}
          </div>
        </li>

        {/* ------------------------------------------------ 3: the steer */}
        <li className="is-optional">
          <b>3</b>
          <div>
            <h3>Retning <i>(valgfri)</i></h3>
            <p>Én sætning, der følges på hver side, medmindre den ødelægger siden.</p>
            <input
              type="text"
              className="repro__note"
              placeholder="fx “kød skal føre siderne” eller “hold det til frost”"
              value={s.reproduceNote}
              onChange={(e) => s.setReproduceNote(e.target.value)}
            />

            {/* Only offered when there is something to add to. Building
                an avis four pages at a time is the normal rhythm, and
                without this the fifth page would throw the first four
                away. */}
            {s.document && (
              <label className="repro__append">
                <input
                  type="checkbox"
                  checked={s.reproduceAppend}
                  onChange={(e) => s.setReproduceAppend(e.target.checked)}
                />
                <span>
                  {s.document.pages.length === 1
                    ? 'Læg siderne til den, der allerede er åben'
                    : `Læg siderne til de ${s.document.pages.length}, der allerede er åbne`}
                  <i>— varerne på dem bliver ikke brugt igen</i>
                </span>
              </label>
            )}
          </div>
        </li>
      </ol>

      <footer className="repro__foot">
        <p className="repro__hint">
          {missing || (
            <>
              Claude måler <b>ikke</b> farven — den aflæses i hver sides marginer.
              Modellen svarer kun med gitter og casting; kædens eget stylesheet
              tegner siden. Siderne bygges én ad gangen og dukker op undervejs.
            </>
          )}
        </p>
        <button
          className="primary"
          onClick={() => void s.reproduce()}
          disabled={Boolean(s.busy) || jobs.length === 0 || !hasKey}
        >
          {s.busy
            ? <><span className="spinner" aria-hidden="true" /> {s.busy}</>
            : jobs.length > 1 ? `Genskab ${jobs.length} sider` : 'Genskab siden'}
        </button>
      </footer>
    </section>
  );
}

/**
 * The reference beside what was built from it, and why.
 *
 * Rendered above its own page on the canvas rather than in the
 * inspector: the only way to judge this feature is to look at the two
 * pages at once, and a panel 300px wide cannot hold a page. With
 * several pages in a run each one carries its own — the reference for
 * page five is not the reference for page one.
 */
export function Comparison({ run }: { run: PageRun }) {
  const s = useStudio();

  const names = new Map((s.document?.offers ?? []).map((o) => [o.id, o.name]));
  const cost = (run.usage.inputTokens * 5 + run.usage.outputTokens * 25) / 1e6;

  return (
    <div className="compare">
      <figure className="compare__ref">
        <img src={run.reference} alt={`Den side du gav os: ${run.referenceName}`} />
        <figcaption>{run.referenceName}, som modellen så den</figcaption>
      </figure>

      <div className="compare__read">
        <h3>Sådan blev den læst</h3>
        <dl>
          <dt>Gitter</dt>
          <dd>
            <code>{run.template.areas.join(' / ')}</code>
            {/*
              * Where the grid came from, said plainly.
              *
              * A grid measured out of a vector PDF is a fact about the
              * printed page; one counted off a picture is a reading, and
              * a good one is still a reading. They are not worth the
              * same amount of trust, and the person deciding whether to
              * keep the page is the one who should be told which this
              * was. The deviation is the honest half of a measurement:
              * a page whose lead artwork bleeds over its cell edge comes
              * back at a few per cent, and that number is what says the
              * lattice was read rather than fitted.
              */}
            <small>
              {run.grid.source === 'pdf'
                ? `${run.grid.columns} × ${run.grid.rows}, målt i PDF'en`
                  + `${run.grid.fit !== null ? ` — afvigelse ${(run.grid.fit * 100).toFixed(1)}%` : ''}`
                : 'aflæst af modellen på billedet — en vektor-PDF ville blive målt'}
            </small>
          </dd>
          <dt>Bundfarve</dt>
          <dd>
            <i className="compare__swatch" style={{ background: run.ground }} /> {run.ground}
            <small> målt i marginerne, ikke gættet</small>
          </dd>
          <dt>Feed</dt>
          <dd>{run.source.name} · {run.poolSize} af {run.offersInFeed} tilbud i puljen</dd>
          <dt>Pris</dt>
          <dd>
            {run.usage.inputTokens.toLocaleString('da-DK')} ind,{' '}
            {run.usage.outputTokens.toLocaleString('da-DK')} ud ≈ ${cost.toFixed(3)}
          </dd>
        </dl>

        <h3>Casting</h3>
        <ul className="compare__cast">
          {run.casting.map((seat) => (
            <li key={seat.slotId}>
              <b>{seat.slotId}</b>
              <span className="compare__role">{seat.role}</span>
              <span className="compare__name">{names.get(seat.offerId) ?? seat.offerId}</span>
              <em>{seat.why}</em>
            </li>
          ))}
        </ul>
        {run.rejected > 0 && (
          <p className="compare__dropped">
            {count(run.rejected, 'plads', 'pladser')} blev udeladt: modellen satte en vare
            der, som feedet ikke har.
          </p>
        )}
      </div>
    </div>
  );
}
