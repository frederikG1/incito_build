import { describe, expect, it } from 'vitest';
import { viaCache, viaCacheIn } from '../image-route.js';

const URL = 'https://imageservice2.republica.dk/motive/791-8748?size=560&format=png&trim=1&key=abc';
const ROUTED = `/api/images?u=${encodeURIComponent(URL)}`;

describe('image route', () => {
  it('sends the image service through the cache and nothing else', () => {
    expect(viaCache(URL)).toBe(ROUTED);
    expect(viaCache('https://example.com/a.png')).toBe('https://example.com/a.png');
    expect(viaCache('/images/a.png')).toBe('/images/a.png');
  });

  it('finds the addresses inside CSS and HTML', () => {
    expect(viaCacheIn(`url("${URL}"), url(${URL})`)).toBe(`url("${ROUTED}"), url(${ROUTED})`);
    const html = `<img src="${URL.replace(/&/g, '&amp;')}" style="background-image: url(&quot;${URL.replace(/&/g, '&amp;')}&quot;)">`;
    const amp = ROUTED.replace(/&/g, '&amp;');
    expect(viaCacheIn(html)).toBe(`<img src="${amp}" style="background-image: url(&quot;${amp}&quot;)">`);
  });
});
