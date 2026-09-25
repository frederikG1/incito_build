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

describe('the price in a label broken over two lines', () => {
  it('reads the price and leaves the name clean', () => {
    const wrapped = { ...PUBLICATION, root_view: JSON.parse(JSON.stringify(PUBLICATION.root_view)) };
    const walk = (node: Record<string, unknown>) => {
      if (node['role'] === 'offer') node['accessibility_label'] = String(node['accessibility_label']).replace(', DKK', '\n, DKK');
      for (const child of (node['child_views'] as Record<string, unknown>[] | undefined) ?? []) walk(child);
    };
    walk(wrapped.root_view as Record<string, unknown>);
    const offers = readIncito(wrapped as never).pages.flatMap((page) => page.offers);
    expect(offers.length).toBeGreaterThan(0);
    for (const entry of offers) {
      expect(entry.price).toBeGreaterThan(0);
      expect(entry.name).not.toMatch(/DKK|\n/);
    }
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

  it('prints the page itself, not the box around it', () => {
    expect(page.view['layout_width']).toBe(600);
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

/*
 * One offer built the way these publications build every offer: three
 * positioned boxes — the photograph, the price on a drawn splash, the
 * words — inside an inner box inset 12pt. Numbers from SuperBrugsen's
 * own week-39 page 1.
 */
const SPLASH = 'https://img.example/?u=s3%3A%2F%2Fa%2Fbusinesses%2Fc1edq%2Fsplash&w=400';

function framedOffer(priceInWords = false) {
  const words = [
    view({ view_name: 'HTMLView', style: 'font-size:18px', child_views: [view({ view_name: 'TextView', text: 'Änglamark bananer' })] }),
    view({ view_name: 'HTMLView', style: 'font-size:12px', child_views: [view({ view_name: 'TextView', text: 'Udenlandske, kl. I. Min. 1,3 kg.' })] }),
    ...(priceInWords ? [
      view({ view_name: 'HTMLView', style: 'font-size:11px', child_views: [view({ view_name: 'TextView', text: '1 pose' })] }),
      view({ view_name: 'HTMLView', style: 'font-size:44px', child_views: [view({ view_name: 'TextView', text: '20,-' })] }),
    ] : []),
  ];
  return view({
    role: 'offer', id: 'f1', view_name: 'HTMLView', accessibility_label: 'Änglamark bananer, DKK 20',
    layout_left: 0, layout_top: 0, layout_width: 300, layout_height: 270,
    child_views: [view({
      view_name: 'HTMLView', layout_left: 12, layout_top: 12, layout_width: 276, layout_height: 246,
      child_views: [
        view({ view_name: 'HTMLView', layout_left: 0, layout_top: 0, layout_width: 276, layout_height: 188,
          child_views: [view({ view_name: 'HTMLView', background_image: PACKSHOT, layout_left: 0, layout_top: 0, layout_width: 276, layout_height: 188 })] }),
        ...(priceInWords ? [] : [view({ view_name: 'HTMLView', layout_left: 170, layout_top: 160, layout_width: 128, layout_height: 106,
          child_views: [view({ view_name: 'HTMLView', background_image: SPLASH, layout_left: 0, layout_top: 0, layout_width: 128, layout_height: 106,
            child_views: [
              view({ view_name: 'HTMLView', style: 'color:rgb(0,0,0);font-size:12px', child_views: [view({ view_name: 'TextView', text: '1 pose' })] }),
              view({ view_name: 'HTMLView', style: 'color:rgb(0,0,0);font-size:48px', child_views: [view({ view_name: 'TextView', text: '20,-' })] }),
            ] })] })]),
        view({ view_name: 'HTMLView', layout_left: 0, layout_top: 0, layout_width: 190, layout_height: 246,
          child_views: [view({ view_name: 'HTMLView', layout_left: 0, layout_top: 0, layout_width: 190, layout_height: 246,
            style: 'display:flex;flex-direction:column;justify-content:flex-end',
            child_views: [view({ view_name: 'HTMLView', child_views: [view({ view_name: 'ImageView', src: MARK })] }), ...words] })] }),
      ],
    })],
  });
}

function onePage(offerView: Record<string, unknown>) {
  return readIncito({
    id: 'framed', locale: 'da-DK',
    root_view: view({ view_name: 'HTMLView', child_views: [view({
      role: 'section', view_name: 'View', layout_width: 600, layout_height: 1000, child_views: [offerView],
    })] }),
  }).pages[0]!;
}

describe('the inside of a published offer', () => {
  it('finds the photograph, the price on its splash and the words, as shares of the offer', () => {
    const frame = onePage(framedOffer()).offers[0]!.frame!;
    expect(frame.media.x).toBeCloseTo(12 / 300);
    expect(frame.media.w).toBeCloseTo(276 / 300);
    expect(frame.price!.x).toBeCloseTo((12 + 170) / 300);
    expect(frame.splash).toBe(SPLASH);
    expect(frame.priceInk).toBe('#000000');
    expect(frame.words!.h).toBeCloseTo(246 / 270);
    expect(frame.wordsAlign).toBe('end');
  });

  it('counts the certification marks as part of the words, not as a photograph', () => {
    expect(onePage(framedOffer()).offers[0]!.frame!.words).not.toBeNull();
  });

  it('reads the type sizes the page set', () => {
    const type = onePage(framedOffer()).offers[0]!.frame!.type!;
    expect(type).toEqual({ name: 18, body: 12, figure: 48, pack: 12 });
  });

  it('gives a price set inside the words its own box at the foot', () => {
    const frame = onePage(framedOffer(true)).offers[0]!.frame!;
    expect(frame.price).not.toBeNull();
    expect(frame.splash).toBeNull();
    expect(frame.price!.y + frame.price!.h).toBeCloseTo(frame.words!.y + frame.words!.h + frame.price!.h);
  });

  it('keeps the measured box and the frame on the template cell', () => {
    const page = onePage(framedOffer());
    const slot = pageTemplate({ ...page, offers: [page.offers[0]!] }, 't')!.template.slots[0]!;
    expect(slot.rect).toEqual({ x: 0, y: 0, w: 0.5, h: 0.27 });
    expect(slot.frame!.splash).toBe(SPLASH);
  });
});

/* A member price: four lines on one roundel, and a separate discount badge. */
function memberOffer() {
  const line = (text: string, style: string, extra: Record<string, unknown> = {}) =>
    view({ view_name: 'HTMLView', style, child_views: [view({ view_name: 'TextView', text, ...extra })] });
  return view({
    role: 'offer', id: 'm1', view_name: 'HTMLView', accessibility_label: "M&M's eller Maltesers, DKK 22",
    layout_left: 0, layout_top: 0, layout_width: 300, layout_height: 300,
    child_views: [view({
      view_name: 'HTMLView', layout_left: 12, layout_top: 12, layout_width: 276, layout_height: 276,
      child_views: [
        view({ view_name: 'HTMLView', layout_left: 0, layout_top: 0, layout_width: 276, layout_height: 218,
          child_views: [view({ view_name: 'HTMLView', background_image: PACKSHOT, layout_left: 0, layout_top: 0, layout_width: 276, layout_height: 218 })] }),
        view({ view_name: 'HTMLView', layout_left: 0, layout_top: 0, layout_width: 147, layout_height: 276,
          child_views: [view({ view_name: 'HTMLView', layout_left: 0, layout_top: 0, layout_width: 147, layout_height: 276, style: 'justify-content:flex-end',
            child_views: [
              line("M&M's eller Maltesers", 'font-size:17px'),
              line('Flere varianter. 93-125 g. Kg-pris maks. 236,56.', 'font-size:10px'),
            ] })] }),
        view({ view_name: 'HTMLView', layout_left: 135, layout_top: 130, layout_width: 141, layout_height: 146,
          child_views: [view({ view_name: 'HTMLView', background_image: SPLASH, layout_left: 0, layout_top: 0, layout_width: 141, layout_height: 146,
            style: 'display:flex;align-items:center;justify-content:center',
            child_views: [
              line('Medlems-\nrabat', 'color:rgb(135,22,35);margin:-2px 88px 0px 0px;font-size:8px'),
              line('1595', 'color:rgb(135,22,35);font-size:20px', { spans: [{ start: 2, end: 15, name: 'superscript' }] }),
              line('22,-', 'color:rgb(255,255,255);font-weight:bold;font-size:48px'),
              line('Pris ikke-medlem 37,95', 'color:rgb(255,255,255);font-weight:bold;font-size:8px'),
            ] })] }),
        view({ view_name: 'HTMLView', layout_left: 150, layout_top: 150, layout_width: 60, layout_height: 56,
          child_views: [view({ view_name: 'HTMLView', layout_left: 0, layout_top: 0, layout_width: 60, layout_height: 56,
            child_views: [line('Medlems-\nrabat', 'font-size:10px'), line('595', 'font-size:20px', { spans: [{ start: 1, end: 15, name: 'superscript' }] })] })] }),
      ],
    })],
  });
}

describe('a member price', () => {
  const offer = onePage(memberOffer()).offers[0]!;

  it('keeps every line of the price mark, with the live figure marked', () => {
    const lines = offer.frame!.priceLines!;
    expect(lines.map((line) => line.role)).toEqual(['note', 'note', 'figure', 'note']);
    expect(lines[1]!.sup).toEqual({ start: 2, end: 4 });
    expect(lines[0]!.margin).toEqual([-2, 88, 0, 0]);
  });

  it('reads the separate discount roundel as a badge', () => {
    expect(offer.frame!.badges.map((badge) => badge.lines.map((line) => line.text))).toEqual([['Medlems-\nrabat', '595']]);
  });

  it('takes the fine print from the words, not from the price mark', () => {
    expect(offer.description).toMatch(/^Flere varianter/);
    expect(offer.pack).toBe('');
  });
});

describe('words on the page outside every offer', () => {
  it('become notes an editor can move, and an offer wrapper does not', () => {
    const page = readIncito({
      id: 'labels', locale: 'da-DK',
      root_view: view({ view_name: 'HTMLView', child_views: [view({
        role: 'section', view_name: 'View', layout_width: 600, layout_height: 1000, child_views: [
          view({ view_name: 'HTMLView', layout_left: 0, layout_top: 0, layout_width: 600, layout_height: 48, style: 'background-color:rgb(195,20,20)' }),
          view({ view_name: 'HTMLView', layout_left: 59, layout_top: 782, layout_width: 64, layout_height: 60, background_image: MARK,
            child_views: [view({ view_name: 'HTMLView', style: 'font-size:12px', child_views: [view({ view_name: 'TextView', text: 'Storkøb\nMin.\n1,3 kg' })] })] }),
          view({ view_name: 'HTMLView', layout_left: 0, layout_top: 300, layout_width: 300, layout_height: 300, child_views: [framedOffer()] }),
        ],
      })] }),
    }).pages[0]!;
    expect(page.labels.map((label) => label.lines.map((line) => line.text).join('|'))).toEqual(['', 'Storkøb\nMin.\n1,3 kg']);
    expect(page.labels[0]!.fill).toBe('#c31414');
    expect(page.offers).toHaveLength(1);
  });
});

describe('a page in a section smaller than itself', () => {
  // The viewer scales the 600-wide page into a 375-wide section; the scale is not in the file.
  const small = {
    id: 'small', locale: 'da-DK',
    root_view: view({
      view_name: 'HTMLView', role: 'paged-proximity',
      child_views: [view({
        role: 'section', id: 's1', view_name: 'View', layout_width: 375, layout_height: 625,
        child_views: [view({
          view_name: 'HTMLView', layout_width: 600, layout_height: 1000,
          child_views: [offer('1', 'Coop kylling', 49, [0, 0, 300, 1000]), offer('2', 'Irma focaccia', 29, [300, 0, 300, 1000])],
        })],
      })],
    }),
  };

  it('prints the 600-wide page, so fitting it to the frame is ours to do', () => {
    const page = readIncito(small).pages[0]!;
    expect(page.view['layout_width']).toBe(600);
    expect(page.view['layout_height']).toBe(1000);
  });
});
