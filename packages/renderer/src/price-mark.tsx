import type { ReactNode } from 'react';
import type { PriceStyle } from '@incitio/schema';

/**
 * A price as a price mark sets it: the kroner large, what follows them —
 * the øre, or the ",-" of a whole price — smaller and lifted beside them.
 *
 * The CMS prints "19,95" and "45,-" as plain text; a chain's printed
 * marks rarely do. The words around the figure ("SPAR", "1 stk.") are
 * left as they are; only the first figure in the line is set.
 */

/** The first price in a line: kroner, separator, then two øre or a dash. */
const FIGURE = /(\d{1,3}(?:\.\d{3})+|\d+)([,.:])(\d{2}|-{1,2})(?!\d)/;

export interface PricePieces { before: string; major: string; separator: string; minor: string; after: string }

export function pricePieces(text: string): PricePieces | null {
  const match = FIGURE.exec(text);
  if (!match) return null;
  return {
    before: text.slice(0, match.index),
    major: match[1]!,
    separator: match[2]!,
    minor: match[3]!,
    after: text.slice(match.index + match[0].length),
  };
}

/** Whether a style changes anything about how the figure is drawn. */
export function setsPrice(style: PriceStyle | undefined): boolean {
  return Boolean(style && (style.minor === 'raised' || (style.separator !== undefined && style.separator !== ',')));
}

export function PriceMark({ text, style }: { text: string; style: PriceStyle }): ReactNode {
  const pieces = pricePieces(text);
  if (!pieces) return text;
  const dash = /^-+$/.test(pieces.minor);
  // A whole price keeps the ending the design asked for (",-", ".-", ":-"); øre take the chosen separator.
  const separator = dash ? pieces.separator : (style.separator ?? ',');
  const raised = style.minor === 'raised';
  const size = (style.minorSize ?? 50) / 100;
  // Lift in the small figure's own ems: a share of the kroner's cap height (≈ 0.7 em).
  const lift = ((style.minorRaise ?? 35) / 100) * 0.7 / size;
  return (
    <>
      {pieces.before}
      <span className="dprice__major">{pieces.major}</span>
      <span
        className="dprice__minor"
        style={raised ? { fontSize: `${size * 100}%`, position: 'relative', top: `-${lift.toFixed(3)}em`, marginLeft: '0.04em' } : undefined}
      >{separator}{pieces.minor}</span>
      {pieces.after}
    </>
  );
}
