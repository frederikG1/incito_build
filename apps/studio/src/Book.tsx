import { useMemo, useState, type DragEvent } from 'react';
import { isImagePage, type CatalogPage, type PageTemplate } from '@incitio/schema';
import { resolveTemplate } from '@incitio/brands';
import { ImagePage, PageView } from '@incitio/renderer';
import { useStudio } from './state.js';
import type { Finding } from './findings.js';
import { OFFER_MIME, droppedOffers } from './Tray.js';

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
  const filled = new Set(page.placements.map((placement) => placement.slotId));
  const empty = template ? template.slots.filter((slot) => !filled.has(slot.id)).length : 0;
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
  const said = verdict
    ? (page.placements.length < cells
      ? `${page.placements.length} af ${cells} pladser fyldt`
      : verdict.said.replace(/^Side \d+: /, ''))
    : `${page.placements.length} ${page.placements.length === 1 ? 'vare' : 'varer'}`;

  return (
    <div className="leaf__cap">
      <b>{index + 1} · {page.title || (isImagePage(page) ? 'Billedside' : 'uden overskrift')}</b>
      <span className={verdict?.weight === 'stop' ? 'is-stop' : verdict ? 'is-warn' : ''}>
        {said.length > 40 ? `${said.slice(0, 38)}…` : said}
      </span>
    </div>
  );
}

/** The four ways a page can come into being, priced. */
function AddPages() {
  const open = useStudio((s) => s.addPagesOpen);
  const setOpen = useStudio((s) => s.setAddPagesOpen);
  const s = useStudio();
  // Leftward keeps it inside the window at the end of a long book; on
  // an empty book the card is the first thing and left is off-screen.
  const [right, setRight] = useState(false);

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
      <span className="add__said">4 veje · med pris</span>

      {open && (
        <div className={`ways2${right ? ' ways2--right' : ''}`}>
          {/*
            * Cheapest first, and every route wears its price.
            *
            * Nothing in the studio said which of the four cost money;
            * two are free, one is a model call per page, one is two
            * model calls. Sorting by that is the whole point of the
            * control.
            */}
          <p className="ways2__head">Billigst først</p>

          <button
            className="ways2__way"
            disabled={Boolean(s.busy)}
            onClick={() => { setOpen(false); s.togglePanel('sider'); }}
          >
            <span className="ways2__what">
              <b>Fra et link til en udgivelse</b>
              <span>Gitteret læses ud af udgivelsen selv</span>
            </span>
            <span className="ways2__price ways2__price--free">gratis</span>
          </button>

          <button
            className="ways2__way"
            disabled={Boolean(s.busy) || !s.feed}
            title={s.feed ? '' : 'Upload et feed først'}
            onClick={() => { setOpen(false); void s.build({ fresh: true }); }}
          >
            <span className="ways2__what">
              <b>Hurtigt udkast fra feedet</b>
              <span>Kategorier i kædens egne layouts</span>
            </span>
            <span className="ways2__price ways2__price--free">gratis</span>
          </button>

          <button
            className="ways2__way"
            disabled={Boolean(s.busy)}
            onClick={() => { setOpen(false); s.setReproduceOpen(true); }}
          >
            <span className="ways2__what">
              <b>Genskab trykte sider</b>
              <span>Aflevér fotos eller et sideinterval af en PDF</span>
            </span>
            <span className="ways2__price ways2__price--paid">≈ 25 øre/side</span>
          </button>

          <button
            className="ways2__way ways2__way--model"
            disabled={Boolean(s.busy) || !s.feed || !s.decorReady}
            title={s.decorReady ? '' : 'Kræver en Gemini-nøgle'}
            onClick={() => { setOpen(false); s.togglePanel('sider'); }}
          >
            <span className="ways2__what">
              <b>Lad modellen tegne en</b>
              <span>Ingen reference — tegningen smides væk</span>
            </span>
            <span className="ways2__price ways2__price--model">2 kald</span>
          </button>
        </div>
      )}
    </div>
  );
}

export function Book() {
  const document = useStudio((s) => s.document);
  const bookView = useStudio((s) => s.bookView);
  const setBookView = useStudio((s) => s.setBookView);
  const movePage = useStudio((s) => s.movePage);
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
              const page = pages[from];
              if (!page) return;
              for (let at = from; at !== group.at; at += delta) movePage(page.id, delta);
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

        <AddPages />
      </div>
    </main>
  );
}
