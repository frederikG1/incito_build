import { useEffect, useState } from 'react';
import { DEPARTMENT_NAMES, departmentOf } from '@incitio/compose';
import { TILE_PART_NAMES } from '@incitio/schema';
import type { TilePart } from '@incitio/schema';
import { useStudio } from './state.js';
import { PageGround } from './inspector/PageGround.js';
import { DecorInspector } from './inspector/DecorInspector.js';
import { NoteInspector } from './inspector/NoteInspector.js';
import { HiddenIncito, IncitoInspector } from './inspector/IncitoInspector.js';
import { DesignSay, RulesSay } from './inspector/TileSay.js';
import { PackPanel } from './inspector/PackPanel.js';
import { ArrangePanel } from './inspector/ArrangePanel.js';
import { ContentPanel } from './inspector/ContentPanel.js';
import { PartsPanel } from './inspector/PartsPanel.js';

type InspectorTab = 'indhold' | 'billede' | 'bokse';
const INSPECTOR_TABS: [InspectorTab, string][] = [
  ['indhold', 'Indhold'],
  ['billede', 'Billede'],
  ['bokse', 'Dele'],
];

/**
 * The per-tile panel.
 *
 * These edits are the "human finesse" the pipeline must not overwrite:
 * they live on the placement as overrides, so regenerating the geometry
 * does not silently discard a headline someone rewrote by hand.
 *
 * The panel is the precise half of the editing model — exact numbers,
 * every field in one place. The direct half lives on the tile itself
 * (see TileEditor): drag to pan, ⌘-wheel to zoom, double-click to
 * rewrite. Both write the same overrides, so neither is the "real" one.
 */
export function Inspector() {
  const {
    document, selectedOfferId, selectedPart, select, selectedPack,
    selectedDecorId, selectedNoteId, selectedIncito,
  } = useStudio();
  const [tab, setTab] = useState<InspectorTab>('indhold');
  /*
   * The tab follows the hand. Clicking a box on the sheet, or a product
   * in a pack, picks up something that lives in another tab — and the
   * sliders for it being one click away is the old below-the-fold
   * problem again.
   */
  useEffect(() => {
    if (selectedPart !== null) setTab('bokse');
  }, [selectedPart]);
  useEffect(() => {
    if (selectedPack !== null) setTab('billede');
  }, [selectedPack]);

  // Nothing selected — or a selection that no page holds any more,
  // as after a cell is refilled — shows the page's own panel.
  const nothing = (
      <aside className="inspector inspector--empty">
        {/* Page-level, so it is reachable with nothing selected — which
            is the state a freshly rebuilt page opens in. */}
        {/* What to do first, then what can be set for the page as a whole. */}
        <div className="inspector__startbox">
          <p className="inspector__start">Vælg en vare på siden for at rette den</p>
          <p className="inspector__chips">
            <span><kbd>Træk</kbd> fra listen for at bytte</span>
            <span><kbd>Dobbeltklik</kbd> retter tekst</span>
            <span><kbd>⌘Z</kbd> fortryder</span>
          </p>
        </div>
        <HiddenIncito />
        <PageGround />
      </aside>
  );

  if (selectedIncito) return <IncitoInspector />;
  if (selectedNoteId) return <NoteInspector noteId={selectedNoteId} />;
  if (selectedDecorId) return <DecorInspector decorId={selectedDecorId} />;
  if (!document || !selectedOfferId) return nothing;

  const offer = document.offers.find((o) => o.id === selectedOfferId);
  const onPage = document.pages
    .find((page) => page.placements.some((p) => p.offerId === selectedOfferId));
  const placement = onPage?.placements.find((p) => p.offerId === selectedOfferId);
  /*
   * Whether it already leads. The lead is the FIRST placement, which is
   * how `focusOffer` seats it — see the swap there; a button that
   * promotes something already at the top is a click that does nothing.
   */
  const leads = onPage?.placements[0]?.offerId === selectedOfferId;

  if (!offer || !placement) return nothing;

  const { overrides } = placement;
  /*
   * The box the panel is currently about.
   *
   * `null` means the tile as a whole, which is the artwork — the same
   * reading the keyboard and the tile overlay use, so the sliders below
   * always drive the thing the arrow keys would move.
   */
  const held: TilePart = selectedPart ?? 'media';

  return (
    <aside className="inspector">
      <header className="inspector__head">
        <h2>{overrides.displayName ?? offer.name}</h2>
        <button className="inspector__close" onClick={() => select(null)} aria-label="Luk">×</button>
      </header>

      {/*
        * One line of facts instead of a three-row table, and then three
        * tabs.
        *
        * The panel stacked nine sections for one selected vare — its
        * words, its pack, every box, the model, the page's own ground —
        * and the one somebody wanted was always below the fold. The
        * tabs split it by what you are touching: what the tile SAYS,
        * the pictures in it, and the boxes it is built from. Nothing
        * left; it is sorted.
        */}
      <p className="inspector__meta" title={`Varenr. ${offer.id}`}>
        {[
          `${offer.priceFrom ? 'fra ' : ''}${offer.price.toFixed(2).replace('.', ',')} kr.`,
          // The studio's own department — the word the shelf, Varer and the sections use — not the feed's category.
          DEPARTMENT_NAMES[departmentOf(offer)],
        ].filter(Boolean).join(' · ')}
      </p>
      <DesignSay offer={offer} />
      <RulesSay offer={offer} />
      <div className="inspector__tabs" role="tablist">
        {INSPECTOR_TABS.map(([id, name]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? 'is-on' : ''}
            onClick={() => setTab(id)}
          >{name}</button>
        ))}
      </div>

      {tab === 'billede' && (
        <>
          <PackPanel offer={offer} overrides={overrides} />
          <ArrangePanel offer={offer} />
          {/* The SHEET's own settings, at the foot of a panel about a vare.
              They are reachable from here because a page has no other panel
              — but they are set once per sheet and asked about last. */}
          <PageGround />
        </>
      )}
      {tab === 'indhold' && <ContentPanel offer={offer} overrides={overrides} onPage={onPage} leads={leads} />}
      {tab === 'bokse' && <PartsPanel offer={offer} overrides={overrides} onPage={onPage} slotId={placement.slotId} held={held} />}

      {/* Written out because the tile is where the work happens, and a
          shortcut nobody is told about is a shortcut nobody uses. */}
      <details className="inspector__keysbox">
        <summary>Genveje</summary>
        <ul className="inspector__keys">
        <li><b>Piletaster</b> flytter <b>{TILE_PART_NAMES[held]}</b> — med shift længere</li>
        <li><b>+</b> / <b>−</b> ændrer størrelsen, <b>0</b> nulstiller</li>
        <li><b>⌫</b> tager elementet af siden</li>
        <li><b>Dobbeltklik</b> retter teksten direkte på siden</li>
        <li><b>Esc</b> slipper elementet, så flisen</li>
        {offer.members.length > 1 && (
          <li><b>G</b> stiller varerne pænt op igen</li>
        )}
      </ul>
      </details>
    </aside>
  );
}
