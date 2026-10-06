import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { PriceMark, pricePieces } from '../price-mark.js';

describe('price marks', () => {
  it('splits kroner from øre and from the dash', () => {
    expect(pricePieces('19,95')).toEqual({ before: '', major: '19', separator: ',', minor: '95', after: '' });
    expect(pricePieces('SPAR 1.299,-')).toMatchObject({ before: 'SPAR ', major: '1.299', minor: '-' });
    expect(pricePieces('1 stk.')).toBeNull();
  });

  it('raises the øre, drops the separator when asked, keeps a whole price’s ending', () => {
    const cents = renderToStaticMarkup(createElement(PriceMark, { text: '19,95', style: { minor: 'raised', separator: '' } }));
    expect(cents).toContain('<span class="dprice__major">19</span>');
    expect(cents).toMatch(/dprice__minor" style="font-size:50%[^"]*">95</);
    const whole = renderToStaticMarkup(createElement(PriceMark, { text: '45,-', style: { minor: 'raised', separator: '' } }));
    expect(whole).toMatch(/>,-</);
  });
});
