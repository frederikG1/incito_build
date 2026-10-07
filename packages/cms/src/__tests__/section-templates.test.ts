import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { validateTemplate } from '@incitio/schema';
import { packBox, readCmsSectionDesigns, sectionTemplate } from '../section-templates.js';

const wolt = JSON.parse(readFileSync(new URL('../../../../data/cms/wolt-uge16-cms.json', import.meta.url), 'utf8'));
const box = { x: 0.037, y: 0.118, w: 0.926, h: 0.835 };
const px = (r: { x: number; y: number; w: number; h: number }) => [r.x * 600, r.y * 1000, r.w * 600, r.h * 1000].map(Math.round);
/** Within the CMS's own gutter: four pixels of its 600-wide sheet. */
const near = (got: number[][], want: number[][]) => {
  expect(got).toHaveLength(want.length);
  got.forEach((row, i) => row.forEach((v, j) => expect(Math.abs(v - want[i]![j]!)).toBeLessThanOrEqual(4)));
};

describe('packBox: offers in a box as the CMS lays them', () => {
  // Measured off Wolt's own previews of "Primary - Main" (556 × 835 at 22,118).
  it('stacks two', () => {
    near(packBox(box, 2).map(px), [[22, 118, 556, 417], [22, 536, 556, 417]]);
  });
  it('puts four in pairs', () => {
    near(packBox(box, 4).map(px), [[22, 118, 277, 417], [301, 118, 277, 417], [22, 536, 277, 417], [301, 536, 277, 417]]);
  });
  it('lets the first of five span the row', () => {
    const cells = packBox(box, 5);
    expect(cells[0]!.span).toBe(true);
    near(cells.map(px), [[22, 118, 556, 277], [22, 397, 277, 276], [301, 397, 277, 276], [22, 675, 277, 278], [301, 675, 277, 278]]);
  });
});

describe('sectionTemplate', () => {
  const designs = readCmsSectionDesigns(wolt);
  it('reads every section design in a capture', () => {
    expect(designs.length).toBe(26);
    expect(readCmsSectionDesigns(`incito_designs:${JSON.stringify(wolt.designs)}`)).toHaveLength(26);
  });
  it('turns each into a valid page and template', () => {
    for (const design of designs) {
      const s = sectionTemplate(design);
      expect(validateTemplate(s.template)).toEqual([]);
    }
  });
  it('keeps the look: backdrop colour, logo, heading, the panel offers stand on', () => {
    const intro = sectionTemplate(designs.find((d) => d.tag === 'Primary - Main' && d.layers.some((l) => l.name === 'Logo'))
      ?? designs.find((d) => d.layers.some((l) => l.name === 'Logo'))!);
    expect(intro.page.ground).toMatch(/^#/);
    expect(intro.page.decorations.some((d) => d.subject === 'Logo' && d.rect)).toBe(true);
    expect(intro.page.notes.some((n) => n.behind && n.background)).toBe(true);
    expect(intro.left.some((l) => l.includes('{{'))).toBe(true);
  });
  it('reads Løvbjerg\'s grid of single boxes as one offer each, each in its own design', () => {
    const lb = readCmsSectionDesigns(JSON.parse(readFileSync(new URL('../../../../data/cms/loevbjerg-uge16-17-cms.json', import.meta.url), 'utf8')));
    const s = sectionTemplate(lb.find((d) => d.tag === '1prio+2+3')!);
    expect(s.capacity).toBe(6);
    expect(s.template.slots[0]!.design).toBe('Avis priskasse lang prio');
    expect(new Set(s.template.slots.map((x) => x.design)).size).toBeGreaterThan(1);
  });
  it('sets three side-by-side offers for "Main with image"', () => {
    const s = sectionTemplate(designs.find((d) => d.tag === 'Primary - Main with image 1')!);
    expect(s.capacity).toBe(3);
    expect(s.offerTag).toBe('Design 2');
    expect(s.page.design?.tag).toBe('Design 2');
  });
});

describe('the sheet a section stands on', () => {
  const layer = (id: number, box: [number, number, number, number], extra: Record<string, unknown> = {}) => ({
    id, name: `l${id}`, x1: box[0], y1: box[1], x2: box[2], y2: box[3], ...extra,
  });
  // BrødCooperativet, reduced: a header picture on top, white offer panels, a photograph under the bottom row.
  const design = readCmsSectionDesigns([{
    id: 'brod', tag: 'BrødCooperativet', type: 'section', layers: [
      layer(1, [0, 0, 1, 0.18], { bg_image_url: { signed: 'https://x/header.png' } }),
      layer(2, [0.45, 0.11, 1, 0.69], { offers_tag: 'A', offers_max_count: 1, bg_color: 'rgb(255,255,255)' }),
      layer(3, [0, 0.73, 1, 1], { offers_tag: 'B', offers_max_count: 2 }),
      layer(4, [0, 0.73, 1, 1], { bg_image_url: { signed: 'https://x/kaffe.jpg' } }),
    ],
  }])[0]!;
  const made = sectionTemplate(design);

  it('is the CMS’s white, without the chain’s motif, when no layer colours it', () => {
    expect(made.page.ground).toBe('#ffffff');
    expect(made.page.motif).toBe(false);
  });
  it('lays a picture listed under an offer box behind the products, and one over none in front', () => {
    const byUrl = new Map(made.page.decorations.map((d) => [d.imageUrl, d.front]));
    expect(byUrl.get('https://x/kaffe.jpg')).toBe(false);
    expect(byUrl.get('https://x/header.png')).toBe(true);
  });
});
