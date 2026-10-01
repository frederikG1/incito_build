import { describe, expect, it } from 'vitest';
import { fittedNoteSize } from '../PageView.js';

const paragraph = 'En forskel der kan mærkes\nÄnglamark er Coops serie af varer, der alle bærer én eller flere mærkningsordninger; Økologi, Svanemærket, Asthma Allergy Nordic eller Fairtrade.';

describe('a text in its measured box', () => {
  it('shrinks a headline-sized paragraph until it stands in its box', () => {
    const note = { text: paragraph, size: 0.0417, w: 0.3136, h: 0.1538, bold: true };
    const size = fittedNoteSize(note, 0.707);
    expect(size).toBeLessThan(0.03);
    expect(size).toBeGreaterThan(0.0417 / 3);
  });

  it('leaves a text alone that fits, or that has no box', () => {
    expect(fittedNoteSize({ text: 'Kun i weekenden', size: 0.03, w: 0.6, h: 0.08, bold: true }, 0.707)).toBe(0.03);
    expect(fittedNoteSize({ text: paragraph, size: 0.0417, w: 0.3136, h: null, bold: true }, 0.707)).toBe(0.0417);
  });
});
