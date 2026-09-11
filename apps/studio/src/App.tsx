import { useEffect } from 'react';
import { PageView } from '@incitio/renderer';
import { brandCapacities, resolveTemplate, templatesForCount } from '@incitio/brands';
import { partLimits } from '@incitio/schema';
import { useStudio } from './state.js';
import { Inspector } from './Inspector.js';
import { TileEditor } from './TileEditor.js';

export function App() {
  const s = useStudio();

  useEffect(() => { void s.start(); }, []);

  /*
   * Keyboard, for the two things a pointer is bad at: history, and
   * moving something by a known, repeatable amount. Ignored while the
   * caret is in a field, or typing "z" in a headline would undo.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target instanceof HTMLInputElement
        || target instanceof HTMLTextAreaElement
        || target?.isContentEditable === true;

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) s.redo();
        else s.undo();
        return;
      }

      if (typing || event.metaKey || event.ctrlKey) return;
      const offerId = s.selectedOfferId;
      if (!offerId) return;

      /*
       * The keys act on whichever box is in hand, and the artwork is
       * what "the tile" means when no box has been named. That is what
       * keeps the shortcuts people already learned working unchanged
       * while making all nine boxes reachable with the same four keys.
       */
      const part = s.selectedPart ?? 'media';

      if (event.key === 'Escape') {
        event.preventDefault();
        // Out of the box first, then out of the tile. Escape from a
        // headline should not also cost you the tile you were on.
        if (s.selectedPart) s.selectPart(null);
        else s.select(null);
        return;
      }

      // A nudge is one step, or the coarse step with shift — the same
      // pair an image editor gives its arrow keys, sized per box
      // because the artwork counts in frames and the rest in page
      // percent. See `partLimits`.
      const { step, coarse } = partLimits(part);
      const distance = event.shiftKey ? coarse : step;
      const nudge: Record<string, [number, number]> = {
        ArrowLeft: [-distance, 0], ArrowRight: [distance, 0],
        ArrowUp: [0, -distance], ArrowDown: [0, distance],
      };
      const move = nudge[event.key];
      if (move) {
        event.preventDefault();
        s.nudgePart(offerId, part, move[0], move[1]);
        return;
      }
      if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        s.scalePart(offerId, part, 0.05);
      }
      if (event.key === '-') { event.preventDefault(); s.scalePart(offerId, part, -0.05); }
      if (event.key === '0') { event.preventDefault(); s.resetPart(offerId, part); }
      /*
       * Delete takes the box off the page rather than deleting
       * anything. Not offered for the artwork: a tile with no picture
       * is a layout with a hole in it, and the way to lose the picture
       * is to have no picture in the feed.
       */
      if ((event.key === 'Backspace' || event.key === 'Delete') && part !== 'media') {
        event.preventDefault();
        s.setPartHidden(offerId, part, true);
        s.selectPart(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    s.undo, s.redo, s.selectedOfferId, s.selectedPart, s.nudgePart,
    s.scalePart, s.resetPart, s.setPartHidden, s.select, s.selectPart,
  ]);

  const offers = new Map((s.document?.offers ?? []).map((offer) => [offer.id, offer]));
  /*
   * Offers the document carries that no page is showing.
   *
   * Read once per render and handed to every page bar, because it is
   * what decides whether a page can be made bigger — and a count a
   * person can pick but the document cannot fill is a control that
   * lies.
   */
  const bench = s.benched();

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

        {/* Said once, where the count is set, rather than on every page
            bar: it is one fact about the document, not six. */}
        {bench.length > 0 && (
          <span className="bar__note" title={bench.map((o) => o.name).join('\n')}>
            {bench.length} i reserve
          </span>
        )}

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
        <main
          className="canvas"
          // Clicking the paper around the pages drops the selection, the
          // way clicking the canvas does in a drawing tool.
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) s.select(null);
          }}
        >
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

                  {/* How many offers this page carries. A count the
                      bench cannot fill is offered but disabled, so the
                      reason a page will not grow is visible rather
                      than being a click that does nothing. */}
                  <label className="sheet__pick">
                    <span>Varer</span>
                    <select
                      value={page.placements.length}
                      onChange={(e) => s.setPageCount(page.id, Number(e.target.value))}
                    >
                      {brandCapacities(brand).map((count) => (
                        <option
                          key={count}
                          value={count}
                          disabled={count > page.placements.length + bench.length}
                        >{count}</option>
                      ))}
                    </select>
                  </label>

                  <label className="sheet__pick">
                    <span>Layout</span>
                    <select
                      value={page.templateId}
                      onChange={(e) => s.setPageTemplate(page.id, e.target.value)}
                    >
                      {templatesForCount(brand, page.placements.length).map((option) => (
                        <option key={option.id} value={option.id}>{option.name}</option>
                      ))}
                    </select>
                  </label>

                  <button
                    title="Næste layout med lige så mange varer"
                    onClick={() => s.shufflePage(page.id)}
                    disabled={templatesForCount(brand, page.placements.length).length < 2}
                  >⟳</button>

                  {/* Only for a tile on THIS page: "put it in focus"
                      has to mean something the page can do, and moving
                      an offer between pages is the drag gesture. */}
                  <button
                    onClick={() => s.focusOffer(page.id, s.selectedOfferId!)}
                    disabled={!s.selectedOfferId
                      || !page.placements.some((p) => p.offerId === s.selectedOfferId)}
                    title="Flyt den valgte vare op i sidens hovedplads"
                  >Sæt i fokus</button>

                  <div className="sheet__gap" />
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
                  selectedPart={s.selectedPart}
                  onSelectOffer={s.select}
                  slotDecorator={(slotId) => {
                    const placement = page.placements.find((p) => p.slotId === slotId);
                    return (
                      <TileEditor
                        pageId={page.id}
                        slotId={slotId}
                        {...(placement ? { offerId: placement.offerId } : {})}
                      />
                    );
                  }}
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
