import { describe, expect, it } from 'vitest';
import { normalizeRows } from '@incitio/ingest';
import { STARTER_RULES, offerFacts, resolveLook } from '@incitio/schema';
import { customLabels, tjekTransformed } from '../mappings/tjek.js';

describe('customLabels', () => {
  it('lifts Bilka-style tags into typed labels in the chain\'s words', () => {
    const labels = customLabels({
      custom_label_1: 'Nyhed, Warranty 5', custom_label_2: 'Nedsat pris', custom_label_3: '', comment_label_2: 'Køb 3 for 100,-',
    });
    expect(labels).toEqual([
      { kind: 'new', text: 'Nyhed' },
      { kind: 'custom', text: 'Warranty 5' },
      { kind: 'saving', text: 'Nedsat pris' },
      { kind: 'multibuy', text: '3 for 100,-' },
    ]);
  });

  it('says nothing twice and nothing for empty fields', () => {
    expect(customLabels({})).toEqual([]);
    expect(customLabels({ custom_label_1: 'Nyhed' }, [{ kind: 'new', text: 'nyhed' }])).toEqual([]);
  });
});

/*
 * Biltema DK, "Alt til en god september - Næstved" (n8AF6BV1), as the
 * CMS holds the offers — the fields as filled, the web texts cut short.
 * Custom Label 3 is the product's description, not a tag.
 */
const WEEK = { valid_from: '2026-09-01', valid_until: '2026-09-30' };
const BILTEMA = [
  { id: '37831', name: 'Fælgrens, 500 ml', price: 39.9, comment_label_2: '3 for 89,90', comment_label_3: 'Du sparer 29,80',
    custom_label_3: 'Skånsom og effektiv fælgrens. En syrefri blanding som reagerer med snavset og ændrer farve, når dette er opløst.' },
  { id: '14399', name: 'Trillebør, 160 liter', description: 'maks. 200 kg.', price: 849,
    custom_label_3: 'Kraftig model med pulverlakeret stel og plastlad. To luftfyldte hjul (41-148).' },
  { id: '841334', name: 'Elkedel, 1,7 L', price: 139, custom_label_3: 'Med denne elegante elkedel med en kande af glas kan du nemt koge vand.' },
  { id: '840083', name: 'Brødrister, 780–930 W', price: 159, custom_label_3: 'Elsker du ristet brød? Så er denne stilrene brødrister af rustfrit stål et must.' },
  { id: '840065', name: 'Blender, 600 W', price: 239, custom_label_3: 'Med denne brugervenlige blender kan du blande babymad, supper og saucer.' },
  { id: '858023', name: 'Bagepapir, 24 ark', price: 9.9, custom_label_3: 'Dette hvide bagepapir i ark kan bruges til madlavning og bagning.' },
  { id: '360240', name: 'Håndopvaskemiddel, 1 liter', price: 9.9, custom_label_3: 'Biltema Håndopvaskemiddel er et koncentreret, drøjt opvaskemiddel.' },
  { id: '841622', name: 'Blodtryksmåler, arm', price: 189,
    custom_label_3: 'Produktet er testet i henhold til internationale standarder og måler med høj nøjagtighed.' },
].map((row) => ({ unit_symbol: 'piece', unit_size_from: 1, unit_size_to: 1, piece_count_from: 1, piece_count_to: 1, ...WEEK, ...row }));

describe('Biltema\'s own week, recognised', () => {
  const { feed, issues } = normalizeRows(BILTEMA, tjekTransformed('biltema', 'cms'));
  const byId = new Map(feed.offers.map((offer) => [offer.id, offer]));

  it('reads every row, and no web text as a tag', () => {
    expect(issues).toEqual([]);
    expect(feed.offers).toHaveLength(8);
    for (const offer of feed.offers) {
      for (const label of offer.labels) expect(label.text.length, offer.name).toBeLessThanOrEqual(40);
    }
    // "testet i henhold til…" is in the description, not a Testet mark.
    expect(offerFacts(byId.get('841622')!).tested).toBe(false);
  });

  it('knows the fælgrens is a multibuy that saves', () => {
    const facts = offerFacts(byId.get('37831')!);
    expect(facts.multibuy).toBe(true);
    expect(facts.savings).toBe(true);
    expect(facts.reduced).toBe(false);
    expect(byId.get('37831')!.labels.map((label) => label.text)).toEqual(['3 for 89,90', 'Du sparer 29,80']);
  });

  it('leaves the plain offers plain', () => {
    for (const id of ['14399', '841334', '840083', '840065', '858023', '360240', '841622']) {
      expect(resolveLook(byId.get(id)!, STARTER_RULES).variant, id).toBeNull();
    }
  });
});
