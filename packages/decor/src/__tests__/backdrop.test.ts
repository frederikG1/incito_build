import { describe, expect, it } from 'vitest';
import { backdropPrompt, nearestAspect, partOf } from '../backdrop.js';

describe('the background brief for a page', () => {
  it('picks the accepted ratio nearest the card', () => {
    expect(nearestAspect(500, 400)).toBe('5:4');
    expect(nearestAspect(300, 450)).toBe('2:3');
    expect(nearestAspect(1000, 1000)).toBe('1:1');
  });

  it('sorts a piece of type into one of nine parts', () => {
    expect(partOf(0.9, 0.1)).toBe('top right');
    expect(partOf(0.2, 0.9)).toBe('bottom left');
    expect(partOf(0.5, 0.5)).toBe('in the middle');
  });

  it('writes the measured card into the brief, word for word', () => {
    const prompt = backdropPrompt({
      aspect: '5:4',
      colour: '#ffae4a',
      regions: [{ x0: 10.4, x1: 62, y0: 5, y1: 70.6 }, { x0: 55, x1: 95, y0: 60, y1: 90 }],
      text: ['bottom right', 'top right', 'bottom left', 'bottom right'],
      offer: 'Verdenskøkkener',
      products: ['Tortiglioni', 'Fusilli', 'Farfalle', 'Tomatsauce', 'Linguine', 'Penne', 'Pesto', 'Lasagne', 'Ravioli'],
    });
    expect(prompt).toContain('5:4, filling the whole page');
    expect(prompt).toContain('exactly #ffae4a');
    expect(prompt).toContain('in these regions — from 10 to 62 percent of the width and from 5 to 71 percent of the height; from 55 to 95');
    expect(prompt).toContain('printed top right, bottom left and bottom right');
    expect(prompt).toContain('page "Verdenskøkkener" (Tortiglioni, Fusilli, Farfalle, Tomatsauce, Linguine, Penne, Pesto, Lasagne, …)');
    expect(prompt).toContain('Style: Bright, appetising photography');
  });
});
