import type React from 'react';
import { brandCssVars, type DesignLayer, type Offer, type OfferDesign, type OfferType } from '@incitio/schema';
import { DesignTile, ImageSize } from '@incitio/renderer';
import { THUMB_PX, useStudio } from './state.js';

/** The words and the small drawing the design list and the design editor share. */

export const LAYER_WORDS: Record<string, string> = {
  offer_image: 'Billede', offer_bg_image: 'Baggrund', offer_text: 'Tekst', offer_price: 'Pris',
  offer_savings: 'Besparelse', offer_membership_price: 'Medlemspris', offer_membership_savings: 'Medlemsbesparelse',
  offer_membership_relative_savings: 'Medlemsrabat %', offer_relative_savings: 'Rabat %', offer_logos: 'Mærker',
  offer_energy_class: 'Energimærke',
  offer_custom_label_1: 'Etiket 1', offer_custom_label_2: 'Etiket 2', offer_custom_label_3: 'Etiket 3',
  offer_comment_label_1: 'Kommentar 1', offer_comment_label_2: 'Kommentar 2', offer_comment_label_3: 'Kommentar 3',
};
export const layerWord = (layer: DesignLayer) => (layer.type ? LAYER_WORDS[layer.type] ?? layer.type : layer.name || 'Gruppe');

export const TYPE_WORDS: Record<OfferType, string> = {
  regular_price: 'Almindelig pris', regular_price_with_savings: 'Almindelig pris med besparelse',
  membership_price: 'Medlemspris', membership_price_with_savings: 'Medlemspris med besparelse',
  membership_relative_savings: 'Medlemsrabat i %', relative_savings: 'Rabat i %', app_price: 'App-pris', from_price: 'Fra-pris', get_x_for_y: 'Flerstyk (2 for …)',
};

export const round = (value: number) => Math.round(value * 10000) / 10000;
export const newDesignId = () => `d-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/** One design, drawn with one offer, in a square cell on the chain's ground. */
export function Preview({ design, offer, px = THUMB_PX, aspect = 1 }: { design: OfferDesign; offer: Offer | null; px?: number; aspect?: number }) {
  const brand = useStudio((s) => s.brand);
  if (!brand) return null;
  return (
    <div className="dpreview" style={{ ...brandCssVars(brand), aspectRatio: String(aspect) } as React.CSSProperties}>
      <ImageSize.Provider value={px}>
        {offer ? <DesignTile design={design} offer={offer} aspect={aspect} /> : <span className="dpreview__none">Ingen vare at vise med</span>}
      </ImageSize.Provider>
    </div>
  );
}

