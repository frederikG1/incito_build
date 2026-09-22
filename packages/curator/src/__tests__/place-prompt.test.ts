import { describe, expect, it } from 'vitest';
import {
  CANVAS_TOKEN, PLACE_PROMPTS, PLACE_SCENE, namesProducts, placePrompt, placeSystem,
} from '../place-prompt.js';

const CELL = { width: 506, height: 500 };
const GOODS = [
  { name: 'Tandbørste t. protese', aspect: 0.33 },
  { name: 'Shampoo (normalt og tørt hår)', aspect: 0.5 },
  { name: 'Hårspray (extreme hold)', aspect: 0.33 },
];

describe('the standing prompts', () => {
  it('all carry the canvas token', () => {
    // Without it the model is asked for pixels inside a box nobody
    // stated, and two products meant to be the same size come back a
    // few per cent apart.
    for (const entry of PLACE_PROMPTS) {
      expect(entry.text, entry.id).toContain(CANVAS_TOKEN);
    }
  });

  it('all say what they answer with', () => {
    for (const entry of PLACE_PROMPTS) {
      for (const field of ['left', 'top', 'width', 'height', 'tilt_degrees', 'covered_by']) {
        expect(entry.text, `${entry.id} · ${field}`).toContain(field);
      }
      expect(entry.text, entry.id).toMatch(/view/);
    }
  });

  it('are offered under distinct names', () => {
    const ids = PLACE_PROMPTS.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of PLACE_PROMPTS) expect(entry.name.length).toBeGreaterThan(0);
  });

  it('leaves no stand-in unfilled once the facts are known', () => {
    for (const entry of PLACE_PROMPTS) {
      const filled = placeSystem(entry.text, {
        canvas: CELL, products: GOODS, offerName: 'Personlig pleje',
      });
      expect(filled, entry.id).not.toMatch(/\{(canvas|count|products|offer)\}/);
    }
  });
});

describe('placePrompt', () => {
  it('finds the one asked for', () => {
    expect(placePrompt('beskrivelse')).toBe(PLACE_SCENE);
  });

  it('falls back to the first rather than to nothing', () => {
    // A stale id out of a browser's storage must not send an empty
    // system prompt to the model.
    expect(placePrompt('noget-der-ikke-findes')).toBe(PLACE_PROMPTS[0]!.text);
  });
});

describe('placeSystem', () => {
  const cell = (width: number, height: number) =>
    placeSystem(CANVAS_TOKEN, { canvas: { width, height } });

  it('says the shape in words as well as in figures', () => {
    expect(cell(506, 500)).toBe(
      'The canvas is square, 1.01:1 (width:height), 506 x 500 pixels.',
    );
    expect(cell(900, 300)).toContain('wider than it is tall');
    expect(cell(300, 900)).toContain('taller than it is wide');
  });

  it('numbers the products the way the prompt asks them to be numbered', () => {
    const said = placeSystem('{count}\n{products}\n{offer}', {
      canvas: CELL, products: GOODS, offerName: 'Personlig pleje',
    });
    expect(said).toBe([
      '3',
      '1. Tandbørste t. protese (aspect 0.33)',
      '2. Shampoo (normalt og tørt hår) (aspect 0.50)',
      '3. Hårspray (extreme hold) (aspect 0.33)',
      'Personlig pleje',
    ].join('\n'));
  });

  it('leaves the aspect out when the cutout was never measured', () => {
    expect(placeSystem('{products}', { canvas: CELL, products: [{ name: 'Balsam' }] }))
      .toBe('1. Balsam');
  });

  it('names an offer nobody named', () => {
    expect(placeSystem('{offer}', { canvas: CELL })).toBe('tilbuddet');
  });

  it('leaves a prompt with no stand-ins exactly as it was', () => {
    // An editor's own version is theirs; the brief states the facts
    // either way.
    const mine = 'Sæt varerne op som du vil.';
    expect(placeSystem(mine, { canvas: CELL })).toBe(mine);
  });

  it('never states a canvas of nothing', () => {
    expect(cell(0, 0)).toContain('1 x 1 pixels');
  });
});

describe('namesProducts', () => {
  it('is what stops the brief listing them a second time', () => {
    // Two numberings of the same six cutouts is an invitation to
    // answer about twelve.
    expect(namesProducts(PLACE_SCENE)).toBe(true);
    expect(namesProducts(PLACE_PROMPTS[0]!.text)).toBe(false);
  });
});
