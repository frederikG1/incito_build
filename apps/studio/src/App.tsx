import { useEffect } from 'react';
import { PageView } from '@incitio/renderer';
import { brandCapacities, resolveTemplate, templatesForCount } from '@incitio/brands';
import { pageTextLimits, partLimits } from '@incitio/schema';
import { useStudio } from './state.js';
import { Inspector } from './Inspector.js';
import { TileEditor } from './TileEditor.js';
import { PageTextEditor } from './PageTextEditor.js';
import { Comparison, Reproduce } from './Reproduce.js';
import { DecorBar } from './DecorBar.js';

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

      /*
       * A page's own line answers the same keys as a tile's box.
       *
       * Handled first and returned from, because the two selections are
       * mutually exclusive by construction — see `selectPageText` — and
       * because a heading in hand is what the person is looking at.
       */
      const text = s.selectedText;
      if (text) {
        if (event.key === 'Escape') {
          event.preventDefault();
          s.selectPageText(text.pageId, null);
          return;
        }
        const { step, coarse } = pageTextLimits();
        const far = event.shiftKey ? coarse : step;
        const moves: Record<string, [number, number]> = {
          ArrowLeft: [-far, 0], ArrowRight: [far, 0],
          ArrowUp: [0, -far], ArrowDown: [0, far],
        };
        const step2 = moves[event.key];
        if (step2) {
          event.preventDefault();
          s.nudgePageText(text.pageId, text.part, step2[0], step2[1]);
          return;
        }
        if (event.key === '+' || event.key === '=') {
          event.preventDefault();
          s.scalePageText(text.pageId, text.part, 0.05);
          return;
        }
        if (event.key === '-') {
          event.preventDefault();
          s.scalePageText(text.pageId, text.part, -0.05);
          return;
        }
        if (event.key === '0') {
          event.preventDefault();
          s.resetPageText(text.pageId, text.part);
          return;
        }
        if (event.key === 'Backspace' || event.key === 'Delete') {
          event.preventDefault();
          s.setPageTextHidden(text.pageId, text.part, true);
          s.selectPageText(text.pageId, null);
        }
        // Everything else belongs to whatever is selected elsewhere,
        // and with a line in hand nothing else is.
        return;
      }

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
    s.selectedText, s.nudgePageText, s.scalePageText, s.resetPageText,
    s.setPageTextHidden, s.selectPageText,
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

        {/*
          * Yesterday's work, reopened for nothing.
          *
          * Every rebuilt page cost a model call and every run is saved
          * the moment it finishes, so this is the difference between
          * checking what a change did to last week's avis and paying to
          * find out. It is a picker rather than a button because the
          * question is always "which one".
          */}
        {s.catalogues.length > 0 && (
          <label className="field" title="Åbn en gemt avis — koster ingenting">
            <span>Åbn</span>
            <select
              value=""
              disabled={Boolean(s.busy)}
              onChange={(e) => { void s.openCatalogue(e.target.value); }}
            >
              <option value="">{s.catalogues.length} gemte…</option>
              {s.catalogues.map((saved) => (
                <option key={saved.id} value={saved.id}>{saved.name}</option>
              ))}
            </select>
          </label>
        )}

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

        {/* The way a catalogue is made: hand in the pages you want.
            Kept beside the feed upload because it takes the same feed,
            and marked as the primary action because it is the one. */}
        <button
          className={s.reproduceOpen ? 'primary' : 'accent'}
          onClick={() => s.setReproduceOpen(!s.reproduceOpen)}
          title="Genskab trykte sider med denne uges varer"
        >
          Genskab sider
        </button>

        <div className="bar__gap" />

        <button onClick={s.undo} disabled={s.past.length === 0}>Fortryd</button>
        <button onClick={s.redo} disabled={s.future.length === 0}>Gentag</button>
        {/*
          * "Generér med AI" used to stand here: a brief in, a whole
          * book out, planned by the model from nothing but the feed.
          * It is gone. Pages made that way were generically correct
          * and never looked like the chain, because the model was
          * asked to invent a design instead of being shown one —
          * which is exactly what `Genskab sider` does instead.
          *
          * What is left is the plain draft: category order into the
          * chain's own layouts, no model, no key, instant. It is the
          * fast look at a feed, not the way to a page worth printing.
          */}
        <button
          onClick={() => void s.build({ fresh: true })}
          disabled={Boolean(s.busy) || !s.feed}
          title="Hurtigt udkast direkte fra feedet — kategorisortering, ingen model"
        >
          Hurtigt udkast
        </button>
        {/*
          * Mood artwork used to live here as one nameless field and a
          * button. It moved to `DecorBar` below the toolbar when it
          * gained a second field: they steer two different models, and
          * that only reads if each one is labelled.
          */}
        <button onClick={() => void s.save()} disabled={!s.document || Boolean(s.busy)}>Gem</button>
        <button onClick={() => void s.downloadPdf()} disabled={!s.document || Boolean(s.busy)}>
          PDF
        </button>
      </header>

      <DecorBar />

      {/*
        * Where the work is, said in one place.
        *
        * It used to be the label of whichever button started it — which
        * worked while a run was one click and one page. A run of eight
        * references closes the panel it was started from and takes
        * minutes, so the progress has to live somewhere that is still
        * on screen while the pages appear underneath it.
        */}
      {s.busy && (
        <div className="banner banner--busy">
          <span className="spinner" aria-hidden="true" /> {s.busy}
        </div>
      )}
      {s.error && <div className="banner banner--error">{s.error}</div>}
      {s.note && !s.error && !s.busy && <div className="banner banner--ok">{s.note}</div>}
      {s.brand && !s.curationReady && (
        <div className="banner banner--hint">
          Sider kan ikke genskabes uden nøgle. Læg din i <code>.env</code> som{' '}
          <code>ANTHROPIC_API_KEY=sk-ant-…</code> og genstart API-serveren.
        </div>
      )}
      {s.brand && s.curationReady && !s.decorReady && (
        <div className="banner banner--hint">
          Stemningsbilleder er slået fra. Læg <code>GEMINI_API_KEY=…</code> i{' '}
          <code>.env</code> og genstart API-serveren. Billedmodellerne kræver
          desuden fakturering på Google-projektet.
        </div>
      )}

      <Reproduce />

      <div className="app__body">
        <main
          className="canvas"
          // Clicking the paper around the pages drops the selection, the
          // way clicking the canvas does in a drawing tool.
          onPointerDown={(event) => {
            if (event.target !== event.currentTarget) return;
            s.select(null);
            s.selectDecor(null);
          }}
        >
          {!s.document && s.brand && (
            <p className="empty">
              {s.feed
                ? <>
                    Feed klar: <code>{s.feed.source}</code>. Tryk <strong>Genskab sider</strong> og
                    aflevér de trykte sider, avisen skal ligne — én fil pr. side, eller et
                    sideinterval af en PDF.
                  </>
                : 'Upload denne uges feed for at komme i gang.'}
            </p>
          )}

          {s.document && s.brand && s.document.pages.map((page, index) => {
            const brand = s.brand!;
            // Resolved within this chain's own set — a template id from
            // another chain simply does not exist here.
            // The chain's own layouts, then any the document brought
            // with it — a page rebuilt from a reference sits on a grid
            // nobody drew for the chain. See `CatalogDocument.templates`.
            const template = resolveTemplate(brand, page.templateId)
              ?? s.document!.templates.find((t) => t.id === page.templateId);
            if (!template) {
              return (
                <div className="sheet" key={page.id}>
                  <div className="page page--error">Ukendt skabelon: {page.templateId}</div>
                </div>
              );
            }
            // How this page was read, when it was rebuilt from one. A
            // page from the plain draft simply has none.
            const run = s.reproductions.find((r) => r.pageId === page.id);
            return (
              /*
               * A picture can simply be dropped on the sheet.
               *
               * The button in the bar is the discoverable route; this is
               * the one a designer with a folder open actually uses.
               * `preventDefault` on dragover is what makes a drop land
               * at all — without it the browser navigates away from the
               * editor and opens the JPEG.
               */
              <div
                className="sheet"
                key={page.id}
                onDragOver={(event) => {
                  if (event.dataTransfer.types.includes('Files')) event.preventDefault();
                }}
                onDrop={async (event) => {
                  const file = [...event.dataTransfer.files]
                    .find((f) => f.type.startsWith('image/'));
                  if (!file) return;
                  event.preventDefault();
                  await s.addPageImage(page.id, file);
                }}
              >
                {run && <Comparison run={run} />}
                {/*
                  * The page's own bar, in two halves.
                  *
                  * Left is what the page SAYS and grows with the window;
                  * right is what it IS — how many offers, in what shape,
                  * where it sits in the book — and keeps its width, so
                  * the controls do not move sideways from sheet to
                  * sheet with the length of a heading.
                  *
                  * "Sæt i fokus" used to sit here and does not any more.
                  * It acts on the SELECTED offer, so it was disabled on
                  * every sheet but one and wrapped onto two lines while
                  * doing nothing; it lives in the inspector now, beside
                  * everything else that acts on the selection.
                  */}
                <div className="sheet__bar">
                  <div className="sheet__said">
                  <input
                    className="sheet__title"
                    value={page.title}
                    placeholder="overskrift"
                    onChange={(e) => s.setPageTitle(page.id, e.target.value)}
                  />

                  {/* The theme line, beside the heading because that is
                      where it prints. Placeholder rather than a label:
                      most pages carry none, and an empty labelled field
                      on every sheet reads as something missing. */}
                  <input
                    className="sheet__subtitle"
                    value={page.subtitle}
                    placeholder="stemningslinje"
                    onChange={(e) => s.setPageSubtitle(page.id, e.target.value)}
                  />
                  </div>

                  <div className="sheet__does">
                  <div className="sheet__tools">
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
                  </div>

                  {/* The chain's own artwork. A label rather than a
                      button because it opens a file picker, and the
                      same files can simply be dropped on the sheet. */}
                  <label className="sheet__image" title="Læg et af kædens egne billeder på siden">
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        e.target.value = '';
                        if (file) await s.addPageImage(page.id, file);
                      }}
                    />
                    <span>Billede</span>
                  </label>

                  {/* The picture the page is printed ON, as opposed to
                      the one laid on top of it. A second control rather
                      than a mode on the first, because the two differ
                      in where the file lands — under the whole sheet,
                      or pinned in a corner at a quarter of its width —
                      and that is not a choice a dropdown beside a file
                      picker makes legible. */}
                  <label
                    className="sheet__image"
                    title="Læg et billede under hele siden"
                  >
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        e.target.value = '';
                        if (file) await s.addPageBackground(page.id, file);
                      }}
                    />
                    <span>{page.background ? 'Baggrund ✓' : 'Baggrund'}</span>
                  </label>

                  <div className="sheet__order">
                    <button
                      title="Tidligere i avisen"
                      onClick={() => s.movePage(page.id, -1)}
                      disabled={index === 0}
                    >↑</button>
                    <button
                      title="Senere i avisen"
                      onClick={() => s.movePage(page.id, 1)}
                      disabled={index === s.document!.pages.length - 1}
                    >↓</button>
                  </div>
                  </div>
                </div>

                {/*
                  * The pictures on this page, only when there are any.
                  *
                  * Its own row rather than more controls in the bar
                  * above: a page usually has none, and a permanently
                  * empty strip on every sheet is exactly the clutter
                  * this bar was just cleared of.
                  */}
                {page.decorations.length > 0 && (
                  <div className="sheet__images">
                    {page.decorations.map((decor) => (
                      <div
                        className={s.selectedDecorId === decor.id ? 'pic is-held' : 'pic'}
                        key={decor.id}
                      >
                        {/*
                          * Takes the picture in hand.
                          *
                          * A decoration is painted behind the grid, so on
                          * a full page the pointer lands on a tile every
                          * time and there is nothing to grab. Arming it
                          * here lifts it over the tiles and hands it the
                          * pointer — the same bargain a tile makes when
                          * you click it before dragging its parts.
                          */}
                        <button
                          className="pic__hold"
                          title={s.selectedDecorId === decor.id
                            ? 'Slip billedet — så lægger det sig bag varerne igen'
                            : 'Tag billedet i hånden, så kan det trækkes på siden'}
                          onClick={() => s.selectDecor(
                            s.selectedDecorId === decor.id ? null : decor.id,
                          )}
                        >
                          <img src={decor.imageUrl} alt="" />
                        </button>
                        <select
                          value={decor.anchor}
                          title="Hvilket hjørne det hænger i"
                          onChange={(e) => s.updatePageImage(page.id, decor.id, {
                            anchor: e.target.value as typeof decor.anchor,
                          })}
                        >
                          <option value="top-left">↖ øverst venstre</option>
                          <option value="top-right">↗ øverst højre</option>
                          <option value="bottom-left">↙ nederst venstre</option>
                          <option value="bottom-right">↘ nederst højre</option>
                        </select>
                        <input
                          type="range"
                          min={5} max={60} value={Math.round(decor.scale * 100)}
                          title="Størrelse, i procent af sidens bredde"
                          onChange={(e) => s.updatePageImage(page.id, decor.id, {
                            scale: Number(e.target.value) / 100,
                          })}
                          onPointerUp={() => s.endGesture()}
                        />
                        <input
                          type="range"
                          min={-30} max={30} value={decor.rotate}
                          title="Drejning"
                          onChange={(e) => s.updatePageImage(page.id, decor.id, {
                            rotate: Number(e.target.value),
                          })}
                          onPointerUp={() => s.endGesture()}
                        />
                        <button
                          className="pic__drop"
                          title="Tag billedet af siden"
                          onClick={() => s.removePageImage(page.id, decor.id)}
                        >×</button>
                      </div>
                    ))}
                  </div>
                )}
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
                  /* The chain's own pictures are dragged like anything
                     else on the page; the sliders beside them stay for
                     the two things a drag cannot say. */
                  onMoveDecor={(decorId, offset, gesture) => s.updatePageImage(
                    page.id, decorId, { offsetX: offset.x, offsetY: offset.y }, gesture,
                  )}
                  onDecorMoveEnd={s.endGesture}
                  selectedDecorId={s.selectedDecorId}
                  /* The heading and the theme line are moved on the
                     page like everything else; the fields in the bar
                     above stay for typing the words. */
                  textDecorator={(part) => (
                    <PageTextEditor pageId={page.id} part={part} />
                  )}
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
