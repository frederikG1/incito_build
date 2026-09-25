import { describe, expect, it } from 'vitest';
import { DARK, QUIET, chooseBackdrop, type Backdrop } from '../backdrop.js';

/** An A4 sheet, which is what every chain in here prints on. */
const A4 = 0.707;

const picture = (over: Partial<Backdrop>): Backdrop => ({
  width: 1600,
  height: 2263,
  saturation: 0.2,
  luminance: 0.7,
  variety: 0.1,
  focusX: 50,
  focusY: 50,
  ...over,
});

describe('chooseBackdrop', () => {
  it('fills the sheet whatever shape the picture is', () => {
    // The mistake this replaced: a picture whose shape disagreed with
    // the page was letterboxed, which puts bands of the chain's
    // ground above and below and reads as a broken page.
    const landscape = chooseBackdrop(picture({ width: 2000, height: 1499 }), A4);
    const square = chooseBackdrop(picture({ width: 1080, height: 1080 }), A4);
    const tall = chooseBackdrop(picture({ width: 800, height: 3000 }), A4);
    for (const chosen of [landscape, square, tall]) expect(chosen.fit).toBe('cover');
  });

  it('names the edges that actually get cut', () => {
    // A landscape picture on a portrait sheet loses its sides and
    // nothing off the top; saying otherwise sends somebody to the
    // wrong slider.
    expect(chooseBackdrop(picture({ width: 2000, height: 1499 }), A4).why)
      .toMatch(/beskåret i siderne/);
    expect(chooseBackdrop(picture({ width: 800, height: 3000 }), A4).why)
      .toMatch(/beskåret i top og bund/);
  });

  it('crops around the picture\'s own centre of contrast', () => {
    const chosen = chooseBackdrop(picture({ focusX: 34, focusY: 71 }), A4);
    expect(chosen.focusX).toBe(34);
    expect(chosen.focusY).toBe(71);
    expect(chosen.why).toMatch(/om motivet \(34\/71\)/);
  });

  it('says nothing about the crop when it sits in the middle anyway', () => {
    expect(chooseBackdrop(picture({ focusX: 52, focusY: 47 }), A4).why)
      .not.toMatch(/om motivet/);
  });

  it('turns a loud colour field down so the prices survive', () => {
    // The chain's red key visual: saturation 0.83, luminance 0.27.
    const chosen = chooseBackdrop(
      picture({ width: 447, height: 447, saturation: 0.83, luminance: 0.27 }),
      A4,
    );
    expect(chosen.opacity).toBe(QUIET);
    expect(chosen.why).toMatch(/dæmpet fordi det er mættet/);
  });

  it('turns a dark picture down even when it is grey', () => {
    const chosen = chooseBackdrop(picture({ saturation: 0.05, luminance: DARK - 0.1 }), A4);
    expect(chosen.opacity).toBe(QUIET);
    expect(chosen.why).toMatch(/mørkt/);
  });

  it('leaves a pale photograph at full strength', () => {
    // The beach: saturation 0.08, luminance 0.83. Nothing to turn down.
    const chosen = chooseBackdrop(
      picture({ width: 2000, height: 1499, saturation: 0.08, luminance: 0.83 }),
      A4,
    );
    expect(chosen.opacity).toBe(1);
    expect(chosen.why).not.toMatch(/dæmpet/);
  });

  it('is not fooled by how flat a picture is', () => {
    // Measured: the red graphic came out at variety 0.037 and the
    // beach photograph at 0.063. A flat photograph is as flat as a
    // flat design, so nothing here may depend on it.
    const graphic = chooseBackdrop(picture({ variety: 0.037 }), A4);
    const photo = chooseBackdrop(picture({ variety: 0.063 }), A4);
    expect(graphic.fit).toBe(photo.fit);
  });

  it('repeats a swatch rather than blowing it up', () => {
    const chosen = chooseBackdrop(picture({ width: 120, height: 120 }), A4);
    expect(chosen.fit).toBe('tile');
    expect(chosen.why).toMatch(/120×120/);
  });

  it('centres a swatch, whatever its contrast says', () => {
    // A repeated pattern starts in the corner; a focus would move
    // nothing and reporting one would be a claim about nothing.
    const chosen = chooseBackdrop(picture({ width: 64, height: 64, focusX: 20, focusY: 80 }), A4);
    expect([chosen.focusX, chosen.focusY]).toEqual([50, 50]);
  });

  it('never divides by a height of nothing', () => {
    expect(() => chooseBackdrop(picture({ width: 100, height: 0 }), A4)).not.toThrow();
    expect(() => chooseBackdrop(picture({}), 0)).not.toThrow();
  });
});
