import { useEffect } from 'react';
import { PageView } from '@incitio/renderer';
import { resolveTemplate } from '@incitio/brands';
import { useStudio } from './state.js';
import { Inspector } from './Inspector.js';
import { SlotHandle } from './SlotHandle.js';

export function App() {
  const s = useStudio();

  useEffect(() => { void s.start(); }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z') return;
      event.preventDefault();
      if (event.shiftKey) s.redo();
      else s.undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [s.undo, s.redo]);

  const offers = new Map((s.document?.offers ?? []).map((offer) => [offer.id, offer]));

  return (
    <div className="app">
      <header className="bar">
        <strong className="bar__mark">Incitio</strong>

        {/* Stands in for signing in. Everything below is scoped to it. */}
        <label className="field">
          <span>Kæde</span>
          <select
            value={s.brandId ?? ''}
            onChange={(e) => void s.signInAs(e.target.value)}
            disabled={Boolean(s.busy)}
          >
            {s.brands.map((brand) => (
              <option key={brand.id} value={brand.id}>{brand.name}</option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Sider</span>
          <input
            type="number"
            min={1}
            max={60}
            value={s.maxPages}
            onChange={(e) => s.setMaxPages(Number(e.target.value))}
          />
        </label>

        <input
          className="field field--brief"
          type="text"
          placeholder="Retning til Claude, fx “læg kød først”"
          value={s.brief}
          onChange={(e) => s.setBrief(e.target.value)}
        />

        <label className="upload" title="Upload denne uges feed">
          <input
            type="file"
            accept=".csv,.json,.txt"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) s.uploadFeed(file.name, await file.text());
            }}
          />
          <span>Upload feed</span>
        </label>

        <div className="bar__gap" />

        <button onClick={s.undo} disabled={s.past.length === 0}>Fortryd</button>
        <button onClick={s.redo} disabled={s.future.length === 0}>Gentag</button>
        <button
          onClick={() => void s.build({ skipCuration: true, fresh: true })}
          disabled={Boolean(s.busy) || !s.feed}
        >
          Byg uden AI
        </button>
        <button
          className="primary"
          onClick={() => void s.build({ fresh: true })}
          disabled={Boolean(s.busy) || !s.feed || !s.curationReady}
          title={s.curationReady
            ? 'Lad Claude bestemme sider, overskrifter og skabeloner'
            : 'Tilføj ANTHROPIC_API_KEY i .env og genstart API-serveren'}
        >
          {s.busy ? <><span className="spinner" aria-hidden="true" /> {s.busy}</> : 'Generér med AI'}
        </button>
        <button onClick={() => void s.save()} disabled={!s.document || Boolean(s.busy)}>Gem</button>
        <button onClick={() => void s.downloadPdf()} disabled={!s.document || Boolean(s.busy)}>
          PDF
        </button>
      </header>

      {s.error && <div className="banner banner--error">{s.error}</div>}
      {s.note && !s.error && <div className="banner banner--ok">{s.note}</div>}
      {s.brand && !s.curationReady && (
        <div className="banner banner--hint">
          AI-kuratering er slået fra. Læg din nøgle i <code>.env</code> som{' '}
          <code>ANTHROPIC_API_KEY=sk-ant-…</code> og genstart API-serveren.
        </div>
      )}

      <div className="app__body">
        <main className="canvas">
          {!s.document && s.brand && (
            <p className="empty">
              {s.feed
                ? <>Feed klar: <code>{s.feed.source}</code>. Tryk <strong>Generér</strong>.</>
                : 'Upload denne uges feed for at komme i gang.'}
            </p>
          )}

          {s.document && s.brand && s.document.pages.map((page, index) => {
            const brand = s.brand!;
            // Resolved within this chain's own set — a template id from
            // another chain simply does not exist here.
            const template = resolveTemplate(brand, page.templateId);
            if (!template) {
              return (
                <div className="sheet" key={page.id}>
                  <div className="page page--error">Ukendt skabelon: {page.templateId}</div>
                </div>
              );
            }
            return (
              <div className="sheet" key={page.id}>
                <div className="sheet__bar">
                  <input
                    className="sheet__title"
                    value={page.title}
                    onChange={(e) => s.setPageTitle(page.id, e.target.value)}
                  />
                  <span className="sheet__meta">{template.name}</span>
                  <button onClick={() => s.movePage(page.id, -1)} disabled={index === 0}>↑</button>
                  <button
                    onClick={() => s.movePage(page.id, 1)}
                    disabled={index === s.document!.pages.length - 1}
                  >↓</button>
                </div>
                {page.rationale && <p className="sheet__why">{page.rationale}</p>}
                <PageView
                  page={page}
                  template={template}
                  brand={brand}
                  offers={offers}
                  pageIndex={index}
                  pageNumber={index + 1}
                  selectedOfferId={s.selectedOfferId}
                  onSelectOffer={s.select}
                  slotDecorator={(slotId) => (
                    <SlotHandle pageId={page.id} slotId={slotId} />
                  )}
                />
              </div>
            );
          })}
        </main>
        <Inspector />
      </div>
    </div>
  );
}
