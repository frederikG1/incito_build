import { describe, expect, it } from 'vitest';
import { Offer, type PageTemplate } from '@incitio/schema';
import { boundIncito, cellStates, incitoHtml, incitoSlotOf, pageBlocks } from '@incitio/renderer';
import {
  catalogIds, cropOf, extractPaged, findPageCells, imageSize, pagedMark, pagedPage, publicationDocument,
  type PagedCell,
} from '../index.js';

// The viewer's page for a publication handed in as a PDF — Netto uge 25.
const VIEWER = `<!DOCTYPE html><html><head><title>Netto</title></head><body>
<div id="paged-root"><div><img id="page-2" src="https://img/?u=p-2.webp&amp;w=700&amp;s=b" alt="Page 2" width="700" height="987" /></div>
<div><img id="page-1" src="https://img/?u=p-1.webp&amp;w=700&amp;s=a" alt="Page 1" width="700" height="1041" /></div></div></body></html>`;

const THEME = { fontFamily: 'x', color: '#000', background: '#fff', lineHeight: 1 };

const build = (cells: PagedCell[]) => {
  const page = pagedPage(2, '/uploads/netto/p2.jpg', { width: 700, height: 987 }, cells, '#fedb62');
  const run = publicationDocument(
    { id: 'n', locale: 'da_DK', pages: [page], fonts: {}, theme: THEME },
    { brandId: 'netto', catalogId: 'n', name: 'Netto' },
  );
  const doc = run.document;
  const out = doc.pages[0]!;
  return { page: out, offers: doc.offers, template: doc.templates.find((t) => t.id === out.templateId) as PageTemplate };
};

const laks: PagedCell = {
  box: { x0: 20, y0: 250, x1: 330, y1: 520 },
  paper: '#FEDB62',
  product: { id: 'laks', name: 'Velsmag laksestykke', description: '300 g.', pack: '', price: 54.95, imageUrl: '/crop/laks.jpg' },
};
const found: PagedCell = { box: { x0: 370, y0: 250, x1: 690, y1: 520 }, paper: '#ffda61' };

describe('a publication published as pictures', () => {
  it('reads its pages, in order, with the signed links unescaped', () => {
    const paged = extractPaged(VIEWER)!;
    expect(paged.title).toBe('Netto');
    expect(paged.pages.map((page) => page.number)).toEqual([1, 2]);
    expect(paged.pages[0]!.src).toBe('https://img/?u=p-1.webp&w=700&s=a');
  });

  it('is not mistaken for one when the page holds incito', () => {
    expect(extractPaged('<script id="incito-data">{}</script>')).toBeNull();
  });

  it('knows a picture\'s own size from its header', () => {
    const png = Buffer.alloc(24);
    png.set([0x89, 0x50, 0x4e, 0x47]);
    png.writeUInt32BE(700, 16);
    png.writeUInt32BE(987, 20);
    expect(imageSize(png)).toEqual({ width: 700, height: 987 });
  });

  it('reads a live catalogue\'s id and an offer\'s box off Tjek\'s links', () => {
    expect(catalogIds('https://etilbudsavis.dk/netto/tilbudsavis/M3A02XpX')).toEqual(['M3A02XpX']);
    expect(cropOf('https://i/?u=p-2.webp&w=600&x1r=0.02&x2r=0.47&y1r=0.66&y2r=0.96&s=x'))
      .toEqual({ x0: 0.02, y0: 0.66, x1: 0.47, y1: 0.96 });
    expect(cropOf('https://i/?u=p-2.webp&w=600')).toBeNull();
  });

  it('becomes a picture page when nothing on it is a cell', () => {
    const page = pagedPage(1, '/uploads/netto/p1.jpg', { width: 700, height: 1040 });
    expect(pagedMark(page.view)).toMatchObject({ image: '/uploads/netto/p1.jpg', width: 700, height: 1040 });
    const { document } = publicationDocument(
      { id: 'n', locale: 'da_DK', pages: [page], fonts: {}, theme: THEME },
      { brandId: 'netto', catalogId: 'n', name: 'Netto' },
    );
    expect(document.pages[0]).toMatchObject({ kind: 'image', exact: true });
  });
});

describe('cells on a page picture', () => {
  it('are the layout: a known product is placed, a found cell is only a place', () => {
    const { page, offers, template } = build([laks, found]);
    expect(page.kind).toBe('offers');
    expect(template.slots).toHaveLength(2);
    expect(template.slots.map((slot) => slot.paper)).toEqual(['#fedb62', '#ffda61']);
    expect(offers.map((offer) => offer.id)).toEqual(['laks']);
    expect(page.placements.map((placement) => placement.offerId)).toEqual(['laks']);
  });

  it('print their own crop of the picture, as things to point at', () => {
    const { page, offers, template } = build([laks, found]);
    const map = new Map(offers.map((offer) => [offer.id, offer]));
    const html = incitoHtml(boundIncito(page as never, map, template));
    expect(html).toContain('background-size:600px 846px');
    expect(html).toContain('data-offer-view="cell-a"');
    const blocks = pageBlocks(page as never, offers, template).map((block) => block.path);
    expect(blocks).toEqual(['c-a.1', 'c-b.1']);
    expect(incitoSlotOf(page, 'cell-b')).toBe('b');
  });

  it('give way to a new product: the paper, and the chain\'s tile over it', () => {
    const { page, offers, template } = build([laks, found]);
    const skyr = Offer.parse({ ...offers[0]!, id: 'skyr', name: 'Skyr vanilje', price: 16 });
    const placed = { ...page, placements: [...page.placements, { ...page.placements[0]!, slotId: 'b', offerId: 'skyr' }] };
    const map = new Map([...offers, skyr].map((offer) => [offer.id, offer]));
    const states = cellStates(placed as never, template, map);
    expect([...states]).toEqual([['a', 'printed'], ['b', 'new']]);
    const html = incitoHtml(boundIncito(placed as never, map, template));
    expect(html).toContain('background-color:#ffda61');
  });

  it('show the paper where the publication\'s own product was taken off', () => {
    const { page, offers, template } = build([laks]);
    const map = new Map(offers.map((offer) => [offer.id, offer]));
    expect([...cellStates({ ...page, placements: [] } as never, template, map)]).toEqual([['a', 'gone']]);
    const repriced = new Map([['laks', { ...offers[0]!, price: 44.95 }]]);
    expect(cellStates(page as never, template, repriced).get('a')).toBe('new');
  });
});

describe('finding cells in the pixels', () => {
  // A yellow sheet with two dark products side by side and one under them.
  const sheet = () => {
    const width = 400;
    const height = 560;
    const data = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const at = (y * width + x) * 4;
        const product = (x > 20 && x < 185 && y > 20 && y < 250) || (x > 215 && x < 380 && y > 20 && y < 250)
          || (x > 20 && x < 380 && y > 290 && y < 540);
        data.set(product ? [30, 30, 30, 255] : [255, 219, 98, 255], at);
      }
    }
    return { width, height, data };
  };

  it('finds the offers between the gutters, and the paper around them', () => {
    const { cells, paper } = findPageCells(sheet());
    expect(paper).toBe('#ffdb62');
    expect(cells).toHaveLength(3);
    expect(cells[0]!.box.x1).toBeLessThan(200);
    expect(cells[1]!.box.x0).toBeGreaterThan(200);
    expect(cells[2]!.box.y0).toBeGreaterThan(270);
    expect(cells.every((cell) => cell.paper === '#ffdb62')).toBe(true);
  });
});
