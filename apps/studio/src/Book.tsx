import { freeSlots } from './grid.js';
import { useEffect, useMemo, useState, type DragEvent } from 'react';
import { isImagePage, type CatalogPage, type PageTemplate } from '@incitio/schema';
import { resolveTemplate } from '@incitio/brands';
import { ImagePage, PageView } from '@incitio/renderer';
import { departmentOfPage, useStudio } from './state.js';
import type { Finding } from './findings.js';
import { OFFER_MIME, droppedOffers } from './Tray.js';
import { DEPARTMENT_NAMES } from '@incitio/compose';
import { CarryReport, FeedArrival, FeedChanges, SectionGallery } from './Weekly.js';

/**
 * The whole avis, as printed spreads.
 *
 * The screen the studio lands on, and the one it never had: pages were
 * a single scrolling column, so seeing whether the BOOK worked meant
 * scrolling it, and comparing page three with page four was not
 * possible at all. Here six spreads sit side by side, every page that
 * needs attention is marked where the problem is, and reordering is a
 * drag rather than two arrows per sheet.
 *
 * The thumbnails are the real pages, rendered and scaled down — see
 * `Card`. Stand-ins showed how a page was divided but not what was on
 * it, which is the thing a glance at the avis is for.
 */

/** The chain's ground rotation, for a page that states no colour. */
const TINTS = ['#fff1b8', '#d8e8e7', '#fae0da', '#cedeb1', '#bad4e1', '#f4e3d0', '#eae0d6'];

/** What this page is printed on. */
function groundOf(page: CatalogPage, index: number): string {
  return page.ground ?? TINTS[index % TINTS.length]!;
}

/** The worst thing said about this page, if anything is. */
function verdictOf(findings: Finding[], pageId: string): Finding | null {
  const mine = findings.filter((finding) => finding.pageId === pageId);
  return mine.find((finding) => finding.weight === 'stop') ?? mine[0] ?? null;
}

function Card({ page, index }: { page: CatalogPage; index: number }) {
  const brand = useStudio((s) => s.brand);
  const document = useStudio((s) => s.document);
  const findings = useStudio((s) => s.findings);
  const openPage = useStudio((s) => s.openPage);
  const removePage = useStudio((s) => s.removePage);
  const addOffersToPage = useStudio((s) => s.addOffersToPage);
  const [taking, setTaking] = useState(false);
  const offers = useMemo(
    () => new Map((document?.offers ?? []).map((offer) => [offer.id, offer])),
    [document?.offers],
  );

  const template: PageTemplate | undefined = brand
    ? resolveTemplate(brand, page.templateId)
      ?? document?.templates.find((entry) => entry.id === page.templateId)
    : undefined;
  const verdict = verdictOf(findings, page.id);
  const empty = template ? freeSlots(page, template).length : 0;
  const image = isImagePage(page);

  const tone = verdict?.weight === 'stop' ? ' card--stop' : verdict ? ' card--warn' : '';

  /*
   * A product from the tray, dropped on the page: a cell each, the
   * grid growing if it must — today's `Nye pladser` as a gesture.
   * Caught here and not on the leaf, whose own drop reorders pages.
   */
  const takes = image ? {} : {
    onDragOver: (event: DragEvent) => {
      if (!event.dataTransfer.types.includes(OFFER_MIME)) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = 'copy';
      setTaking(true);
    },
    onDragLeave: () => setTaking(false),
    onDrop: (event: DragEvent) => {
      const dragged = event.dataTransfer.getData(OFFER_MIME);
      if (!dragged) return;
      event.preventDefault();
      event.stopPropagation();
      setTaking(false);
      addOffersToPage(page.id, droppedOffers(dragged, useStudio.getState().librarySelection));
    },
  };

  /*
   * The real page, not a stand-in.
   *
   * `PageView` itself, drawn at a working width and scaled down — so
   * the thumbnail IS the print render and cannot drift from it, and a
   * spread can be judged without opening each sheet. Inert: the card is
   * one click target, and a click opens the page.
   */
  const live = !brand ? null : image ? (
    <ImagePage page={page} brand={brand} pageIndex={index} pageNumber={index + 1} />
  ) : template ? (
    <PageView
      page={page}
      template={template}
      brand={brand}
      offers={offers}
      pageIndex={index}
      pageNumber={index + 1}
    />
  ) : null;

  return (
    <div
      className={`card${tone}${taking ? ' card--taking' : ''}`}
      style={{ background: groundOf(page, index) }}
      {...takes}
      onClick={() => openPage(page.id)}
      title={image
        ? 'Billedside'
        : `Side ${index + 1}${empty ? ` · ${empty} ${empty === 1 ? 'tomt felt' : 'tomme felter'}` : ''}`}
    >
      <div className="card__live" aria-hidden="true">{live}</div>
      <button
        className="card__drop"
        title={`Slet side ${index + 1} (⌘Z fortryder)`}
        aria-label={`Slet side ${index + 1}`}
        onClick={(event) => { event.stopPropagation(); removePage(page.id); }}
      >×</button>
      {verdict && (
        <span className={`card__pill${verdict.weight === 'stop' ? '' : ' card__pill--warn'}`}>
          {verdict.weight === 'stop' ? 'se på den' : 'værd at se'}
        </span>
      )}
    </div>
  );
}

function Caption({ page, index }: { page: CatalogPage; index: number }) {
  const findings = useStudio((s) => s.findings);
  const brand = useStudio((s) => s.brand);
  const document = useStudio((s) => s.document);
  const verdict = verdictOf(findings, page.id);
  // What the page is about, when nobody has named it: its department.
  const department = document && !page.title ? departmentOfPage(document, page.id) : null;

  const template = brand
    ? resolveTemplate(brand, page.templateId)
      ?? document?.templates.find((entry) => entry.id === page.templateId)
    : undefined;
  const cells = template?.slots.length ?? page.placements.length;

  /*
   * The caption states the FACT when something is wrong, not the
   * complaint. "3 af 4 pladser fyldt" is a page you can picture; "1
   * finding" is a number about a list.
   */
  const open = template ? freeSlots(page, template).length : 0;
  const said = verdict
    ? (open > 0
      ? `${cells - open} af ${cells} pladser fyldt`
      : verdict.said.replace(/^Side \d+: /, ''))
    : `${page.placements.length} ${page.placements.length === 1 ? 'vare' : 'varer'}`;

  return (
    <div className="leaf__cap">
      <b>
        {index + 1} · {page.title || (isImagePage(page)
          ? 'Billedside'
          : department ? DEPARTMENT_NAMES[department] : 'Blandet')}
      </b>
      <span className={verdict?.weight === 'stop' ? 'is-stop' : verdict ? 'is-warn' : ''}>
        {said.length > 40 ? `${said.slice(0, 38)}…` : said}
      </span>
    </div>
  );
}

/**
 * Where new pages come from.
 *
 * The week's route first — a saved section, filled with this week's
 * products — then the link, then a quick draft. The two that send pages
 * to a model sit under "Mere": they are for building a new look, not for
 * the weekly paper, and a first-time user should not have to weigh them.
 */
function AddPages() {
  const open = useStudio((s) => s.addPagesOpen);
  const setOpen = useStudio((s) => s.setAddPagesOpen);
  const s = useStudio();
  // Leftward keeps it inside the window at the end of a long book; on
  // an empty book the card is the first thing and left is off-screen.
  const [right, setRight] = useState(false);
  const [more, setMore] = useState(false);

  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [open, setOpen]);

  return (
    <div className="add">
      <button
        className="add__card"
        onClick={(event) => {
          setRight(event.currentTarget.getBoundingClientRect().left < 360);
          setOpen(!open);
        }}
        aria-expanded={open}
      >
        <span aria-hidden="true">+</span>
        Tilføj sider
      </button>

      {open && (
        <>
        <div className="sheetaway" onPointerDown={() => setOpen(false)} />
        <div className={`ways2${right ? ' ways2--right' : ''}`}>
          <p className="ways2__head">Hvor skal siderne komme fra?</p>

          <button
            className="ways2__way ways2__way--first"
            disabled={Boolean(s.busy)}
            onClick={() => { setOpen(false); s.setSectionsOpen(true, s.document?.pages.length ?? 0); }}
          >
            <span className="ways2__what">
              <b>Fra kædens sektioner</b>
              <span>Vælg et gemt sidedesign — det fyldes med ugens varer</span>
            </span>
            <span className="ways2__price ways2__price--free">anbefalet</span>
          </button>

          <button
            className="ways2__way"
            disabled={Boolean(s.busy)}
            onClick={() => { setOpen(false); s.togglePanel('sider'); }}
          >
            <span className="ways2__what">
              <b>Fra en trykt avis</b>
              <span>Sæt et link ind — siderne kommer præcis som udgivet</span>
            </span>
          </button>

          <button
            className="ways2__way"
            disabled={Boolean(s.busy) || !s.feed}
            title={s.feed ? '' : 'Hent ugens varer fra fil først — i menuen øverst til venstre'}
            onClick={() => { setOpen(false); void s.build({ fresh: true }); }}
          >
            <span className="ways2__what">
              <b>Hurtigt udkast</b>
              <span>{s.feed ? 'Ugens varer lagt i kædens layouts, afdeling for afdeling' : 'Kræver ugens varer fra fil'}</span>
            </span>
          </button>

          <button className="ways2__more" onClick={() => setMore(!more)} aria-expanded={more}>
            {more ? '▾' : '▸'} Mere — nyt design med AI
          </button>
          {more && (
            <>
              <button
                className="ways2__way"
                disabled={Boolean(s.busy) || !s.curationReady}
                title={s.curationReady ? '' : 'AI-hjælpen er slået fra på denne maskine'}
                onClick={() => { setOpen(false); s.setReproduceOpen(true); }}
              >
                <span className="ways2__what">
                  <b>Efterlign trykte sider</b>
                  <span>Aflevér fotos eller en PDF — AI bygger siderne op med ugens varer</span>
                </span>
                <span className="ways2__price ways2__price--paid">AI</span>
              </button>
              <button
                className="ways2__way ways2__way--model"
                disabled={Boolean(s.busy) || !s.feed || !s.decorReady}
                title={!s.decorReady ? 'AI-hjælpen er slået fra på denne maskine' : s.feed ? '' : 'Kræver ugens varer fra fil'}
                onClick={() => { setOpen(false); s.togglePanel('sider'); }}
              >
                <span className="ways2__what">
                  <b>Lad AI tegne et layout</b>
                  <span>Beskriv siden, fx "én stor vare øverst, tre små under"</span>
                </span>
                <span className="ways2__price ways2__price--model">AI</span>
              </button>
            </>
          )}
        </div>
        </>
      )}
    </div>
  );
}

/**
 * An avis with no pages yet — the first thing a new colleague sees.
 *
 * Not an empty grid with a small "+" at the end of it: the three ways a
 * week's paper actually starts, each saying what it needs and what it
 * costs, and the feed that is already loaded named so it is clear the
 * products are there waiting.
 */
function EmptyBook() {
  const s = useStudio();
  const sections = useStudio((state) => state.sections.length);
  return (
    <div className="empty">
      <h2>En ny avis</h2>
      <p className="empty__said">
        {s.feedOffers.length > 0
          ? `${s.feedOffers.length} af ugens varer er klar. Hvor skal siderne komme fra?`
          : 'Hent ugens varer fra fil i menuen øverst til venstre — og vælg så hvor siderne kommer fra.'}
      </p>
      <div className="empty__ways">
        <button className="empty__way empty__way--first" onClick={() => s.setSectionsOpen(true, 0)}>
          <b>Fra kædens sektioner</b>
          <span>{sections ? `${sections} gemte sidedesigns` : 'Gemte sidedesigns'} — fyldes med ugens varer efter afdeling</span>
          <i className="ways2__price ways2__price--free">anbefalet</i>
        </button>
        <button className="empty__way" onClick={() => s.togglePanel('sider')}>
          <b>Fra en trykt avis</b>
          <span>Sæt et link ind — siderne kommer præcis som udgivet, og kan rettes bagefter</span>
        </button>
        <button
          className="empty__way"
          disabled={!s.feed}
          title={s.feed ? '' : 'Hent ugens varer fra fil først'}
          onClick={() => void s.build({ fresh: true })}
        >
          <b>Hurtigt udkast</b>
          <span>Ugens varer i kædens egne layouts, afdeling for afdeling</span>
        </button>
      </div>
      <p className="empty__tip">Tryk <kbd>⌘K</kbd> for at søge efter alt — eller <kbd>?</kbd> for genvejene.</p>
    </div>
  );
}

export function Book() {
  const document = useStudio((s) => s.document);
  const bookView = useStudio((s) => s.bookView);
  const setBookView = useStudio((s) => s.setBookView);
  const movePage = useStudio((s) => s.movePage);
  const setSectionsOpen = useStudio((s) => s.setSectionsOpen);
  const sectionCount = useStudio((s) => s.sections.length);
  const [lifted, setLifted] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);

  const pages = document?.pages ?? [];

  /*
   * Spreads, the way it is read.
   *
   * The front page stands alone and so does the back, because that is
   * how a leaflet is folded: page one has nothing to its left. So the
   * grouping is 1, then 2–3, 4–5, and whatever is left over.
   */
  const groups: { at: number; pages: CatalogPage[] }[] = [];
  if (bookView === 'sider') {
    pages.forEach((page, at) => groups.push({ at, pages: [page] }));
  } else {
    pages.forEach((page, at) => {
      if (at === 0 || at % 2 === 0) groups.push({ at, pages: [page] });
      else groups[groups.length - 1]!.pages.push(page);
    });
  }

  return (
    <main className="book">
      <div className="book__head">
        <h2>Avisen</h2>
        <span className="book__said">som den bliver trykt · træk en side for at flytte den</span>
        <div className="book__gap" />
        <button className="thin" onClick={() => setSectionsOpen(true)} title="Kædens gemte sidedesigns">
          Sektioner{sectionCount ? ` · ${sectionCount}` : ''}
        </button>
        <div className="seg" role="group" aria-label="Vis som">
          <button
            className={bookView === 'opslag' ? 'is-on' : ''}
            onClick={() => setBookView('opslag')}
          >Opslag</button>
          <button
            className={bookView === 'sider' ? 'is-on' : ''}
            onClick={() => setBookView('sider')}
          >Sider</button>
        </div>
      </div>

      {pages.length === 0 && <EmptyBook />}
      <FeedArrival />
      <CarryReport />
      <FeedChanges />
      <SectionGallery />

      <div className="book__row">
        {groups.map((group) => (
          <div
            className={`leaf${lifted === group.at ? ' leaf--lifted' : ''}${
              over === group.at ? ' leaf--over' : ''}`}
            key={group.pages[0]!.id}
            draggable
            onDragStart={() => setLifted(group.at)}
            onDragEnd={() => { setLifted(null); setOver(null); }}
            onDragOver={(event) => { event.preventDefault(); setOver(group.at); }}
            onDragLeave={() => setOver((was) => (was === group.at ? null : was))}
            onDrop={(event) => {
              event.preventDefault();
              setOver(null);
              /*
               * Moved one step at a time, because `movePage` is what
               * the document understands and it is already one undo
               * entry per step. A drag across four spreads is four
               * steps; a drag onto the neighbour is one.
               */
              if (lifted === null || lifted === group.at) return;
              const from = lifted;
              const delta = group.at > from ? 1 : -1;
              // A spread moves as two pages — the far one first, so the pair stays together.
              const moving = groups.find((entry) => entry.at === from)?.pages ?? [];
              for (const page of delta > 0 ? [...moving].reverse() : moving) {
                for (let at = from; at !== group.at; at += delta) movePage(page.id, delta);
              }
              setLifted(null);
            }}
          >
            {group.pages.length === 2 ? (
              <div className="leaf__pair">
                {group.pages.map((page, n) => (
                  <Card key={page.id} page={page} index={group.at + n} />
                ))}
              </div>
            ) : (
              <Card page={group.pages[0]!} index={group.at} />
            )}
            <div className="leaf__caps">
              {group.pages.map((page, n) => (
                <Caption key={page.id} page={page} index={group.at + n} />
              ))}
            </div>
          </div>
        ))}

        {/* An empty avis has the three ways in above; this is for one that has pages. */}
        {pages.length > 0 && <AddPages />}
      </div>
    </main>
  );
}
