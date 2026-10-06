import type { DesignParagraph, Offer, PriceStyle } from '@incitio/schema';
import { incitoVars, pricePieces, renderLiquid } from '@incitio/renderer';

/**
 * The price, set the way the chain's printed marks set it.
 *
 * Shown under a paragraph that prints a price (`format_price`). What the
 * CMS can say is written where the CMS keeps it — the ending after whole
 * kroner is the tag's own `postfix`, the weight `text_weight`, the
 * spacing `text_letter_spacing` — so a copy back to the CMS keeps it.
 * The rest (raised øre, their size and lift, a heavier weight, another
 * face) is the studio's own, in `incito_price`.
 */

/**
 * Whether a paragraph prints a price. Said outright (`format_price`,
 * `{{offerPrice}}`, a saving), or — as SuperBrugsen's labels do, "36,-"
 * in `offerCustomLabel3` — found by printing it with the week's products
 * and seeing a figure. The product's name and description never count.
 */
export function isPriceParagraph(p: DesignParagraph, offers: readonly Offer[] = []): boolean {
  const text = p.text_content;
  if (/\{\{\s*offer(Name|Description)\b/.test(text)) return false;
  if (/format_price|\{\{\s*offer\w*(Price|Savings)\b/.test(text)) return true;
  if (!/\{\{|\{%/.test(text)) return false;
  return offers.slice(0, 24).some((offer) => pricePieces(renderLiquid(text, incitoVars(offer))) !== null);
}

/** The ending a whole price is printed with: the tag's `postfix`, ",-" when it names none. */
export function postfixOf(text: string): string {
  return /postfix:\s*"([^"]*)"/.exec(text)?.[1] ?? ',-';
}

export function withPostfix(text: string, postfix: string): string {
  if (/postfix:\s*"[^"]*"/.test(text)) return text.replace(/postfix:\s*"[^"]*"/g, `postfix:"${postfix}"`);
  return text.replace(/(\{%\s*format_price[^%]*?)\s*%\}/g, `$1 postfix:"${postfix}" %}`);
}

const FONTS: [string | null, string][] = [
  [null, 'Som teksten'],
  ["'COOP Publication', 'COOP', sans-serif", 'COOP som i Tjek (ekstra kraftig)'],
  ["'COOP', sans-serif", 'COOP'],
  ["'Logical', sans-serif", 'Logical'],
  ["'Omnes', sans-serif", 'Omnes'],
  ["'Roboto', sans-serif", 'Roboto'],
  ["'Inter', sans-serif", 'Inter'],
  ["'Rubik', sans-serif", 'Rubik'],
];

const WEIGHTS: [string, string][] = [['normal', 'Normal'], ['bold', 'Fed'], ['black', 'Ekstra fed']];

export function PriceStyleFields({ p, onChange, testPrice, onTestPrice, onAll, count }: {
  p: DesignParagraph;
  /** A patch for the paragraph, with the history key to coalesce under. */
  onChange: (patch: Partial<DesignParagraph>, key: string | null) => void;
  testPrice: number | null;
  onTestPrice: (price: number | null) => void;
  /** Use this paragraph's price style on every price in the chain's designs. */
  onAll: () => void;
  /** How many price paragraphs the chain has, for the button's words. */
  count: number;
}) {
  const style: PriceStyle = p.incito_price ?? {};
  const set = (patch: Partial<PriceStyle>, key: string | null = null) =>
    onChange({ incito_price: { ...style, ...patch } }, key);
  const weight = style.weight && style.weight >= 800 ? 'black' : p.text_weight === 'normal' ? 'normal' : 'bold';
  const postfix = postfixOf(p.text_content);

  return (
    <div className="pricestyle">
      <b className="pricestyle__title">Prisens udseende</b>

      <div className="pricestyle__row">
        <span>Øre og ,-</span>
        <span className="seg">
          <button className={style.minor !== 'raised' ? 'is-on' : ''} onClick={() => set({ minor: 'inline' })}>45,-</button>
          <button className={style.minor === 'raised' ? 'is-on' : ''} onClick={() => set({ minor: 'raised' })}>45<sup>,-</sup> hævet</button>
        </span>
      </div>
      {style.minor === 'raised' && (
        <>
          <label className="pricestyle__row">
            <span>Størrelse <i>{style.minorSize ?? 50} %</i></span>
            <input type="range" min={20} max={100} step={1} value={style.minorSize ?? 50}
              onChange={(e) => set({ minorSize: Number(e.target.value) }, `ps:size:${p.id}`)} />
          </label>
          <label className="pricestyle__row">
            <span>Løft <i>{style.minorRaise ?? 35} %</i></span>
            <input type="range" min={0} max={80} step={1} value={style.minorRaise ?? 35}
              onChange={(e) => set({ minorRaise: Number(e.target.value) }, `ps:raise:${p.id}`)} />
          </label>
        </>
      )}

      <div className="pricestyle__row">
        <span>Mellem kr. og øre</span>
        <span className="seg">
          {([[',', '19,95'], ['.', '19.95'], ['', '19 95']] as const).map(([value, said]) => (
            <button key={said} className={(style.separator ?? ',') === value ? 'is-on' : ''} onClick={() => set({ separator: value })}>{said}</button>
          ))}
        </span>
      </div>

      {/format_price/.test(p.text_content) && <div className="pricestyle__row">
        <span>Efter hele kroner</span>
        <span className="seg">
          {([',-', '.-', ':-', ''] as const).map((value) => (
            <button key={value || 'none'} className={postfix === value ? 'is-on' : ''}
              onClick={() => onChange({ text_content: withPostfix(p.text_content, value) }, null)}>
              45{value || ' (intet)'}
            </button>
          ))}
        </span>
      </div>}

      <label className="pricestyle__row">
        <span>Skrift</span>
        <select value={style.font ?? ''} onChange={(e) => set({ font: e.target.value || null })}>
          {FONTS.map(([value, said]) => <option key={said} value={value ?? ''}>{said}</option>)}
        </select>
      </label>

      <div className="pricestyle__row">
        <span>Tykkelse</span>
        <span className="seg">
          {WEIGHTS.map(([value, said]) => (
            <button key={value} className={weight === value ? 'is-on' : ''} onClick={() => onChange({
              text_weight: value === 'normal' ? 'normal' : 'bold',
              incito_price: { ...style, weight: value === 'black' ? 900 : null },
            }, null)}>{said}</button>
          ))}
        </span>
      </div>

      <label className="pricestyle__row">
        <span>Afstand mellem tegn <i>{(p.text_letter_spacing ?? 0).toFixed(1)}</i></span>
        <input type="range" min={-4} max={4} step={0.1} value={p.text_letter_spacing ?? 0}
          onChange={(e) => onChange({ text_letter_spacing: Number(e.target.value) || null }, `ps:ls:${p.id}`)} />
      </label>

      <div className="pricestyle__row">
        <span>Prøv med</span>
        <span className="seg">
          {([null, 19.95, 45, 1299, 9.5] as const).map((value) => (
            <button key={String(value)} className={testPrice === value ? 'is-on' : ''} onClick={() => onTestPrice(value)}>
              {value === null ? 'varens' : value % 1 === 0 ? `${value.toLocaleString('da-DK')},-` : value.toFixed(2).replace('.', ',')}
            </button>
          ))}
        </span>
      </div>

      <button className="thin pricestyle__all" onClick={onAll}>
        Brug på alle priser i kædens designs ({count})
      </button>
    </div>
  );
}
