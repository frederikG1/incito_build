import { useStudio } from './state.js';
import { offerImportance } from '@incitio/layout';
import { formatPrice } from '@incitio/renderer';

/** Right-hand panel: what is selected, what went wrong, and theme dials. */
export function Inspector() {
  const { offers, document, issues, unplaced, notSelected, categoryMix, selectedOfferId,
    setTheme, brief, setBrief, planning } = useStudio();
  const offer = selectedOfferId ? offers.get(selectedOfferId) : undefined;

  return (
    <aside className="inspector">
      <section className="inspector__block">
        <h2>Valgt tilbud</h2>
        {offer ? (
          <dl className="kv">
            <dt>Navn</dt><dd>{offer.name}</dd>
            <dt>Mærke</dt><dd>{offer.brand || '—'}</dd>
            <dt>Kategori</dt><dd>{offer.category}</dd>
            <dt>Pris</dt><dd>{formatPrice(offer.price, offer.currency)} kr.</dd>
            <dt>Førpris</dt>
            <dd>{offer.prePrice === null ? '—' : `${formatPrice(offer.prePrice, offer.currency)} kr.`}</dd>
            <dt>Enhedspris</dt>
            <dd>
              {offer.comparison
                ? `${formatPrice(offer.comparison.value, offer.currency)} kr. / ${offer.comparison.unit}`
                : '—'}
            </dd>
            <dt>Vægtning</dt><dd>{offerImportance(offer).toFixed(2)}</dd>
          </dl>
        ) : (
          <p className="muted">Klik på et tilbud i kataloget.</p>
        )}
      </section>

      <section className="inspector__block">
        <h2>Brief til AI</h2>
        <p className="muted">
          Fri tekst. Styrer hvordan siderne sættes sammen — ikke hvor tingene ligger.
        </p>
        <textarea
          className="brief"
          value={brief}
          disabled={planning}
          onChange={(e) => setBrief(e.target.value)}
          placeholder={'F.eks.:\n"Kød og grill skal fylde de første sider"\n"Det er skoleugen — pak madpakke-varer sammen"\n"Hold vin væk fra forsiden"'}
        />
      </section>

      {document && (
        <section className="inspector__block">
          <h2>Tema</h2>
          <label className="field">
            <span>Brandfarve</span>
            <input
              type="color"
              value={document.theme.brandColor}
              onChange={(e) => setTheme({ brandColor: e.target.value })}
            />
          </label>
          <label className="field">
            <span>Accentfarve</span>
            <input
              type="color"
              value={document.theme.accentColor}
              onChange={(e) => setTheme({ accentColor: e.target.value })}
            />
          </label>
          <label className="field">
            <span>Sidebaggrund</span>
            <input
              type="color"
              value={document.theme.pageBackground}
              onChange={(e) => setTheme({ pageBackground: e.target.value })}
            />
          </label>
        </section>
      )}

      {Object.keys(categoryMix).length > 0 && (
        <section className="inspector__block">
          <h2>Udvalg</h2>
          <p className="muted">
            {Object.values(categoryMix).reduce((a, b) => a + b, 0)} tilbud valgt,
            {' '}{notSelected} fravalgt
          </p>
          <ul className="mix">
            {Object.entries(categoryMix)
              .sort((a, b) => b[1] - a[1])
              .map(([category, count]) => (
                <li key={category}><span>{category}</span><b>{count}</b></li>
              ))}
          </ul>
        </section>
      )}

      <section className="inspector__block">
        <h2>Import ({issues.length} problemer)</h2>
        {issues.length === 0 ? (
          <p className="muted">Alle rækker importeret.</p>
        ) : (
          <ul className="issues">
            {issues.map((issue) => (
              <li key={`${issue.rowIndex}-${issue.reason}`}>
                <code>række {issue.rowIndex + 2}</code> {issue.offerId ?? '—'}: {issue.reason}
              </li>
            ))}
          </ul>
        )}
        {unplaced.length > 0 && (
          <p className="warn">{unplaced.length} tilbud kunne ikke placeres: {unplaced.join(', ')}</p>
        )}
      </section>
    </aside>
  );
}
