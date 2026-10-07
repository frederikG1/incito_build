import { describe, expect, it } from 'vitest';
import { sectionHeading } from '../plan.js';

describe('page headings from feed categories', () => {
  it('puts æ, ø and å back into a slug', () => {
    expect(sectionHeading('frugt-og-groent')).toBe('Frugt og grønt');
    expect(sectionHeading('koed-og-fisk')).toBe('Kød og fisk');
    expect(sectionHeading('broed_og_paalaeg')).toBe('Brød og pålæg');
  });

  it('leaves the feed\'s own words alone', () => {
    expect(sectionHeading('Frugt og grønt')).toBe('Frugt og grønt');
    expect(sectionHeading('VIN OG SPIRITUS')).toBe('Vin og spiritus');
    expect(sectionHeading('Michael Kaffe')).toBe('Michael Kaffe');
  });
});
