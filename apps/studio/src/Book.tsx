import { freeSlots } from './grid.js';
import { useEffect, useMemo, useState, type DragEvent } from 'react';
import { isImagePage, type CatalogPage, type PageTemplate } from '@incitio/schema';
import { resolveTemplate } from '@incitio/brands';
import { ImagePage, ImageSize, PageView } from '@incitio/renderer';
import { THUMB_PX, departmentOfPage, useStudio, useStudioPick } from './state.js';
import type { Finding } from './findings.js';
import { OFFER_MIME, droppedOffers } from './Tray.js';
import { BackgroundDock, PICTURE_MIME, carriesPicture, droppedImages } from './Backgrounds.js';
import bg from './Backgrounds.module.css';
import { DEPARTMENT_NAMES } from '@incitio/compose';
import { CarryReport, FeedArrival, FeedChanges, SectionGallery } from './Weekly.js';
import { cachedDiff, deltaSaid, usePreviousWeek } from './week-diff.js';

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

interface Choosing {
  picked: Set<string>;
  toggle: (pageId: string) => void;
}

function Card({ page, index, choosing }: { page: CatalogPage; index: number; choosing: Choosing | null }) {
  const brand = useStudio((s) => s.brand);
  const document = useStudio((s) => s.document);
  const findings = useStudio((s) => s.findings);
  const openPage = useStudio((s) => s.openPage);
  const removePage = useStudio((s) => s.removePage);
  const addOffersToPage = useStudio((s) => s.addOffersToPage);
  const backgroundPages = useStudio((s) => s.backgroundPages);
  const uploadBackground = useStudio((s) => s.uploadBackground);
  const [taking, setTaking] = useState(false);
  const [dressing, setDressing] = useState(false);
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
  /*
   * A picture over the card — a file from the computer or one from the
   * library strip — becomes the page's background when it is let go.
   * Onto a page that is one of several picked, it goes under all of them.
   */
  const onto = (): string[] => (choosing?.picked.has(page.id) && choosing.picked.size > 1 ? [...choosing.picked] : [page.id]);
  const dresses = image ? {} : {
    onDragOver: (event: DragEvent) => {
      if (!carriesPicture(event)) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = 'copy';
      setDressing(true);
    },
    onDragLeave: () => setDressing(false),
    onDrop: (event: DragEvent) => {
      const kind = carriesPicture(event);
      if (!kind) return;
      event.preventDefault();
      event.stopPropagation();
      setDressing(false);
      if (kind === 'library') void backgroundPages(onto(), event.dataTransfer.getData(PICTURE_MIME));
      else {
        const [file] = droppedImages(event);
        if (file) void uploadBackground(onto(), file);
      }
    },
  };
  const takes = image ? {} : {
    onDragOver: (event: DragEvent) => {
      if (carriesPicture(event)) return dresses.onDragOver!(event);
      if (!event.dataTransfer.types.includes(OFFER_MIME)) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = 'copy';
      setTaking(true);
    },
    onDragLeave: () => { setTaking(false); setDressing(false); },
    onDrop: (event: DragEvent) => {
      if (carriesPicture(event)) return dresses.onDrop!(event);
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
      className={[
        `card${tone}${taking ? ' card--taking' : ''}`,
        dressing && bg.target,
        choosing && !image && bg.choosing,
        choosing?.picked.has(page.id) && bg.picked,
      ].filter(Boolean).join(' ')}
      data-drop-said={onto().length > 1 ? `Baggrund for ${onto().length} sider` : 'Slip for at lægge som baggrund'}
      style={{ background: groundOf(page, index) }}
      {...takes}
      onClick={() => (choosing ? (!image && choosing.toggle(page.id)) : openPage(page.id))}
      aria-pressed={choosing && !image ? choosing.picked.has(page.id) : undefined}
      title={image
        ? 'Billedside'
        : `Side ${index + 1}${empty ? ` · ${empty} ${empty === 1 ? 'tom plads' : 'tomme pladser'}` : ''}`}
    >
      {/* A thumbnail's photographs are thumbnails too — see `ImageSize`. */}
      <div className="card__live" aria-hidden="true"><ImageSize.Provider value={THUMB_PX}>{live}</ImageSize.Provider></div>
      {choosing && !image && (
        <>
          <span className={bg.check} aria-hidden="true">✓</span>
          <span className={`${bg.chip}${page.background ? '' : ` ${bg.chipNone}`}`}>
            {page.background && <i style={{ backgroundImage: `url("${page.background.imageUrl}")` }} />}
            {page.background ? page.background.subject || 'Eget billede' : 'Ingen baggrund'}
          </span>
        </>
      )}
      {!choosing && <button
        className="card__drop"
        title={`Slet side ${index + 1} (⌘Z fortryder)`}
        aria-label={`Slet side ${index + 1}`}
        onClick={(event) => { event.stopPropagation(); removePage(page.id); }}
      >×</button>}
      {/* A marker, not a banner: what is wrong is said under the page, in words. */}
      {verdict && (
        <span
          className={`card__flag${verdict.weight === 'stop' ? '' : ' card__flag--warn'}`}
          title={verdict.weight === 'stop' ? 'Skal rettes' : 'Værd at se på'}
          aria-label={verdict.weight === 'stop' ? 'Skal rettes' : 'Værd at se på'}
        />
      )}
    </div>
  );
}

function Caption({ page, index }: { page: CatalogPage; index: number }) {
  const findings = useStudio((s) => s.findings);
  const brand = useStudio((s) => s.brand);
  const document = useStudio((s) => s.document);
  const verdict = verdictOf(findings, page.id);
  const brandId = useStudio((s) => s.brandId);
  const catalogues = useStudio((s) => s.catalogues);
  const previous = usePreviousWeek(document, brandId, catalogues);
  const delta = deltaSaid(cachedDiff(previous, document)?.pages.get(page.id));
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
    // A page with no products — a cover, a banner — says nothing rather than "0 varer".
    : page.placements.length > 0 ? `${page.placements.length} ${page.placements.length === 1 ? 'vare' : 'varer'}` : '';

  return (
    <div className="leaf__cap">
      <b>
        {/* Named by its headline, else its one department; a mixed page is just its number. */}
        {page.title || isImagePage(page) || department
          ? `${index + 1} · ${page.title || (isImagePage(page) ? 'Billedside' : DEPARTMENT_NAMES[department!])}`
          : `Side ${index + 1}`}
      </b>
      {/* One line, cut by the width it has; the whole sentence on hover. */}
      <span className={verdict?.weight === 'stop' ? 'is-stop' : verdict ? 'is-warn' : ''} title={said}>
        {said}
      </span>
      {/* Since last week: what a reader checks first, on the card before anyone opens the page. */}
      {delta && <span className="leaf__delta" title="Ændret siden sidste uges avis">{delta}</span>}
    </div>
  );
}

/**
 * The avis in three numbers, beside its name: how many pages, how many
 * products, how many cells still waiting. The old line here said how
 * to drag a page — once read, it was the same sentence every visit.
 */
function BookSums() {
  const document = useStudio((s) => s.document);
  const brand = useStudio((s) => s.brand);
  const brandId = useStudio((s) => s.brandId);
  const catalogues = useStudio((s) => s.catalogues);
  const diff = cachedDiff(usePreviousWeek(document, brandId, catalogues), document);
  if (!document || document.pages.length === 0) return null;
  let offers = 0;
  let open = 0;
  for (const page of document.pages) {
    offers += page.placements.length;
    const template = brand
      ? resolveTemplate(brand, page.templateId) ?? document.templates.find((entry) => entry.id === page.templateId)
      : undefined;
    if (template && !isImagePage(page)) open += freeSlots(page, template).length;
  }
  const n = document.pages.length;
  return (
    <span className="book__said" title="Træk en side for at flytte den">
      {n} {n === 1 ? 'side' : 'sider'} · {offers} {offers === 1 ? 'vare' : 'varer'}
      {open > 0 && <> · <b className="book__open">{open} {open === 1 ? 'tom plads' : 'tomme pladser'}</b></>}
      {diff && diff.since !== null && (diff.fresh + diff.repriced + diff.gone > 0) && (
        <span className="book__delta">
          {' · siden uge '}{diff.since}: {[
            diff.fresh ? `${diff.fresh} nye` : '',
            diff.repriced ? `${diff.repriced} ny${diff.repriced === 1 ? '' : 'e'} pris${diff.repriced === 1 ? '' : 'er'}` : '',
            diff.gone ? `${diff.gone} ude` : '',
          ].filter(Boolean).join(', ')}
        </span>
      )}
    </span>
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
  const sectionCount = useStudio((s) => s.sections.length);
  const setOpen = useStudio((s) => s.setAddPagesOpen);
  const s = useStudioPick(
    'build', 'busy', 'curationReady', 'decorReady', 'document', 'feed', 'setReproduceOpen',
    'setSectionsOpen', 'togglePanel'
  );
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
            {sectionCount > 0 && <span className="ways2__price ways2__price--free">anbefalet</span>}
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
            title={s.feed ? '' : 'Hent ugens varer først — under Varer'}
            onClick={() => { setOpen(false); void s.build({ append: true }); }}
          >
            <span className="ways2__what">
              <b>Hurtigt udkast</b>
              <span>{s.feed ? 'Nye sider af de varer, der ikke står i avisen endnu — de andre sider røres ikke' : 'Kræver ugens varer fra fil'}</span>
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
/** Which theme the avis wears, and the way to change it. */
/**
 * The chain's varedesigns and the rules that pick them, beside the
 * avis they draw. They lived only on the front page and in search, and
 * people working on the pages did not know they existed.
 */
function ChainDesignButtons() {
  const designs = useStudio((s) => s.brand?.offerDesigns.length ?? 0);
  const rules = useStudio((s) => s.brand?.offerRules.length ?? 0);
  const setDesignsOpen = useStudio((s) => s.setDesignsOpen);
  const setRulesOpen = useStudio((s) => s.setRulesOpen);
  return (
    <>
      <button className="tool" onClick={() => setDesignsOpen(true)} title="Hvor billede, pris og tekst står på en vare">
        <span className="tool__icon" aria-hidden="true">◧</span>Varedesigns{designs ? <i className="tool__n">{designs}</i> : null}
      </button>
      <button className="tool" onClick={() => setRulesOpen(true)} title="Hvilket design en vare får, og hvornår">
        <span className="tool__icon" aria-hidden="true">⇄</span>Regler{rules ? <i className="tool__n">{rules}</i> : null}
      </button>
    </>
  );
}

function ThemeButton() {
  const theme = useStudio((s) => (s.variantBase ?? s.document)?.theme);
  const open = useStudio((s) => s.setThemesOpen);
  return (
    <button className={`tool${theme ? ' tool--on' : ''}`} onClick={() => open(true)} title="Pynt hele avisen til en anledning — fødselsdag, Halloween, Black Friday">
      <span className="tool__icon" aria-hidden="true">✦</span>{theme ? theme.name : 'Tema'}
    </button>
  );
}

function EmptyBook() {
  const s = useStudioPick('build', 'feed', 'feedOffers', 'setSectionsOpen', 'togglePanel');
  const sections = useStudio((state) => state.sections.length);
  return (
    <div className="empty">
      <h2>En ny avis</h2>
      <p className="empty__said">
        {s.feedOffers.length > 0
          ? `${s.feedOffers.length} af ugens varer er klar. Hvor skal siderne komme fra?`
          : 'Hent ugens varefil under Varer øverst — og vælg så, hvor siderne kommer fra.'}
      </p>
      <div className="empty__ways">
        {/* Offered only when there is something to choose: with none saved, it opened an empty gallery. */}
        <button
          className={`empty__way${sections ? ' empty__way--first' : ''}`}
          disabled={!sections}
          title={sections ? '' : 'Kæden har ingen gemte sektioner endnu. Når avisen har sider, gemmes en side som sektion fra ⋯ over siden.'}
          onClick={() => s.setSectionsOpen(true, 0)}
        >
          <b>Fra kædens sektioner</b>
          <span>{sections ? `${sections} gemte sidedesigns — fyldes med ugens varer efter afdeling` : 'Ingen gemte sektioner endnu'}</span>
          {sections > 0 && <i className="ways2__price ways2__price--free">anbefalet</i>}
        </button>
        <button className="empty__way" onClick={() => s.togglePanel('sider')}>
          <b>Fra en trykt avis</b>
          <span>Sæt et link ind — siderne kommer præcis som udgivet, og kan rettes bagefter</span>
        </button>
        <button
          className={`empty__way${sections ? '' : ' empty__way--first'}`}
          disabled={!s.feed}
          title={s.feed ? '' : 'Hent ugens varer først — under Varer'}
          onClick={() => void s.build({ fresh: true })}
        >
          <b>Hurtigt udkast</b>
          <span>Ugens varer i kædens egne layouts, afdeling for afdeling</span>
          {!sections && <i className="ways2__price ways2__price--free">anbefalet</i>}
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
  const [dressing, setDressing] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const choosing: Choosing | null = dressing ? {
    picked,
    toggle: (pageId) => setPicked((was) => {
      const next = new Set(was);
      if (next.has(pageId)) next.delete(pageId); else next.add(pageId);
      return next;
    }),
  } : null;
  const [over, setOver] = useState<number | null>(null);
  const aspect = useStudio((s) => s.brand?.pageAspect ?? 0.707);

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
      if (at === 0 || at % 2 === 1) groups.push({ at, pages: [page] });
      else groups[groups.length - 1]!.pages.push(page);
    });
  }

  return (
    // The chain's own page shape: an A4 chain's cards are A4, Wolt's and Løvbjerg's are 0.6.
    <main className="book" style={{ ['--aspect' as string]: String(aspect) }}>
      <div className="book__head">
        <h2>Avisen</h2>
        <BookSums />
        <div className="book__gap" />
        <div className="booktools" role="toolbar" aria-label="Avisens værktøjer">
          {pages.length > 0 && (
            <button
              className={`tool ${bg.feature}${dressing ? ` ${bg.featureOn}` : ''}`}
              aria-pressed={dressing}
              onClick={() => { setDressing(!dressing); setPicked(new Set()); }}
              title="Vælg baggrund for hver side — fra kædens bibliotek eller computeren"
            >
              <span className="tool__icon" aria-hidden="true">▣</span>Baggrunde
              {pages.some((p) => p.background && p.kind !== 'image')
                ? <i className="tool__n">{pages.filter((p) => p.background && p.kind !== 'image').length}/{pages.filter((p) => p.kind !== 'image').length}</i>
                : null}
            </button>
          )}
          <ThemeButton />
          <ChainDesignButtons />
          <button className="tool" onClick={() => setSectionsOpen(true)} title="Kædens gemte sidedesigns">
            <span className="tool__icon" aria-hidden="true">▤</span>Sektioner{sectionCount ? <i className="tool__n">{sectionCount}</i> : null}
          </button>
        </div>
        <div className="seg seg--small" role="group" aria-label="Vis som">
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

      {dressing && pages.length > 0 && (
        <BackgroundDock pages={pages} picked={picked} setPicked={setPicked} onClose={() => { setDressing(false); setPicked(new Set()); }} />
      )}
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
            draggable={!dressing}
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
                  <Card key={page.id} page={page} index={group.at + n} choosing={choosing} />
                ))}
              </div>
            ) : (
              <Card page={group.pages[0]!} index={group.at} choosing={choosing} />
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
