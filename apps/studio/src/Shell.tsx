import { useState } from 'react';
import { weekRange } from '@incitio/schema';
import { useStudio } from './state.js';
import { bySeverity } from './findings.js';

/**
 * The chrome both screens wear: who you are, what is in the way, and
 * the one way out.
 *
 * It replaces a toolbar of sixteen controls. Nothing it held was
 * dropped — the chain, the week and the open-another picker were one
 * question and are one menu; the save button became a line that says
 * when it last saved, with ⌘S and the menu behind it; the four ways
 * into a page moved to the card that makes pages; the checklist became
 * the sentence in the next-step bar and the badges on the page cards.
 */

/* ------------------------------------------------------- the avis */

/**
 * Which avis, in one hit target.
 *
 * Chain, week and "open another" are three answers to one question and
 * were three controls in a row. The button states the answer; the menu
 * behind it holds the three ways to change it, plus the explicit save
 * that used to sit beside them.
 */
function Document() {
  const s = useStudio();
  const [open, setOpen] = useState(false);
  const week = s.week;
  const pages = s.document?.pages.length ?? 0;
  const offers = s.document?.offers.length ?? 0;

  return (
    <div className="docwrap">
      <button className="doc" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="doc__lines">
          <strong className="doc__name">
            {s.brand?.name ?? '—'}{week ? ` · uge ${week.week}` : ''}
          </strong>
          <span className="doc__said">
            {[
              week ? weekRange(week) : 'ingen uge',
              `${pages} ${pages === 1 ? 'side' : 'sider'}`,
              `${offers} varer`,
            ].join(' · ')}
          </span>
        </span>
        <span className="doc__caret" aria-hidden="true">▾</span>
      </button>

      {open && (
        <>
          <div className="sheetaway" onPointerDown={() => setOpen(false)} />
          <div className="docmenu">
            <label className="docmenu__field">
              <span>Kæde</span>
              <select
                value={s.brandId ?? ''}
                disabled={Boolean(s.busy)}
                onChange={(event) => void s.signInAs(event.target.value)}
              >
                {s.brands.map((brand) => (
                  <option key={brand.id} value={brand.id}>{brand.name}</option>
                ))}
              </select>
            </label>

            <label className="docmenu__field">
              <span>Uge</span>
              <input
                type="number"
                min={1}
                max={53}
                value={week?.week ?? ''}
                placeholder="—"
                onChange={(event) => {
                  const next = Number(event.target.value);
                  if (week && next >= 1 && next <= 53) s.setWeek({ ...week, week: next });
                }}
              />
            </label>

            {s.catalogues.length > 0 && (
              <label className="docmenu__field">
                <span>Åbn en anden</span>
                <select
                  value=""
                  disabled={Boolean(s.busy)}
                  onChange={(event) => {
                    if (event.target.value) void s.openCatalogue(event.target.value);
                    setOpen(false);
                  }}
                >
                  <option value="">{s.catalogues.length} gemte…</option>
                  {s.catalogues.map((saved) => (
                    <option key={saved.id} value={saved.id}>{saved.name}</option>
                  ))}
                </select>
              </label>
            )}

            {/* The week's products, from a file. Lived in the tray; the
                tray is only inside a page now, and a feed is chosen
                before there are pages. */}
            <label className="docmenu__do" style={{ display: 'block', cursor: 'pointer' }}>
              <input
                type="file"
                accept=".csv,.json,.txt"
                style={{ display: 'none' }}
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  setOpen(false);
                  if (file) await s.uploadFeed(file.name, await file.text());
                }}
              />
              Upload feed <i>{s.feed ? s.feed.source : 'ingen endnu'}</i>
            </label>

            <button
              className="docmenu__do"
              disabled={!s.document || Boolean(s.busy)}
              onClick={() => { setOpen(false); void s.save(); }}
            >
              Gem nu <i>⌘S</i>
            </button>
          </div>
        </>
      )}
    </div>
  );
}


/* ------------------------------------------------------ this page */

/**
 * Which page, and what it says — in the header while you are inside it.
 *
 * The stepper, the heading and the theme line sat in the page bar over
 * the sheet, beside the controls for the page's SHAPE. They are what the
 * page is called and where it sits, so they read as the title of the
 * screen; the bar under them keeps only the shape.
 */
function PageHead() {
  const s = useStudio();
  const pages = s.document?.pages ?? [];
  const index = pages.findIndex((page) => page.id === s.openPageId);
  const page = pages[index];
  if (!page) return null;

  return (
    <>
      <div className="top__rule" />
      <div className="pagestep">
        <button className="thin" disabled={index === 0} title="Forrige side" onClick={() => s.stepPage(-1)}>‹</button>
        <strong>Side {index + 1} af {pages.length}</strong>
        <button
          className="thin"
          disabled={index === pages.length - 1}
          title="Næste side"
          onClick={() => s.stepPage(1)}
        >›</button>
      </div>
      {/* Which page, by name — read-only here; it is edited above the sheet. */}
      {page.kind !== 'image' && page.title && <span className="pagestep__title">{page.title}</span>}
      <div className="top__gap" />
    </>
  );
}

/* ---------------------------------------------------------- the top */

export function Top() {
  const s = useStudio();
  const saved = s.savedAt
    ? new Date(s.savedAt).toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <>
      <header className={s.view === 'side' ? 'top top--side' : 'top'}>
        <strong className="top__mark">Incitio</strong>
        <div className="top__rule" />
        <Document />

        {/* Back to the book, only from inside a page. */}
        {s.view === 'side' && (
          <button className="thin" onClick={() => s.openPage(null)} title="Tilbage til avisen (Esc)">‹ Avisen</button>
        )}
        {s.view === 'side' ? <PageHead /> : <div className="top__gap" />}

        {/* The save, as a button that says when it last happened — the
            only visible way to save besides ⌘S and the avis menu. */}
        <button
          className="top__save"
          disabled={!s.document || Boolean(s.busy)}
          onClick={() => void s.save()}
          title="Gem avisen (⌘S)"
        >
          Gem{saved ? <i> · gemt {saved}</i> : null}
        </button>
        <button className="quiet" onClick={s.undo} disabled={s.past.length === 0} title="Fortryd (⌘Z)">↶</button>
        <button className="quiet" onClick={s.redo} disabled={s.future.length === 0} title="Gentag (⇧⌘Z)">↷</button>

        <button className="go" onClick={() => void s.downloadPdf()} disabled={!s.document || Boolean(s.busy)}>
          Hent PDF
        </button>
      </header>

    </>
  );
}
