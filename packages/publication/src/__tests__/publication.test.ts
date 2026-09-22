import { describe, expect, it } from 'vitest';
import { validateTemplate } from '@incitio/schema';
import { extractIncito, PublicationError } from '../fetch.js';
import { readIncito } from '../incito.js';
import { pageTemplate, publicationDocument, publicationOffer } from '../document.js';

/**
 * A page of the shape these publications actually have: a sheet-sized
 * ground with a colour, a sheet-sized texture, a masthead strip, and
 * offers on a two-by-two lattice with the top-left one twice as tall.
 *
 * Written out rather than checked in as a fixture file because every
 * number in it is load-bearing for one of the assertions below, and a
 * megabyte of somebody else's JSON hides which.
 */
function view(fields: Record<string, unknown>) {
  return fields;
}

const PACKSHOT = 'https://img.example/?u=s3%3A%2F%2Fa%2Fbusiness_images%2Fx&w=1200';
const MARK = 'https://img.example/?u=s3%3A%2F%2Fa%2Fbusinesses%2Fc1edq%2Fmark&w=200';

function offer(id: string, name: string, price: number, box: number[], fine = '') {
  const [left, top, width, height] = box as [number, number, number, number];
  return view({
    role: 'offer',
    id,
    view_name: 'HTMLView',
    accessibility_label: `${name}, DKK ${price}`,
    layout_left: left,
    layout_top: top,
    layout_width: width,
    layout_height: height,
    child_views: [
      view({ view_name: 'HTMLView', background_image: PACKSHOT }),
      view({ view_name: 'HTMLView', background_image: MARK }),
      view({ view_name: 'TextView', text: name }),
      view({ view_name: 'TextView', text: '1 stk.' }),
      view({ view_name: 'TextView', text: `${price},-` }),
      view({ view_name: 'TextView', text: fine }),
    ],
  });
}

const PUBLICATION = {
  id: 'abc123',
  locale: 'da-DK',
  root_view: view({
    view_name: 'HTMLView',
    role: 'paged-proximity',
    child_views: [
      view({
        role: 'section',
        id: 's1',
        view_name: 'View',
        layout_width: 600,
        layout_height: 1000,
        child_views: [
          view({
            view_name: 'HTMLView',
            layout_width: 600,
            layout_height: 1000,
            child_views: [
              view({
                view_name: 'HTMLView',
                layout_top: 0,
                layout_left: 0,
                layout_width: 600,
                layout_height: 1000,
                style: 'position:absolute;background-color:rgb(255,225,109)',
              }),
              view({
                view_name: 'HTMLView',
                layout_top: 0,
                layout_left: 0,
                layout_width: 600,
                layout_height: 1000,
                style: 'position:absolute;opacity:0.4',
                background_image: 'https://img.example/texture.png',
              }),
              view({
                view_name: 'HTMLView',
                layout_top: 30,
                layout_left: 0,
                layout_width: 600,
                layout_height: 100,
                background_image: 'https://img.example/masthead.png',
              }),
              view({
                view_name: 'HTMLView',
                layout_top: 140,
                layout_left: 0,
                layout_width: 600,
                layout_height: 860,
                child_views: [
                  offer('1', 'Coop kylling', 49, [0, 0, 300, 860],
                    'Dybfrost. 240-250 g. Kg-pris maks. 61,25. Frit valg.'),
                  offer('2', 'Irma focaccia', 29, [300, 0, 300, 430], '250 g.'),
                  offer('3', 'Mou suppe', 32, [300, 430, 300, 430], '50 cl.'),
                ],
              }),
            ],
          }),
        ],
      }),
    ],
  }),
};

describe('reading a publication', () => {
  const publication = readIncito(PUBLICATION);
  const page = publication.pages[0]!;

  it('finds one page per section', () => {
    expect(publication.pages).toHaveLength(1);
    expect(page.number).toBe(1);
    expect(page.width).toBe(600);
  });

  it('measures the ground instead of asking for it', () => {
    expect(page.ground).toBe('#ffe16d');
  });

  it('keeps the sheet-sized picture and its opacity apart from the masthead', () => {
    expect(page.background).toEqual({
      imageUrl: 'https://img.example/texture.png',
      opacity: 0.4,
    });
    expect(page.masthead?.imageUrl).toBe('https://img.example/masthead.png');
  });

  it('places every offer in the page\'s own coordinates', () => {
    expect(page.offers).toHaveLength(3);
    // 140 from the band the offers sit in, 430 from the offer above it.
    expect(page.offers[2]!.rect).toEqual({ x: 300, y: 570, w: 300, h: 430 });
  });

  /*
   * The distinction this test is really about: the price splash, the
   * masthead and the certification marks are all images inside a tile,
   * and only one of them is a photograph of the product. Told apart by
   * the bucket the URL names — see `isPackshot`.
   */
  it('takes the packshot and leaves the chain\'s own artwork', () => {
    expect(page.offers[0]!.imageUrl).toBe(PACKSHOT);
    expect(page.offers[0]!.marks).toEqual([MARK]);
  });

  it('reads the price off the label, where it is a number', () => {
    expect(page.offers[0]!.price).toBe(49);
    expect(page.offers[0]!.currency).toBe('DKK');
    expect(page.offers[0]!.name).toBe('Coop kylling');
    expect(page.offers[0]!.pack).toBe('1 stk.');
  });
});

describe('a publication page as a template', () => {
  const page = readIncito(PUBLICATION).pages[0]!;
  const read = pageTemplate(page, 'pub/abc123/p1')!;

  it('reads the lattice the offers sit on', () => {
    expect(read).not.toBeNull();
    expect(read.template.areas[0]!.split(' ')).toHaveLength(2);
  });

  it('gives the tall offer both of its rows', () => {
    const rows = read.template.areas.map((row) => row.split(' '));
    expect(rows.every((row) => row[0] === 'a')).toBe(true);
    expect(rows[0]![1]).toBe('b');
    expect(rows[rows.length - 1]![1]).toBe('c');
  });

  it('is a template the renderer will accept', () => {
    expect(validateTemplate(read.template)).toEqual([]);
  });

  /*
   * Fitted in shares of the sheet, never in the publication's points.
   * Handed raw coordinates the same lattice answers "no grid" for a page
   * that is plainly two-by-two — its tolerance is a share, and on a
   * 1000pt sheet a share is a fraction of a point.
   */
  it('reports a fit tight enough to be a reading rather than a fitting', () => {
    expect(read.fit).toBeLessThan(0.01);
  });
});

describe('a publication as a document', () => {
  const publication = readIncito(PUBLICATION);
  const { document, readings } = publicationDocument(publication, {
    brandId: 'superbrugsen',
    catalogId: 'test',
    name: 'Prøve',
  });

  it('carries its layouts with it rather than adding them to the chain', () => {
    expect(document.templates).toHaveLength(1);
    expect(document.pages[0]!.templateId).toBe(document.templates[0]!.id);
  });

  it('puts the publication\'s own products on the page', () => {
    expect(document.offers).toHaveLength(3);
    expect(document.pages[0]!.placements).toHaveLength(3);
  });

  it('keeps the products but not the placements when asked for the grid alone', () => {
    const empty = publicationDocument(publication, {
      brandId: 'superbrugsen', catalogId: 'test', name: 'Prøve', withOffers: false,
    });
    expect(empty.document.pages[0]!.placements).toEqual([]);
    // The bench, not the bin: the editor deals these back out.
    expect(empty.document.offers).toHaveLength(3);
  });

  it('says how each page was read', () => {
    expect(readings[0]).toMatchObject({ number: 1, offers: 3, columns: 2, skipped: null });
  });

  it('prints the sheet colour the publication states', () => {
    expect(document.pages[0]!.ground).toBe('#ffe16d');
  });
});

describe('offers out of a publication', () => {
  const page = readIncito(PUBLICATION).pages[0]!;

  it('keeps the unit price the page already prints rather than deriving one', () => {
    expect(publicationOffer(page.offers[0]!, page).comparison)
      .toEqual({ value: 61.25, unit: 'kg' });
  });

  it('reads the size out of the fine print, in one scale', () => {
    // 50 cl is stored as 500 ml, the same way `@incitio/ingest` stores it.
    expect(publicationOffer(page.offers[2]!, page).quantity)
      .toEqual({ size: 500, unit: 'ml', pieceCount: 1 });
  });

  it('groups by the page, which is the only editorial fact in the file', () => {
    expect(publicationOffer(page.offers[0]!, page).category).toBe('Side 1');
  });
});

describe('getting the document out of a viewer page', () => {
  it('decodes the script tag, which is URL-encoded rather than plain JSON', () => {
    const encoded = encodeURIComponent(JSON.stringify({ id: 'x' }));
    const html = `<html><script id="incito-data" type="application/json">${encoded}</script>`;
    expect(extractIncito(html)).toEqual({ id: 'x' });
  });

  it('accepts a tag that is already plain JSON', () => {
    const html = '<script id="incito-data" type="application/json">{"id":"x"}</script>';
    expect(extractIncito(html)).toEqual({ id: 'x' });
  });

  it('says what is wrong with a page that is not a publication', () => {
    expect(() => extractIncito('<html>hej</html>')).toThrow(PublicationError);
  });
});

/**
 * What the import keeps of the printed page, beyond the offers.
 *
 * Both of these were READ and then thrown away: the section headline,
 * which these publications set as a drawing rather than as type, and
 * the marks printed inside a tile. A page that drops them cannot look
 * like the one it was imported from.
 */
describe('a page imported with its own furniture', () => {
  const imported = publicationDocument(readIncito(PUBLICATION), {
    brandId: 'superbrugsen',
    catalogId: 'c1',
    name: 'Uge 38',
  });

  it('puts the printed section headline on the page', () => {
    const decor = imported.document.pages[0]!.decorations[0]!;
    expect(decor.imageUrl).toBe('https://img.example/masthead.png');
    expect(decor.rect).toEqual({ x: 0, y: 0.03, w: 1, h: 0.1 });
  });

  /*
   * The marks are READ and deliberately not used. They share a bucket
   * with the price splash — see `isPackshot` — so putting them on the
   * tile printed a red blob where a certification mark goes.
   */
  it('does not turn the tile artwork into certification marks', () => {
    expect(imported.document.offers[0]!.labels).toEqual([]);
  });
});

/*
 * A publication that wraps its page in a section twice the size.
 *
 * Measured on a Coop leaflet: `section 1200x2000` holding one
 * `view 600x1000` that is the whole page. Read against the section,
 * every coordinate came back at half scale — so the offers all sat in
 * the top-left quarter, the grid fitter padded the other three
 * quarters with empty tracks, and the ground and the background were
 * never found at all, because the test for "this view is the sheet"
 * was asking for 98 % of a box twice the size of anything in it.
 */
describe('a page wrapped in an oversized section', () => {
  const wrapped = {
    id: 'wrapped',
    locale: 'da-DK',
    root_view: view({
      view_name: 'HTMLView',
      role: 'paged-proximity',
      child_views: [
        view({
          role: 'section',
          id: 's1',
          view_name: 'View',
          layout_width: 1200,
          layout_height: 2000,
          child_views: [
            view({
              view_name: 'HTMLView',
              layout_top: 0,
              layout_left: 0,
              layout_width: 600,
              layout_height: 1000,
              style: 'position:absolute;background-color:rgb(213,228,237)',
              child_views: [
                view({
                  view_name: 'HTMLView',
                  layout_top: 0,
                  layout_left: 0,
                  layout_width: 600,
                  layout_height: 1000,
                  child_views: [
                    offer('1', 'Coop kylling', 49, [0, 0, 300, 1000], '240 g.'),
                    offer('2', 'Irma focaccia', 29, [300, 0, 300, 1000], '250 g.'),
                  ],
                }),
              ],
            }),
          ],
        }),
      ],
    }),
  };

  const page = readIncito(wrapped).pages[0]!;

  it('measures against the page, not the box around it', () => {
    expect(page.width).toBe(600);
    expect(page.height).toBe(1000);
  });

  it('gives the offers the whole sheet instead of a quarter of it', () => {
    const right = Math.max(...page.offers.map((o) => (o.rect.x + o.rect.w) / page.width));
    const bottom = Math.max(...page.offers.map((o) => (o.rect.y + o.rect.h) / page.height));
    expect(right).toBeCloseTo(1, 6);
    expect(bottom).toBeCloseTo(1, 6);
  });

  it('finds the ground the wrapper was hiding', () => {
    expect(page.ground).toBe('#d5e4ed');
  });
});

describe('a page that is not wrapped at all', () => {
  it('is left exactly where it was', () => {
    // The ordinary shape: section and page the same size. Stepping
    // into anything here would be stepping into the page's content.
    const page = readIncito(PUBLICATION).pages[0]!;
    expect(page.width).toBe(600);
    expect(page.height).toBe(1000);
    expect(page.offers).toHaveLength(3);
  });
});
