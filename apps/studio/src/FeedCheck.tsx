import { useState } from 'react';
import type { FeedHealth } from '@incitio/brands';
import { checkFeed } from './api.js';
import { useStudio } from './state.js';

const SAID: Record<FeedHealth['verdict'], string> = {
  ok: 'Klar til at bygge',
  advarsel: 'Kan bygges — men se advarslerne',
  ulæselig: 'Kan ikke læses',
};

/**
 * The chain's file, looked at the morning it lands — before a week is
 * built from it, and long before print day. Nothing is stored or built:
 * pick the file, read the verdict, then build as usual.
 */
export function FeedCheck() {
  const brandId = useStudio((s) => s.brand?.id);
  const [health, setHealth] = useState<FeedHealth | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (!brandId) return null;
  return (
    <div className="feedcheck">
      <label className="home__tool feedcheck__pick">
        <input
          type="file"
          accept=".json,.csv,.xml,application/json,text/csv,text/xml"
          onChange={async (event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (!file) return;
            setBusy(true);
            setError('');
            try { setHealth(await checkFeed(brandId, file)); } catch (e) { setHealth(null); setError(e instanceof Error ? e.message : String(e)); }
            setBusy(false);
          }}
        />
        <span className="home__glyph" aria-hidden="true">✓</span>
        <span className="home__toollines">
          <b>Feedtjek</b>
          <small>{busy ? 'læser…' : health ? health.file : 'vælg ugens fil'}</small>
          <span>Kan ugens fil læses, og hvad mangler?</span>
        </span>
      </label>
      {error && <p className="feedcheck__said feedcheck__said--ulæselig">{error}</p>}
      {health && <FeedHealthReport health={health} />}
    </div>
  );
}

/**
 * A feed's verdict, said the same way on the front page's Feedtjek and in
 * the shelf when the week's file is read in.
 */
export function FeedHealthReport({ health, onClose }: { health: FeedHealth; onClose?: () => void }) {
  return (
    <section className={`feedcheck__report feedcheck__report--${health.verdict}`} aria-live="polite">
      <b>
        {SAID[health.verdict]}
        {onClose && <button className="feedcheck__close" onClick={onClose} aria-label="Luk">×</button>}
      </b>
      <p>
        {health.offers} tilbud
        {health.dropped.length > 0 && ` · ${health.dropped.reduce((n, d) => n + d.count, 0)} rækker tabt`}
        {` · ${health.noImage.count} uden billede`}
        {health.validity.from && ` · gælder ${health.validity.from} → ${health.validity.to}`}
      </p>
      <small>{health.reason}</small>
      {health.warnings.length > 0 && (
        <ul>{health.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
      )}
      {health.noImage.count > 0 && <small>Uden billede: {health.noImage.offerIds.join(', ')}{health.noImage.count > 10 ? ' …' : ''}</small>}
      {health.unreadColumns.length > 0 && <small>Kolonner ingen læser: {health.unreadColumns.join(', ')}</small>}
    </section>
  );
}
