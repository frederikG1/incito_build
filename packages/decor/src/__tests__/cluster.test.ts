import { describe, expect, it } from 'vitest';
import { clusterPrompt, MAX_CLUSTER, MIN_CLUSTER } from '../cluster.js';
import { clusterFamilies, notOnePhotograph } from '@incitio/schema';

/**
 * The prompt is the feature, so the prompt is what is pinned.
 *
 * The call itself needs a billed Google project and cannot be tested
 * here. What can be — and what every one of these assertions stands for
 * — is that the prompt is GENERAL: it was written about seven named
 * biscuits, and a prompt that still knows anything about them is a
 * prompt that only works once.
 */
const PRODUCTS = [
  { name: 'Riskiks økologisk', size: '120 g' },
  { name: 'Linsekiks m. salt' },
  { name: 'Rugbrødssnacks m. havsalt', size: '90 g' },
];

describe('the cluster prompt', () => {
  const prompt = clusterPrompt(PRODUCTS, { aspect: 0.87 });

  it('counts the products it was actually given', () => {
    expect(prompt).toContain('exactly 3 images');
    expect(clusterPrompt([{ name: 'A' }, { name: 'B' }])).toContain('exactly 2 images');
  });

  it('says every one of them is used, exactly once', () => {
    expect(prompt).toContain('Use only these exact products, each exactly once');
  });

  it('numbers each image by the product it shows', () => {
    expect(prompt).toContain('image 1: Riskiks økologisk (120 g)');
    expect(prompt).toContain('image 2: Linsekiks m. salt');
    expect(prompt).toContain('image 3: Rugbrødssnacks m. havsalt (90 g)');
  });

  /*
   * The pack size is what the "NATURAL SIZES" paragraph asks the model
   * to read off the label, and the feed already knows it for most
   * products — so it is stated rather than left to be guessed from a
   * photograph.
   */
  it('states a size when the feed knows one and nothing when it does not', () => {
    expect(clusterPrompt([{ name: 'A' }, { name: 'B' }])).toContain('image 1: A,');
    expect(clusterPrompt([{ name: 'A', size: '1 l' }, { name: 'B' }]))
      .toContain('image 1: A (1 l)');
  });

  it('asks for the cell\'s own proportions', () => {
    expect(prompt).toContain('Output aspect ratio 0.87:1');
    expect(clusterPrompt(PRODUCTS, { aspect: 2.1 })).toContain('Output aspect ratio 2.10:1');
    // Square when nobody said, rather than a number that came from
    // whichever page this happened to be written against.
    expect(clusterPrompt(PRODUCTS)).toContain('Output aspect ratio 1.00:1');
  });

  /*
   * Everything below is a rule about how a leaflet composes a group,
   * and none of it may quietly go missing: each line is a failure
   * somebody would otherwise find in a printed proof.
   */
  /*
   * The section the whole feature rests on.
   *
   * An image model redraws pixels; it does not copy them, and what it
   * is worst at is small type — a brand name, a fat percentage, a
   * barcode. On a leaflet that is not a blemish: the chain contracted
   * for that artwork, and a redrawn logo is its name on a product it
   * never approved. So the job is named as what it is — a collage —
   * before anything else is asked for.
   */
  it('names the job a collage before it asks for anything', () => {
    expect(prompt).toContain('CRITICAL: PIXEL-PERFECT COPYING ONLY');
    expect(prompt).toContain('pure cut-and-paste collage task');
    expect(prompt).toContain('Do NOT generate, redraw, or hallucinate');
    expect(prompt).toContain('every letter of text, every barcode');
    expect(prompt).toContain('no blurring, character alteration, or AI upscaling');
    // Before the arrangement is discussed at all: it is the condition,
    // not a caveat on it.
    expect(prompt.indexOf('CRITICAL: PIXEL-PERFECT'))
      .toBeLessThan(prompt.indexOf('CHANGE ONLY THE ARRANGEMENT'));
  });

  it('forbids restyling the products', () => {
    expect(prompt).toContain('Change only the position, size and layering');
    expect(prompt).toContain('letter for letter');
    expect(prompt).toContain('Do not restyle, relabel or invent products');
  });

  /*
   * The contract the cut-out step downstream depends on, and the one
   * the model most wants to break: it was asked for "one shared floor"
   * and drew a literal one, with a shadow under it, which is a picture
   * that cannot be placed on SuperBrugsen's yellow.
   */
  it('keeps the cutout contract the page depends on', () => {
    expect(prompt).toContain('NO visible floor, table, shelf or surface');
    expect(prompt).toContain('pure white (#FFFFFF)');
    expect(prompt).toContain('edge to edge and into every corner');
    expect(prompt).toContain('No cast shadow, contact shadow, reflection or glow');
    expect(prompt).toContain('No gradient, vignette, tint, texture or paper');
    // Said as a reason, not only as a ban: the model is being told what
    // the white is FOR, which is what survives a paraphrase.
    expect(prompt).toContain('cut out of it and printed on a coloured page');
  });

  it('asks for a shared baseline without asking for something to stand on', () => {
    expect(prompt).toContain('share one baseline');
    expect(prompt).not.toContain('shared floor');
  });

  it('names one hero and keeps every label readable', () => {
    expect(prompt).toContain('Choose one hero');
    expect(prompt).toContain('at least 85%\n visible'.replace('\n ', ' '));
  });

  /*
   * Asked to overlap, a model buries half the group — so the licence
   * and its limit are stated together, and the limit is a number.
   */
  it('licenses the overlap and bounds it in the same breath', () => {
    expect(prompt).toContain('VISIBILITY & MODERATE OVERLAP');
    expect(prompt).toContain('Do NOT scatter the products apart');
    expect(prompt).toContain('completely unobstructed and readable');
    expect(prompt).toContain('smaller/shorter items in the front row');
  });

  it('carries the editor\'s own words, with the contract still last', () => {
    const steered = clusterPrompt(PRODUCTS, { note: 'den store bagest' });
    expect(steered).toContain('den store bagest');
    expect(steered.indexOf('den store bagest'))
      .toBeLessThan(steered.indexOf('BACKGROUND AND OUTPUT'));
  });

  it('says nothing about the products it was first written for', () => {
    // It was a prompt about seven named biscuits. A prompt that still
    // knows one of them is a prompt that works exactly once.
    for (const ghost of ['Knækbrød', 'chokolade', 'BBQ', 'æble og kanel', '7 images']) {
      expect(clusterPrompt([{ name: 'Mælk' }, { name: 'Smør' }])).not.toContain(ghost);
    }
  });
});

describe('how many a photograph holds', () => {
  it('is a group at two and the schema\'s own ceiling at eight', () => {
    expect(MIN_CLUSTER).toBe(2);
    expect(MAX_CLUSTER).toBe(8);
  });
});

describe('what can be one photograph', () => {
  const soda = (name: string) => ({ name, category: 'Drikkevarer' });

  it('takes a shelf of one kind, however many', () => {
    expect(notOnePhotograph([soda('San Pellegrino'), soda('Änglamark lemon')])).toBeNull();
    expect(notOnePhotograph([
      soda('a'), soda('b'), soda('c'), soda('d'), soda('e'), soda('f'),
    ])).toBeNull();
  });

  it('refuses a tile that is three offers sharing a price', () => {
    // The real one: washing powder, dishwasher gel and frozen croquettes.
    const said = notOnePhotograph([
      { name: 'Neutral storvask', category: 'Husholdning' },
      { name: 'Coop all-in-1 gel', category: 'Husholdning' },
      { name: 'Coop krokketter', category: 'Frost' },
      { name: 'Änglamark rugbrød', category: 'Brød og mejeri' },
    ]);
    expect(said).toMatch(/3 varegrupper/);
    expect(said).toMatch(/Husholdning/);
  });

  it('says how many are too many', () => {
    const many = Array.from({ length: 9 }, (_, i) => soda(`vare ${i}`));
    expect(notOnePhotograph(many)).toMatch(/9 varer/);
  });

  it('cannot refuse on a feed that names no categories', () => {
    // Nothing to go on is not evidence against; the count still applies.
    expect(notOnePhotograph([{ name: 'a' }, { name: 'b' }, { name: 'c' }])).toBeNull();
  });

  it('counts only the categories a feed actually filled in', () => {
    expect(clusterFamilies([
      { category: 'Frost' }, { category: '  ' }, { category: null }, { category: 'Frost' },
    ])).toEqual(['Frost']);
  });
});
