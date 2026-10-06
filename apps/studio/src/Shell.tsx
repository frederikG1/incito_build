import { useState } from 'react';
import { weekRange } from '@incitio/schema';
import { useStudio } from './state.js';
import { ReadyPill } from './Checklist.js';
import { SearchButton } from './Palette.js';
import { EditionNote, EditionPicker, SectionUpdates } from './Editions.js';
import { ConflictNote, SaveStatus } from './Saving.js';
import { usePopover } from './popover.js';
import { avisTitle } from './names.js';
import { Chevron } from './Chevron.js';
import { lanesOf } from './approvals.js';

/** How many signatures are missing or out of date — on the Godkend tab, and nothing when none are. */
function SignoffCount() {
  const document = useStudio((s) => s.variantBase ?? s.document);
  if (!document) return null;
  const waiting = lanesOf(document).filter((lane) => lane.state !== 'godkendt').length;
  // A badge only when someone has to act; a tab with nothing to do stays plain.
  return waiting > 0 ? <i className="seg__count">{waiting}</i> : null;
}

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
            {document ? avisTitle(document.name, s.brand?.name) : (s.brand?.name ?? 'Incitio')}
          </strong>
          <span className="doc__said">
            {/* Before the chain has loaded there is nothing to count — say that, not "0 sider". */}
            {!s.brand
              ? 'indlæser…'
              : document
                ? (week ? weekRange(week) : `${pages} ${pages === 1 ? 'side' : 'sider'}`)
                : 'ingen avis åben'}
          </span>
        </span>
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
      <button className="go go--caret" onClick={() => setOpen(!open)} disabled={off} aria-expanded={open} title="Flere PDF'er" aria-label="Flere PDF'er"><Chevron /></button>
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

/* -------------------------------------------------------- the chain */

/** "Netto — demofeed, syntetiske billeder" → the name, and the note beside it. */
function chainName(name: string): { name: string; note: string } {
  const [head, ...rest] = name.split(' — ');
  return { name: head ?? name, note: rest.join(' — ') };
}

/**
 * Which chain, in the chain's own colour.
 *
 * The chain is the outermost thing there is — every avis, design and
 * product belongs to one — so it stands first in the header, wearing
 * its colour, and is switched from there rather than from a select at
 * the foot of the front page.
 */
function ChainSwitch() {
  const s = useStudio();
  const [open, setOpen] = useState(false);
  usePopover(open, () => setOpen(false));
  const current = s.brands.find((brand) => brand.id === s.brandId);
  const color = s.brand?.tokens.brand ?? current?.color ?? 'var(--muted)';
  const label = chainName(current?.name ?? s.brand?.name ?? '…');

  return (
    <div className="docwrap chain">
      <button
        className={`chain__btn${open ? ' is-open' : ''}`}
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        title="Skift kæde"
      >
        <i className="chain__dot" style={{ background: color }} aria-hidden="true" />
        <span className="chain__name">{label.name}</span>
        <Chevron />
      </button>
      {open && (
        <>
          <div className="sheetaway" onPointerDown={() => setOpen(false)} />
          <div className="docmenu chain__menu" role="menu">
            <span className="chain__head">Kæde</span>
            {s.brands.map((brand) => {
              const shown = chainName(brand.name);
              const on = brand.id === s.brandId;
              return (
                <button
                  key={brand.id}
                  role="menuitemradio"
                  aria-checked={on}
                  className={`chain__item${on ? ' is-on' : ''}`}
                  disabled={Boolean(s.busy)}
                  onClick={() => { setOpen(false); if (!on) void s.signInAs(brand.id); }}
                >
                  <i className="chain__dot chain__dot--big" style={{ background: brand.color ?? 'var(--muted)' }}>
                    {brand.accent && <i style={{ background: brand.accent }} />}
                  </i>
                  <span className="chain__lines">
                    <b>{shown.name}</b>
                    {shown.note && <small>{shown.note}</small>}
                  </span>
                  {on && <span className="chain__check" aria-hidden="true">✓</span>}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

/* ---------------------------------------------------------- the top */

export function Top() {
  const s = useStudio();
  const document = s.variantBase ?? s.document;
  // The avis's own tools only while an avis is what is on screen.
  const inAvis = Boolean(s.document) && s.view !== 'hjem' && s.view !== 'varedesigns';
  return (
    <>
      <header className={`top${s.view === 'side' ? ' top--side' : ''}${s.view === 'hjem' ? ' top--home' : ''}`}>
        <button className="mark" onClick={() => s.openHome()} title="Forsiden">
          <span className="mark__glyph" aria-hidden="true" />
          <span className="mark__word">Incitio</span>
        </button>
        <ChainSwitch />
        {/* The chain's own page, said in the bar as an avis's screen is. */}
        {s.view === 'varedesigns' && <span className="top__place">Varedesigns</span>}
        {document && s.view !== 'hjem' && s.view !== 'varedesigns' && (
          <>
            <Document />
            <EditionPicker />
          </>
        )}

        {inAvis && s.view !== 'side' && (
          <div className="seg top__tabs" role="tablist" aria-label="Skærm">
            <button role="tab" aria-selected={s.view === 'bog'} className={s.view === 'bog' ? 'is-on' : ''} onClick={() => s.openPage(null)}>Avisen</button>
            <button role="tab" aria-selected={s.view === 'varer'} className={s.view === 'varer' ? 'is-on' : ''} onClick={() => s.openGoods()}>Varer</button>
            <button role="tab" aria-selected={s.view === 'pladser'} className={s.view === 'pladser' ? 'is-on' : ''} onClick={() => s.openBoard('pladser')}>
              Pladser{document?.bookings?.length ? <i className="seg__count">{document.bookings.length}</i> : null}
            </button>
            <button role="tab" aria-selected={s.view === 'udgaver'} className={s.view === 'udgaver' ? 'is-on' : ''} onClick={() => s.openEditions()}>
              Udgaver{document?.variants?.length ? <i className="seg__count">{document.variants.length}</i> : null}
            </button>
            <button role="tab" aria-selected={s.view === 'godkend'} className={s.view === 'godkend' ? 'is-on' : ''} onClick={() => s.openBoard('godkend')}>
              Godkend<SignoffCount />
            </button>
            <button role="tab" aria-selected={s.view === 'live'} className={s.view === 'live' ? 'is-on' : ''} onClick={() => s.openBoard('live')}>
              Live{document?.status === 'udgivet' ? <i className="seg__live" aria-label="udgivet" /> : null}
            </button>
          </div>
        )}

        {/* Back to the book, only from inside a page. */}
        {s.view === 'side' && (
          <button className="thin top__back" onClick={() => s.openPage(null)} title="Tilbage til avisen (Esc)">‹ Avisen</button>
        )}
        {s.view === 'side' ? <PageHead /> : <div className="top__gap" />}

        <SearchButton />
        {inAvis && (
          <>
            <ReadyPill />
            <SaveStatus />
            <div className="top__history">
              <button className="quiet" onClick={s.undo} disabled={s.past.length === 0} title="Fortryd (⌘Z)" aria-label="Fortryd">↶</button>
              <button className="quiet" onClick={s.redo} disabled={s.future.length === 0} title="Gentag (⇧⌘Z)" aria-label="Gentag">↷</button>
            </div>
            <PdfButton />
          </>
        )}
      </header>
      <ConflictNote />
      <EditionNote />
      <SectionUpdates />
    </>
  );
}

