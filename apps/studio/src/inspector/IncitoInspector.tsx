import { useState } from 'react';
import type { CatalogPage, Offer } from '@incitio/schema';
import { useStudio } from '../state.js';
import { incitoSlotOf, pageBlocks, type IncitoBlock } from '@incitio/renderer';
import { Measure } from '../Measure.js';

const BLOCK_KINDS: Record<IncitoBlock['kind'], string> = {
  skilt: 'Skilt',
  tekst: 'Tekst',
  billede: 'Billede',
  mærker: 'Mærker',
};

/** The published page the canvas is on, when it prints as published. */
function usePublishedPage() {
  const document = useStudio((s) => s.document);
  const openPageId = useStudio((s) => s.openPageId);
  const activePageId = useStudio((s) => s.activePageId);
  const selected = useStudio((s) => s.selectedIncito);
  const id = selected?.pageId ?? openPageId ?? activePageId;
  const page = document?.pages.find((entry) => entry.id === id);
  return page && page.incito && page.exact ? page : null;
}

/**
 * One element of a page printed as published: a roundel, a price mark,
 * the words under a product.
 *
 * Two things to do with it, and both are corrections laid over the
 * publication rather than changes to it — see `CatalogPage.incitoEdits`
 * — so "Nulstil" always gets back to what was published.
 */
export function IncitoInspector() {
  const selected = useStudio((s) => s.selectedIncito);
  const select = useStudio((s) => s.selectIncito);
  const edit = useStudio((s) => s.editIncito);
  const hide = useStudio((s) => s.hideIncito);
  const move = useStudio((s) => s.moveIncito);
  const endGesture = useStudio((s) => s.endGesture);
  const document = useStudio((s) => s.document);
  const setOfferPrice = useStudio((s) => s.setOfferPrice);
  const page = usePublishedPage();
  const block = page?.incito && selected
    ? pageBlocks({ ...page, incito: page.incito }, document?.offers ?? [], document?.templates.find((t) => t.id === page.templateId))
      .find((entry) => entry.path === selected.path)
    : undefined;
  if (!page || !selected || !block) {
    return <aside className="inspector inspector--empty"><p>Elementet findes ikke længere.</p></aside>;
  }

  const saved = page.incitoEdits?.[block.path];
  const hidden = saved?.hidden ?? false;
  /*
   * The words as they stand on the page — a product that took over this
   * cell prints its own name here, not the publication's. Read off the
   * rendered element, which is the one place that has done that
   * substitution; the element's own lines only, not those of an element
   * nested inside it.
   */
  const element = window.document.querySelector(
    `[data-page-id="${CSS.escape(page.id)}"] [data-incito-block="${CSS.escape(block.path)}"]`,
  );
  const shown = element
    ? [...element.querySelectorAll('p.tjek-incito__text-view')]
      .filter((line) => line.closest('[data-incito-block]') === element)
      .map((line) => line.textContent ?? '')
    : [];
  const texts = block.texts.map((text, index) => saved?.texts?.[index] ?? shown[index] ?? text);
  const offer = cellOffer(page, block.offerId, document?.offers ?? []);

  return (
    <aside className="inspector">
      <div className="inspector__head">
        <h2>{offer ? offer.name : `${BLOCK_KINDS[block.kind]} på siden`}</h2>
        <button className="thin" onClick={() => select(page.id, null)} title="Slip (Esc)">×</button>
      </div>
      <p className="inspector__said">
        {hidden
          ? 'Slettet fra siden — det kommer ikke med i PDF\'en.'
          : offer
            ? 'Byt varen: træk en anden vare fra listen til venstre over på den.'
            : 'Som i den trykte avis — dine rettelser kommer ovenpå.'}
      </p>

      {offer && <OfferPrice key={offer.id} offer={offer} onPrice={(price) => setOfferPrice(offer.id, price)} onDone={endGesture} />}

      <div className="incito__do">
        <button
          className={hidden ? 'go' : 'thin thin--drop'}
          onClick={() => hide(page.id, block.path, !hidden)}
          title={hidden ? '' : 'Eller tryk ⌫'}
        >
          {hidden ? 'Vis på siden igen' : 'Slet fra siden ⌫'}
        </button>
        {saved && (
          <button className="thin" onClick={() => edit(page.id, block.path, { hidden: false, texts: null })}>
            Nulstil
          </button>
        )}
      </div>

      <Measure target={{
        key: `incito:${page.id}:${block.path}`,
        pageId: page.id,
        selectors: [`[data-incito-block="${CSS.escape(block.path)}"]`],
        write: (to, from, _size, gesture) => {
          // The sheet's points are the pixels here, so a pixel moved is a point moved.
          if (to.x !== from.x || to.y !== from.y) move(page.id, block.path, { dx: to.x - from.x, dy: to.y - from.y }, gesture);
          if (Math.abs(to.w - from.w) > 0.01 && from.w > 0) {
            const was = useStudio.getState().document?.pages.find((p) => p.id === page.id)?.incitoEdits?.[block.path]?.scale ?? 1;
            move(page.id, block.path, { scaleBy: was * (to.w / from.w) - was }, gesture);
          }
        },
      }} />

      <section className="incito__place">
        <h4>Placering</h4>
        <label className="incito__line">
          <span>Størrelse {(saved?.scale ?? 1).toFixed(2)}×</span>
          <input
            type="range" min={0.3} max={3} step={0.01}
            value={saved?.scale ?? 1}
            onChange={(event) => move(page.id, block.path, { scaleBy: Number(event.target.value) - (saved?.scale ?? 1) }, `incito-size-${block.path}`)}
            onPointerUp={endGesture}
          />
        </label>
        {(saved?.dx || saved?.dy || (saved?.scale ?? 1) !== 1) ? (
          <button className="thin" onClick={() => move(page.id, block.path, { reset: true })}>Nulstil placering</button>
        ) : null}
        <p className="inspector__hint">
          <b>Træk</b> for at flytte · <b>⌘ + scroll</b> for størrelse · <b>Esc</b> slipper
        </p>
      </section>

      {texts.length > 0 && (
        <section className="incito__lines">
          <h4>Tekst</h4>
          {texts.map((text, index) => (
            <label key={index} className="incito__line">
              <span>Linje {index + 1}</span>
              <textarea
                rows={Math.min(4, Math.max(1, Math.ceil(text.length / 28)))}
                value={text}
                onChange={(event) => {
                  const next = [...texts];
                  next[index] = event.target.value;
                  edit(page.id, block.path, { texts: next }, `incito-text-${block.path}`);
                }}
                onBlur={endGesture}
              />
            </label>
          ))}
          <p className="inspector__hint">Skrifttype, størrelse og placering følger udgivelsen.</p>
        </section>
      )}
    </aside>
  );
}

/** The product standing in a published offer's cell now — by cell, as `incitoCells` reads it. */
function cellOffer(page: CatalogPage, viewId: string | null, offers: Offer[]): Offer | null {
  if (!viewId) return null;
  const slotId = incitoSlotOf(page, viewId);
  const placement = page.placements.find((entry) => entry.slotId === slotId);
  return offers.find((entry) => entry.id === placement?.offerId) ?? null;
}

/** The product in the cell and its price, which the page's mark is set from. */
function OfferPrice({ offer, onPrice, onDone }: { offer: Offer; onPrice: (price: number) => void; onDone: () => void }) {
  const [typed, setTyped] = useState(offer.price.toFixed(2).replace('.', ','));
  return (
    <section className="incito__lines">
      <label className="incito__line">
        <span>Pris, kr.{offer.priceFrom ? ' (laveste — der står "fra")' : ''}</span>
        <input
          inputMode="decimal"
          value={typed}
          onChange={(event) => {
            setTyped(event.target.value);
            const price = Number(event.target.value.replace(/\s/g, '').replace(',', '.'));
            if (event.target.value.trim() && Number.isFinite(price)) onPrice(Math.round(price * 100) / 100);
          }}
          onBlur={onDone}
        />
      </label>
    </section>
  );
}

/** The elements somebody took off a published page, to put back. */
export function HiddenIncito() {
  const page = usePublishedPage();
  const select = useStudio((s) => s.selectIncito);
  const hide = useStudio((s) => s.hideIncito);
  const offers = useStudio((s) => s.document?.offers);
  const templates = useStudio((s) => s.document?.templates);
  if (!page?.incito) return null;
  const all = pageBlocks({ ...page, incito: page.incito }, offers ?? [], templates?.find((t) => t.id === page.templateId));
  const gone = all.filter((block) => page.incitoEdits?.[block.path]?.hidden);
  // A disc taken off with its words is one thing to put back, listed by its words.
  const hidden = gone.filter((block) => block.texts.length > 0
    || !block.companions.some((path) => gone.some((other) => other.path === path)));
  return (
    <section className="incito__hidden">
      {hidden.length > 0 && (
        <>
          <h4>Skjult fra siden · {hidden.length}</h4>
          <ul>
            {hidden.map((block) => (
              <li key={block.path}>
                <button className="incito__name" onClick={() => select(page.id, block.path)}>
                  {BLOCK_KINDS[block.kind]}{block.texts.length ? ` — ${block.texts.join(' ').slice(0, 40)}` : ''}
                </button>
                <button className="thin" onClick={() => hide(page.id, block.path, false)}>Vis</button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
