import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { brandCssVars, designTags, type Offer } from '@incitio/schema';
import { DesignTile, ImageSize, designChoices } from '@incitio/renderer';
import { THUMB_PX, useStudio, useStudioPick } from './state.js';
import { usePopover } from './popover.js';
import { templateOf } from './inventory.js';
import { blankDesign, freeTag } from './design-new.js';
import { newDesignId } from './design-parts.js';

/**
 * "Which design" — asked where the product is, answered with pictures.
 *
 * The same menu drops from the page's toolbar (the design every product
 * on the page gets) and from a selected tile (just this one). Each
 * choice is the product drawn in that design, so picking is looking.
 * Under the choices, the ways on: draw the design that is on, make a
 * new one, or open the rules that choose for whole kinds of products.
 */

export type DesignScope = { kind: 'tile'; pageId: string; offerId: string } | { kind: 'page'; pageId: string };

export function DesignMenu({ scope, anchor, onClose }: { scope: DesignScope; anchor: DOMRect; onClose: () => void }) {
  const s = useStudioPick('brand', 'document', 'setDesignsOpen', 'setOfferDesigns', 'setPageDesignTag', 'setRulesOpen', 'updateOverrides');
  usePopover(true, onClose);
  const box = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<CSSProperties>({ left: anchor.left, top: anchor.bottom + 6, visibility: 'hidden' });

  // Beside the product being changed — never over it — and inside the window.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const clampTop = (t: number) => Math.max(8, Math.min(t, vh - h - 8));
    const tile = scope.kind === 'tile'
      ? window.document.querySelector(`[data-offer-id="${CSS.escape(scope.offerId)}"]`)?.getBoundingClientRect()
      : undefined;
    if (tile) {
      const gap = 12;
      const right = tile.right + gap;
      const left = tile.left - gap - w;
      if (right + w <= vw - 8) return setPlace({ left: right, top: clampTop(tile.top) });
      if (left >= 8) return setPlace({ left, top: clampTop(tile.top) });
      const below = tile.bottom + gap;
      return setPlace({
        left: Math.max(8, Math.min(tile.left, vw - w - 8)),
        top: below + h <= vh - 8 ? below : Math.max(8, tile.top - gap - h),
      });
    }
    const below = anchor.bottom + 6;
    setPlace({
      left: Math.max(8, Math.min(anchor.left, vw - w - 8)),
      top: below + h > vh - 8 ? Math.max(8, anchor.top - h - 6) : below,
    });
  }, [anchor, scope]);

  const brand = s.brand;
  const document = s.document;
  const page = document?.pages.find((entry) => entry.id === scope.pageId) ?? null;
  if (!brand || !document || !page) return null;
  const designs = brand.offerDesigns;
  const tags = designTags(designs);
  const offers = new Map(document.offers.map((offer) => [offer.id, offer]));

  const placement = scope.kind === 'tile' ? page.placements.find((p) => p.offerId === scope.offerId) : undefined;
  const template = templateOf(document, brand, page.templateId);
  const drawn = template && placement ? designChoices(page, template, brand, offers).get(placement.slotId) ?? null : null;
  const example: Offer | null = scope.kind === 'tile'
    ? offers.get(scope.offerId) ?? null
    : page.placements.map((p) => offers.get(p.offerId)).find((o) => o?.imageUrl) ?? offers.get(page.placements[0]?.offerId ?? '') ?? null;

  const chosen = scope.kind === 'tile' ? placement?.overrides.design ?? null : page.design?.tag ?? null;
  const pageTag = page.design?.tag ?? brand.designTag ?? tags[0] ?? null;
  const onTag = scope.kind === 'tile' ? (drawn?.design.tag ?? chosen) : (chosen ?? pageTag);
  // The design "Ret" opens: the very one drawn on this tile, else the first of the tag in use.
  const editable = scope.kind === 'tile' && drawn ? drawn.design : designs.find((d) => d.tag === onTag) ?? null;

  const choose = (tag: string | null) => {
    if (scope.kind === 'tile') s.updateOverrides(scope.offerId, { design: tag });
    else s.setPageDesignTag(scope.pageId, tag);
  };
  const makeNew = () => {
    const design = blankDesign(newDesignId(), freeTag(designs));
    s.setOfferDesigns([...designs, design], brand.designTag ?? tags[0] ?? design.tag);
    choose(design.tag);
    onClose();
    s.setDesignsOpen(true, { designId: design.id });
  };

  const cell = (tag: string) => {
    const design = designs.find((d) => d.tag === tag)!;
    return (
      <span className="dmenu__cell" style={brandCssVars(brand) as CSSProperties}>
        {example && <ImageSize.Provider value={THUMB_PX}><DesignTile design={design} offer={example} aspect={1} /></ImageSize.Provider>}
      </span>
    );
  };

  return createPortal(
    <div ref={box} className="dmenu" role="dialog" aria-label={scope.kind === 'tile' ? 'Design for varen' : 'Design for siden'} style={place}
      // A portal still bubbles through React: the page under it must not take this click as "deselect".
      onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
      <header className="dmenu__head">
        <b>{scope.kind === 'tile' ? 'Design for varen' : 'Design for siden'}</b>
        <span>{scope.kind === 'tile'
          ? 'Gælder kun denne vare — ellers bestemmer reglerne og siden.'
          : 'Varer uden en regel eller eget valg tegnes sådan.'}</span>
      </header>
      {designs.length === 0 ? (
        <p className="dmenu__empty">Kæden har ingen varedesigns endnu.</p>
      ) : (
        <div className="dmenu__grid">
          <button className={`dmenu__item${chosen === null ? ' is-on' : ''}`} onClick={() => choose(null)}
            title={scope.kind === 'tile' ? 'Som reglerne og siden siger' : 'Kædens standard'}>
            {scope.kind === 'tile' && drawn && chosen === null
              ? cell(drawn.design.tag)
              : pageTag ? cell(scope.kind === 'tile' ? pageTag : (brand.designTag ?? pageTag)) : <span className="dmenu__cell" />}
            <small>{scope.kind === 'tile' ? 'Automatisk' : `Kædens (${brand.designTag ?? tags[0]})`}</small>
          </button>
          {tags.map((tag) => (
            <button key={tag} className={`dmenu__item${chosen === tag ? ' is-on' : ''}${chosen === null && onTag === tag ? ' is-auto' : ''}`}
              onClick={() => choose(tag)} title={tag}>
              {cell(tag)}
              <small>{tag}</small>
            </button>
          ))}
        </div>
      )}
      <footer className="dmenu__foot">
        <button className="go" disabled={!editable} onClick={() => { onClose(); s.setDesignsOpen(true, { designId: editable?.id ?? null }); }}>
          ✎ Ret {editable ? `«${editable.tag}»` : 'designet'}
        </button>
        <button className="thin" onClick={makeNew}>+ Nyt design</button>
        <button className="thin" onClick={() => { onClose(); s.setRulesOpen(true); }}>Regler</button>
        <button className="thin" onClick={() => { onClose(); s.setDesignsOpen(true); }}>Alle designs</button>
      </footer>
    </div>,
    window.document.body,
  );
}

/** A button that opens the menu under itself. */
export function DesignButton({ scope, className, children, title }: {
  scope: DesignScope; className?: string; children: React.ReactNode; title?: string;
}) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  return (
    <>
      <button
        className={className}
        title={title}
        aria-haspopup="dialog"
        aria-expanded={Boolean(anchor)}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          setAnchor(anchor ? null : event.currentTarget.getBoundingClientRect());
        }}
      >{children}</button>
      {anchor && <DesignMenu scope={scope} anchor={anchor} onClose={() => setAnchor(null)} />}
    </>
  );
}
