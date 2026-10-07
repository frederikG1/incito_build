import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { Offer, readIncitoDesigns } from '@incitio/schema';
import { DesignTile, renderLiquid } from '../index.js';
import { incitoVars } from '../liquid.js';
import { packColumns } from '../DesignTile.js';

const { designs } = readIncitoDesigns(readFileSync(new URL('../../../../data/designs/superbrugsen-cms.json', import.meta.url), 'utf8'));
const offer = (over: Partial<Offer> = {}) => Offer.parse({
  id: 'x', name: 'Coop kylling', price: 49, validFrom: '2026-09-21', validTo: '2026-09-27',
  quantity: { size: null, unit: 'pcs' }, imageUrl: 'https://img/x.png', pack: '1 stk.', ...over,
});

describe('incito Liquid', () => {
  it('prints prices the way the CMS does, from fields or from assigned words', () => {
    expect(renderLiquid('{% format_price path:"offerPrice", thousand:".", postfix:",-" %}', { offerPrice: 19 })).toBe('19,-');
    expect(renderLiquid('{% format_price path:"offerPrice", thousand:".", postfix:",-" %}', { offerPrice: 1299.95 })).toBe('1.299,95');
    expect(renderLiquid('{% assign a = l | remove: "Spar " %}{% assign p = a | replace: ",", "." %}{% format_price path:"p" postfix:",-" %}', { l: 'Spar 29,95' })).toBe('29,95');
  });
});

describe('savings over 100 kr.', () => {
  it('are said without øre, rounded down — from the field and from the chain\'s own label', () => {
    const big = incitoVars(offer({ price: 249, prePrice: 809.7 }));
    expect(big['offerSavings']).toBe(560);
    expect(renderLiquid('{% format_price path:"offerSavings" thousand:".", postfix:",-" %}', big)).toBe('560,-');
    expect(incitoVars(offer({ price: 10, prePrice: 39.95 }))['offerSavings']).toBe(29.95);
    const labelled = incitoVars(offer({ labels: [{ kind: 'saving', text: 'Spar 29,95 - 149,95' }] }));
    expect(labelled['offerCommentLabel3']).toBe('Spar 29,95 - 149');
  });
});

describe('DesignTile', () => {
  it('draws every one of SuperBrugsen\'s 36 designs without throwing', () => {
    for (const design of designs) {
      expect(() => renderToStaticMarkup(createElement(DesignTile, { design, offer: offer(), aspect: 1 }))).not.toThrow();
    }
  });

  it('places the boxes where the design says, and the price in its box', () => {
    const design = designs.find((d) => d.tag === 'Rød, sort, hvid' && d.offer_priority === 'a')!;
    const html = renderToStaticMarkup(createElement(DesignTile, { design, offer: offer(), aspect: 1 }));
    expect(html).toContain('49,-');
    expect(html).toContain('Coop kylling');
    const image = design.layers.find((l) => l.type === 'offer_image')!;
    expect(html).toContain(`top:${image.y1 * 100}%`);
  });

  it('varies how several products stand instead of always queuing them', () => {
    const design = designs.find((d) => d.tag === 'Rød, sort, hvid' && d.offer_priority === 'a')!;
    const shapes = new Set<string>();
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
      const html = renderToStaticMarkup(createElement(DesignTile, {
        design, aspect: 1, offer: offer({ id, imagePack: ['https://img/1.png', 'https://img/2.png', 'https://img/3.png'] }),
      }));
      shapes.add(/dtile__pack--(\w+)/.exec(html)![1]!);
    }
    expect(shapes.size).toBeGreaterThan(1);
    const six = renderToStaticMarkup(createElement(DesignTile, {
      design, aspect: 1, offer: offer({ imagePack: [1, 2, 3, 4, 5, 6].map((n) => `https://img/${n}.png`) }),
    }));
    expect(six).toContain('dtile__pack--grid');
  });

  it('gives a block the columns that leave each product the most room', () => {
    expect(packColumns(6, 2.5)).toBe(3);
    expect(packColumns(6, 0.6)).toBe(2);
    expect(packColumns(5, 1)).toBe(3);
    expect(packColumns(4, 1)).toBe(2);
    expect(packColumns(6, 8)).toBe(6);
  });

  it('draws no picture in a design without an image box', () => {
    const design = designs.find((d) => d.tag === 'Rød, sort, hvid - Uden billede')!;
    expect(renderToStaticMarkup(createElement(DesignTile, { design, offer: offer(), aspect: 1 }))).not.toContain('img/x.png');
  });
});
