import { brandCssVars, resolveLook } from '@incitio/schema';
import type { Offer } from '@incitio/schema';
import { THUMB_PX, useStudio } from '../state.js';
import { ruleFromOffer } from '../OfferRules.js';
import { DesignTile, ImageSize, designChoices } from '@incitio/renderer';
import { DesignButton } from '../DesignMenu.js';
import { templateOf } from '../inventory.js';

/**
 * Which of the chain's offer designs this tile is drawn with, and the
 * way into it — the design is where the picture, price and words stand,
 * so "why is the price there" is answered one click from the tile.
 */
export function DesignSay({ offer }: { offer: Offer }) {
  const brand = useStudio((s) => s.brand);
  const document = useStudio((s) => s.document);
  const pageId = useStudio((s) => s.activePageId);
  const open = useStudio((s) => s.setDesignsOpen);
  if (!brand || !document || brand.offerDesigns.length === 0) return null;
  const page = document.pages.find((entry) => entry.id === pageId && entry.placements.some((p) => p.offerId === offer.id))
    ?? document.pages.find((entry) => entry.placements.some((p) => p.offerId === offer.id));
  const template = page ? templateOf(document, brand, page.templateId) : undefined;
  const placement = page?.placements.find((p) => p.offerId === offer.id);
  if (!page || !template || !placement) return null;
  const offers = new Map(document.offers.map((entry) => [entry.id, entry]));
  const choice = designChoices(page, template, brand, offers).get(placement.slotId);
  return (
    <section className="inspector__design" aria-label="Varens design">
      <span className="inspector__designcell" style={brandCssVars(brand) as React.CSSProperties}>
        {choice && <ImageSize.Provider value={THUMB_PX}><DesignTile design={choice.design} offer={offer} aspect={1} /></ImageSize.Provider>}
      </span>
      <span className="inspector__designsaid">
        <small>Varedesign</small>
        <b title={choice?.because}>{choice?.design.tag ?? 'Kædens fliser'}</b>
        <span className="inspector__designdo">
          <DesignButton scope={{ kind: 'tile', pageId: page.id, offerId: offer.id }} className="thin">Skift ▾</DesignButton>
          {choice && <button className="go" onClick={() => open(true, { designId: choice.design.id })}>✎ Ret design</button>}
        </span>
      </span>
    </section>
  );
}

/**
 * Which of the chain's rules this offer answers to, in one line — so a
 * price that moved to the right is never a mystery. A click opens them.
 */
export function RulesSay({ offer }: { offer: Offer }) {
  const brand = useStudio((s) => s.brand);
  const open = useStudio((s) => s.setRulesOpen);
  const setRules = useStudio((s) => s.setOfferRules);
  if (!brand) return null;
  const look = resolveLook(offer, brand.offerRules);
  const names = [...new Set(Object.values(look.because))];
  return (
    <p className="inspector__rules">
      {names.length > 0 && (
        <button onClick={() => open(true)} title="Åbn reglerne for varer">Regel: {names.join(', ')}</button>
      )}
      {/* Made from this product: what it IS becomes the condition. */}
      <button
        onClick={() => { setRules([ruleFromOffer(offer), ...brand.offerRules]); open(true); }}
        title="Lav en regel, der rammer denne vare og dem, der ligner den"
      >
        + Regel for varer som denne
      </button>
    </p>
  );
}
