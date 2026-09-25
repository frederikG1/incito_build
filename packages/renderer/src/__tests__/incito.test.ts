import { describe, expect, it } from 'vitest';
import { Offer, type IncitoSource } from '@incitio/schema';
import { incitoBlocks, incitoCellBoxes, incitoCells, incitoHtml, incitoPacks, incitoSheet } from '../incito.js';

// The shape of SuperBrugsen uge 38, side 1: a member-price mark scaled 1.36,
// its figure "10995" with the øre raised.
const source = (figure = '10995', label = '109.95'): IncitoSource => ({
  width: 600,
  height: 1000,
  fonts: {},
  slots: {},
  theme: { fontFamily: 'incito-body', color: '#000', background: '#fff', lineHeight: 1.4 },
  view: {
    view_name: 'HTMLView', layout_width: 600, layout_height: 1000, layout_left: 12,
    child_views: [{
      view_name: 'HTMLView', role: 'offer', id: '1093377',
      accessibility_label: `Libero Touch bleer\n, DKK ${label}`, style: 'position: absolute',
      layout_width: 600, layout_height: 433.15, layout_top: 0, layout_left: 0,
      child_views: [
        { view_name: 'TextView', text: 'Libero Touch bleer', max_lines: 4 },
        {
          view_name: 'HTMLView', style: 'position: absolute', layout_top: 267, layout_left: 399,
          layout_width: 129, layout_height: 103, transform_scale: 1.3566666666666667, clip_children: false,
          background_image: 'https://img/splash.png', background_image_position: 'center_center',
          background_image_scale_type: 'center_inside',
          child_views: [{ view_name: 'TextView', text: figure, max_lines: 1, spans: /^\d+$/.test(figure) ? [{ start: 3, end: 16, name: 'superscript' }] : [] }],
        },
      ],
    }],
  },
});

describe('a publication page drawn from its own tree', () => {
  const html = incitoHtml(source());

  it('writes the styles the viewer writes', () => {
    expect(html).toContain('position: absolute;width:129px;height:103px;top:267px;left:399px;overflow:visible;transform:scale(1.3566666666666667)');
    expect(html).toContain('background-position:center center;background-size:contain;background-image:url(&quot;https://img/splash.png&quot;)');
  });

  it('stands the sheet at its own origin', () => {
    expect(html.startsWith('<div class="tjek-incito__view" style="position:relative;width:600px;height:1000px;"')).toBe(true);
  });

  it('raises the øre and clamps the lines, as the viewer does', () => {
    expect(html).toContain('109<span style="font-family:inherit;color:inherit;" data-name="superscript">95</span>');
    expect(html).toContain('display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical');
  });

  const offer = (name: string, price: number) => Offer.parse({
    id: '1093377', name, price, quantity: { size: null, unit: 'pcs' }, validFrom: '2026-09-17', validTo: '2026-09-24',
  });

  it('prints today\'s price in the old typography', () => {
    const now = incitoHtml(source(), new Map([['1093377', offer('Libero Touch bleer', 99.5)]]));
    expect(now).toContain('99<span style="font-family:inherit;color:inherit;" data-name="superscript">50</span>');
    const whole = incitoHtml(source('79,-', '79'), new Map([['1093377', offer('Libero Touch bleer', 69)]]));
    expect(whole).toContain('>69,-<');
  });

  it('prints a corrected name, and leaves a price it does not recognise alone', () => {
    const renamed = incitoHtml(source('Pris ikke-medlemmer 109.95'), new Map([['1093377', offer('Libero bleer', 89)]]));
    expect(renamed).toContain('>Libero bleer<');
    expect(renamed).toContain('>Pris ikke-medlemmer 109.95<');
  });
});

describe('a sheet the publication scaled to fill its section', () => {
  it('is drawn at its own size — the fitting is ours', () => {
    const wrapped = source();
    wrapped.view = { ...wrapped.view, transform_scale: 2, transform_origin: ['0%', '0%'], layout_margin_left: 'auto' };
    const html = incitoHtml(wrapped);
    const sheet = html.slice(0, html.indexOf('>'));
    expect(sheet).not.toContain('scale(');
    expect(sheet).not.toContain('margin');
    expect(sheet).toContain('width:600px;height:1000px');
  });
});

describe('a page stored with the viewer\'s section around it', () => {
  it('prints the page inside at its own size', () => {
    const inner = source().view;
    const stored: IncitoSource = { ...source(), width: 375, height: 625, view: { view_name: 'View', layout_width: 375, layout_height: 625, child_views: [inner] } };
    const sheet = incitoSheet(stored);
    expect([sheet.width, sheet.height]).toEqual([600, 1000]);
    expect(incitoHtml(stored).startsWith('<div class="tjek-incito__view" style="position:relative;width:600px;height:1000px;"')).toBe(true);
  });
});

describe('the elements of a published page', () => {
  it('lists the price mark as one element, not its offer or its inner boxes', () => {
    const blocks = incitoBlocks(source());
    expect(blocks.map((b) => [b.kind, b.texts])).toEqual([['skilt', ['10995']]]);
    expect(blocks[0]!.offerId).toBe('1093377');
  });

  it('hides an element, and rewords its lines, without touching the tree', () => {
    const page = source();
    const [mark] = incitoBlocks(page);
    const hidden = incitoHtml(page, new Map(), { [mark!.path]: { hidden: true } });
    expect(hidden).toMatch(new RegExp(`data-incito-block="${mark!.path.replace(/\./g, '\\.')}" style="[^"]*display:none`));
    const reworded = incitoHtml(page, new Map(), { [mark!.path]: { hidden: false, texts: ['Kun 99,-'] } });
    expect(reworded).toContain('>Kun 99,-<');
    expect(JSON.stringify(page.view)).toContain('"text":"10995"');
  });
});

describe('a roundel drawn as a disc with words laid over it', () => {
  // As on SuperBrugsen's coffee page: the white disc and "Medlemsrabat op til 25,95" are two boxes.
  const page: IncitoSource = {
    ...source(),
    view: {
      view_name: 'HTMLView', layout_width: 600, layout_height: 1000,
      child_views: [
        { view_name: 'HTMLView', style: 'position:absolute', layout_top: 500, layout_left: 200, layout_width: 110, layout_height: 110, background_image: 'https://img/disc.png' },
        {
          view_name: 'HTMLView', style: 'position:absolute', layout_top: 515, layout_left: 210, layout_width: 90, layout_height: 80,
          child_views: [{ view_name: 'TextView', text: 'Medlems-rabat op til' }, { view_name: 'TextView', text: '2595' }],
        },
        {
          view_name: 'HTMLView', style: 'position:absolute', layout_top: 100, layout_left: 0, layout_width: 500, layout_height: 300,
          background_image: 'https://img/packshot.png',
          child_views: [{
            view_name: 'HTMLView', style: 'position:absolute', layout_top: 10, layout_left: 380, layout_width: 90, layout_height: 90,
            child_views: [{ view_name: 'TextView', text: 'Storkøb Min. 1,3 kg' }],
          }],
        },
      ],
    },
  };
  const blocks = incitoBlocks(page);

  it('takes the disc along when the words go', () => {
    const words = blocks.find((b) => b.texts[0] === 'Medlems-rabat op til')!;
    expect(words.companions).toEqual(['0']);
  });

  it('lets a roundel set inside the packshot be taken on its own', () => {
    const nested = blocks.find((b) => b.texts[0] === 'Storkøb Min. 1,3 kg')!;
    expect(nested.path).toBe('2.0');
    const packshot = blocks.find((b) => b.path === '2')!;
    expect(packshot.texts).toEqual([]);
    expect(packshot.companions).toEqual([]);
    const html = incitoHtml(page, new Map(), { '2.0': { hidden: false, texts: ['Storkøb'] } });
    expect(html).toContain('data-incito-block="2.0"');
    expect(html).toContain('>Storkøb<');
  });
});

describe('an element moved by hand', () => {
  it('is moved from where it was published, lifted, and let out of its offer', () => {
    const page = source();
    const [mark] = incitoBlocks(page);
    const html = incitoHtml(page, new Map(), { [mark!.path]: { dx: -40, dy: 120, scale: 1.2 } });
    expect(html).toContain('transform:translate(-40px, 120px) scale(1.2) scale(1.3566666666666667)');
    expect(html).toContain('z-index:50');
    // The offer around it no longer clips it.
    expect(html).toMatch(/data-offer-view="1093377" style="[^"]*overflow:visible/);
  });
});

describe('a new product in a published cell', () => {
  const printed = Offer.parse({
    id: '1093377', name: 'Libero Touch bleer', description: 'Flere varianter. 22-40 stk.', price: 109.95,
    imageUrl: 'https://img/libero.png', quantity: { size: null, unit: 'pcs' }, validFrom: '2026-09-17', validTo: '2026-09-24',
  });
  const fresh = Offer.parse({
    id: 'new-1', name: 'Pampers Baby-Dry', description: 'Str. 3-6.', price: 89,
    imageUrl: 'https://img/pampers.png', quantity: { size: null, unit: 'pcs' }, validFrom: '2026-09-17', validTo: '2026-09-24',
  });
  const page = () => {
    const incito = source();
    const offerView = (incito.view.child_views as Record<string, unknown>[])[0]!;
    (offerView['child_views'] as Record<string, unknown>[]).push(
      { view_name: 'TextView', text: 'Flere varianter. 22-40 stk.' },
      { view_name: 'HTMLView', layout_top: 0, layout_left: 0, layout_width: 574, layout_height: 286, background_image: 'https://img/libero.png' },
    );
    return { incito: { ...incito, slots: { a: '1093377' } }, placements: [{ offerId: 'new-1', slotId: 'a' }] };
  };
  const offers = new Map([[printed.id, printed], [fresh.id, fresh]]);

  it('is set in the old one\'s layout: its name, words, price and packshot', () => {
    const p = page();
    const cells = incitoCells(p, offers)!;
    const html = incitoHtml(p.incito, cells.now, {}, cells.printed);
    expect(html).toContain('>Pampers Baby-Dry<');
    expect(html).toContain('>Str. 3-6.<');
    expect(html).toContain('https://img/pampers.png');
    expect(html).not.toContain('https://img/libero.png');
    expect(html).toContain('>89,-<');
  });

  it('leaves a cluster\'s products to the chain\'s tile, in the printed packshot\'s box', () => {
    const group = Offer.parse({
      ...fresh, id: 'g1', name: 'Pampers m.fl.', imageUrl: 'https://img/pampers.png',
      imagePack: ['https://img/pampers.png', 'https://img/huggies.png', 'https://img/bambo.png'],
      members: ['new-1', 'x', 'y'],
    });
    const p = { ...page(), placements: [{ offerId: 'g1', slotId: 'a' }] };
    const all = new Map([...offers, [group.id, group]]);
    const cells = incitoCells(p, all)!;
    const html = incitoHtml(p.incito, cells.now, {}, cells.printed);
    expect(html).not.toContain('https://img/libero.png');
    expect(html).not.toContain('https://img/huggies.png');
    const [pack] = incitoPacks(p, all);
    expect(pack).toMatchObject({ slotId: 'a', offerId: 'g1' });
    expect(pack!.rect.w).toBeGreaterThan(0);
    expect(pack!.rect.h).toBeGreaterThan(0);
  });

  it('says "fra" in front of the lowest price when the products cost different amounts', () => {
    const group = Offer.parse({ ...fresh, id: 'g1', price: 30, priceFrom: true, members: ['new-1', 'x'] });
    const p = { ...page(), placements: [{ offerId: 'g1', slotId: 'a' }] };
    const cells = incitoCells(p, new Map([...offers, [group.id, group]]))!;
    const html = incitoHtml(p.incito, cells.now, {}, cells.printed);
    expect(html).toMatch(/data-name="fra"[^>]*>fra<\/span>30,-/);
    const one = incitoCells(page(), offers)!;
    expect(incitoHtml(page().incito, one.now, {}, one.printed)).not.toContain('>fra<');
  });

  it('hides a cell nobody stands in any more', () => {
    const p = { ...page(), placements: [] };
    const cells = incitoCells(p, offers)!;
    expect(incitoHtml(p.incito, cells.now, {}, cells.printed)).toMatch(/data-offer-view="1093377" style="[^"]*display:none/);
  });

  it('gives up only for a cell the publication never had', () => {
    expect(incitoCells({ ...page(), placements: [{ offerId: 'new-1', slotId: 'zz' }] }, offers)).toBeNull();
  });
});

describe('an offer on a published page follows its cell', () => {
  const page = () => ({ ...source(), slots: { a: '1093377' } });
  const placements = [{ offerId: '1093377', slotId: 'a' }];
  const offerStyle = (html: string) => /data-offer-view="1093377" style="([^"]*)"/.exec(html)?.[1] ?? '';

  it('stays where it was printed while nobody moves the cell', () => {
    const template = { slots: [{ id: 'a', rect: { x: 0, y: 0, w: 1, h: 0.43315 } }] };
    const incito = page();
    const html = incitoHtml(incito, new Map(), {}, new Map(), incitoCellBoxes({ incito, placements }, template));
    expect(offerStyle(html)).not.toContain('translate(');
  });

  it('moves and shrinks into the cell somebody dragged it to', () => {
    const base = { x: 0, y: 0, w: 1, h: 0.43315 };
    const incito = { ...page(), cellBase: { a: base } };
    const template = { slots: [{ id: 'a', rect: { x: 0.5, y: 0.5, w: 0.5, h: 0.216575 } }] };
    const html = incitoHtml(incito, new Map(), {}, new Map(), incitoCellBoxes({ incito, placements }, template));
    // Half the size, from the middle of the sheet: 300 points across, 500 down.
    expect(offerStyle(html)).toContain('translate(300.00px, 500.00px) scale(0.5000)');
  });

  it('finds its way back to a cell moved before the boxes were kept', () => {
    const incito = page();
    const template = { slots: [{ id: 'a', rect: { x: 0.5, y: 0.5, w: 0.5, h: 0.216575 } }] };
    const html = incitoHtml(incito, new Map(), {}, new Map(), incitoCellBoxes({ incito, placements }, template));
    expect(offerStyle(html)).toContain('scale(0.5000)');
  });
});
