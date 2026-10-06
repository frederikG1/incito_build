import { useState } from 'react';
import type { Offer } from '@incitio/schema';
import { useStudio } from '../state.js';

/**
 * The price, corrected by hand — the week's most common last-minute fix.
 *
 * Typed in kroner with a comma, as the page prints it. What the feed said
 * stays beside it for as long as they differ, with one click back to it,
 * and the checks before print list every price corrected this way.
 */
export function TilePrice({ offer }: { offer: Offer }) {
  const correct = useStudio((s) => s.correctPrice);
  const uncorrect = useStudio((s) => s.uncorrectPrice);
  const endGesture = useStudio((s) => s.endGesture);
  const said = (value: number | null) => (value === null ? '' : value.toFixed(2).replace('.', ','));
  const [price, setPrice] = useState(said(offer.price));
  const [pre, setPre] = useState(said(offer.prePrice));
  const read = (text: string) => Number(text.replace(/\s/g, '').replace(/\.(?=\d{3})/g, '').replace(',', '.'));
  const was = offer.corrected;

  return (
    <>
      <h3 className="inspector__group">Pris</h3>
      <div className="tileprice">
        <label className="inspector__field">
          <span>Pris, kr.{offer.priceFrom ? ' — laveste, der står "fra"' : ''}</span>
          <input
            inputMode="decimal"
            value={price}
            onChange={(event) => {
              setPrice(event.target.value);
              const value = read(event.target.value);
              if (event.target.value.trim() && Number.isFinite(value)) correct(offer.id, { price: Math.round(value * 100) / 100 });
            }}
            onBlur={endGesture}
          />
        </label>
        <label className="inspector__field">
          <span>Førpris, kr.</span>
          <input
            inputMode="decimal"
            value={pre}
            placeholder="ingen"
            onChange={(event) => {
              setPre(event.target.value);
              const value = read(event.target.value);
              if (!event.target.value.trim()) correct(offer.id, { prePrice: null });
              else if (Number.isFinite(value)) correct(offer.id, { prePrice: Math.round(value * 100) / 100 });
            }}
            onBlur={endGesture}
          />
        </label>
      </div>
      {was && (
        <p className="tileprice__was">
          Rettet i hånden — feedet siger {said(was.price)}{was.prePrice !== null ? ` (før ${said(was.prePrice)})` : ''}.{' '}
          <button
            className="inspector__link"
            onClick={() => { uncorrect(offer.id); setPrice(said(was.price)); setPre(said(was.prePrice)); }}
          >Brug feedets pris</button>
        </p>
      )}
    </>
  );
}
