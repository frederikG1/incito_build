import { useState } from 'react';
import { weekRange } from '@incitio/schema';
import { useStudio } from './state.js';
import { ReadyPill } from './Checklist.js';
import { SearchButton } from './Palette.js';
import { EditionNote, EditionPicker, SectionUpdates } from './Editions.js';
import { ConflictNote, SaveStatus } from './Saving.js';
import { usePopover } from './popover.js';

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
/**
 * The avis you are in — and, one click on, all of them.
 *
 * It used to open a menu of six unrelated things: the chain, the week,
 * nineteen saved files in a dropdown, the feed, save, start over. Those
 * now live where they belong — the front page, the Varer tab, the
 * saving status — and this simply says which avis is open and takes
 * you to the front page.
 */
function Document() {
  const s = useStudio();
  const document = s.variantBase ?? s.document;
  const week = document?.week ?? s.week;
  const pages = document?.pages.length ?? 0;

  return (
    <div className="docwrap docwrap--doc">
      <button
        className={`doc${s.view === 'hjem' ? ' is-on' : ''}`}
        onClick={() => s.openHome()}
        title="Alle aviser — denne uge, næste uge og tidligere"
      >
        <span className="doc__lines">
          <strong className="doc__name">
            {document ? document.name : (s.brand?.name ?? 'Incitio')}
          </strong>
          <span className="doc__said">
            {/* Before the chain has loaded there is nothing to count — say that, not "0 sider". */}
            {!s.brand
              ? 'indlæser…'
              : document
                ? [week ? weekRange(week) : 'ingen uge', `${pages} ${pages === 1 ? 'side' : 'sider'}`].join(' · ')
                : 'ingen avis åben'}
          </span>
        </span>
        <span className="doc__caret" aria-hidden="true">⌂</span>
      </button>
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

/* ---------------------------------------------------------- the pdf */

/**
 * Two files, one button.
 *
 * The proof is the page trimmed, for reading on a screen and sending to
 * the category manager. The print file is what the printer asks for:
 * 3 mm bleed, crop marks, and a slug line naming the avis and the time
 * — so the file on the printer's desk says which version it is.
 */
function PdfButton() {
  const s = useStudio();
  const [open, setOpen] = useState(false);
  usePopover(open, () => setOpen(false));
  const off = !s.document || Boolean(s.busy);
  return (
    <div className="pdfwrap">
      <button className="go go--split" onClick={() => void s.downloadPdf()} disabled={off}>Hent PDF</button>
      <button className="go go--caret" onClick={() => setOpen(!open)} disabled={off} aria-expanded={open} title="Flere PDF'er">▾</button>
      {open && (
        <>
          <div className="sheetaway" onPointerDown={() => setOpen(false)} />
          <div className="docmenu docmenu--right">
            <button className="docmenu__do docmenu__do--big" onClick={() => { setOpen(false); void s.downloadPdf(); }}>
              <b>Korrektur</b>
              <span>Til skærm og godkendelse</span>
            </button>
            <button className="docmenu__do docmenu__do--big" onClick={() => { setOpen(false); void s.downloadPdf(true); }}>
              <b>Til trykkeriet</b>
              <span>3 mm beskæring, skæremærker og versionslinje</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/* ---------------------------------------------------------- the top */

export function Top() {
  const s = useStudio();
  return (
    <>
      <header className={s.view === 'side' ? 'top top--side' : 'top'}>
        <strong className="top__mark">Incitio</strong>
        <div className="top__rule" />
        <Document />
        <EditionPicker />
        {s.document && s.view !== 'side' && (
          <div className="seg top__tabs" role="tablist" aria-label="Skærm">
            <button role="tab" aria-selected={s.view === 'bog'} className={s.view === 'bog' ? 'is-on' : ''} onClick={() => s.openPage(null)}>Avisen</button>
            <button role="tab" aria-selected={s.view === 'varer'} className={s.view === 'varer' ? 'is-on' : ''} onClick={() => s.openGoods()}>Varer</button>
            <button role="tab" aria-selected={s.view === 'udgaver'} className={s.view === 'udgaver' ? 'is-on' : ''} onClick={() => s.openEditions()}>
              Udgaver{(s.variantBase ?? s.document).variants?.length ? ` · ${(s.variantBase ?? s.document).variants!.length}` : ''}
            </button>
          </div>
        )}

        {/* Back to the book, only from inside a page. */}
        {s.view === 'side' && (
          <button className="thin" onClick={() => s.openPage(null)} title="Tilbage til avisen (Esc)">‹ Avisen</button>
        )}
        {s.view === 'side' ? <PageHead /> : <div className="top__gap" />}

        {/* The save, as a button that says when it last happened — the
            only visible way to save besides ⌘S and the avis menu. */}
        <SearchButton />
        <ReadyPill />
        <SaveStatus />
        <button className="quiet" onClick={s.undo} disabled={s.past.length === 0} title="Fortryd (⌘Z)">↶</button>
        <button className="quiet" onClick={s.redo} disabled={s.future.length === 0} title="Gentag (⇧⌘Z)">↷</button>

        <PdfButton />
      </header>
      <ConflictNote />
      <EditionNote />
      <SectionUpdates />

    </>
  );
}
