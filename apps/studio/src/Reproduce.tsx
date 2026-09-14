import { useStudio } from './state.js';

/**
 * Genskab en side — the three stages, made visible.
 *
 * The pipeline has exactly three inputs and the panel has exactly three
 * steps, in that order, numbered. That is not decoration: this is a
 * feature where an unexplained failure ("the page came back wrong") is
 * almost always a missing input two steps earlier, and a person who can
 * see which step is not yet green can fix it themselves.
 *
 * Each step reports its own state rather than the panel reporting one
 * combined verdict, and the run button says what is missing instead of
 * being disabled for reasons the screen does not give.
 */
export function Reproduce() {
  const s = useStudio();
  if (!s.reproduceOpen) return null;

  const hasKey = s.curationReady;
  const missing = !s.reference
    ? 'Vælg først en side at genskabe'
    : !hasKey
      ? 'Serveren mangler ANTHROPIC_API_KEY'
      : '';

  return (
    <section className="repro" aria-label="Genskab en side">
      <header className="repro__head">
        <h2>Genskab en side</h2>
        <p>
          Giv systemet en side, en kæde har trykt. Claude læser sidens gitter,
          caster denne uges varer ind i det, og du får siden tilbage i editoren
          som en helt almindelig side — til at rette, gemme og printe.
        </p>
        <button className="repro__close" onClick={() => s.setReproduceOpen(false)} title="Luk">
          ×
        </button>
      </header>

      <ol className="repro__steps">
        {/* ------------------------------------------------- 1: the page */}
        <li className={s.reference ? 'is-done' : 'is-now'}>
          <b>1</b>
          <div>
            <h3>Referencen</h3>
            <p>Et foto, et screenshot eller en PDF af den side, du vil efterligne.</p>

            <label className="repro__file">
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif,application/pdf,.pdf"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (file) await s.setReference(file);
                }}
              />
              <span>{s.reference ? 'Vælg en anden' : 'Vælg fil'}</span>
            </label>

            {s.reference && <em className="repro__chosen">{s.reference.name}</em>}

            {/* Only for a PDF: a page number on a JPEG is a control that
                cannot do anything, and one that answers "1" forever
                teaches people to distrust the rest of the panel. */}
            {s.reference?.isPdf && (
              <label className="repro__page">
                <span>Side i PDF'en</span>
                <input
                  type="number"
                  min={1}
                  value={s.referencePage}
                  onChange={(e) => s.setReferencePage(Number(e.target.value))}
                />
              </label>
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
              bygger en hel avis.
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
            <p>Én sætning, der følges medmindre den ødelægger siden.</p>
            <input
              type="text"
              className="repro__note"
              placeholder="fx “kød skal føre siden” eller “hold det til frost”"
              value={s.reproduceNote}
              onChange={(e) => s.setReproduceNote(e.target.value)}
            />
          </div>
        </li>
      </ol>

      <footer className="repro__foot">
        <p className="repro__hint">
          {missing || (
            <>
              Claude måler <b>ikke</b> farven — den aflæses i sidens marginer.
              Modellen svarer kun med gitter og casting; kædens eget stylesheet
              tegner siden.
            </>
          )}
        </p>
        <button
          className="primary"
          onClick={() => void s.reproduce()}
          disabled={Boolean(s.busy) || !s.reference || !hasKey}
        >
          {s.busy ? <><span className="spinner" aria-hidden="true" /> {s.busy}</> : 'Genskab siden'}
        </button>
      </footer>
    </section>
  );
}

/**
 * The reference beside what was built from it, and why.
 *
 * Shown on the canvas above the rebuilt page rather than in the
 * inspector: the only way to judge this feature is to look at the two
 * pages at once, and a panel 300px wide cannot hold a page.
 */
export function Comparison() {
  const s = useStudio();
  const run = s.reproduction;
  if (!run) return null;

  const names = new Map((s.document?.offers ?? []).map((o) => [o.id, o.name]));
  const cost = (run.usage.inputTokens * 5 + run.usage.outputTokens * 25) / 1e6;

  return (
    <div className="compare">
      <figure className="compare__ref">
        <img src={run.reference} alt="Den side du gav os" />
        <figcaption>Referencen, som modellen så den</figcaption>
      </figure>

      <div className="compare__read">
        <h3>Sådan blev den læst</h3>
        <dl>
          <dt>Gitter</dt>
          <dd><code>{run.template.areas.join(' / ')}</code></dd>
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
            {run.rejected} plads(er) blev udeladt: modellen satte en vare der, som feedet
            ikke har.
          </p>
        )}
      </div>
    </div>
  );
}
