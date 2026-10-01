import { describe, expect, it } from 'vitest';
import { sizedImage } from '../image.js';

const feed = 'https://imageservice2.republica.dk/motive/785-7770?size=800&format=png&trim=1&key=abc';

describe('a product photograph at the size it is drawn', () => {
  it('asks the image service for fewer pixels, keeping the signed link', () => {
    expect(sizedImage(feed, 240)).toBe('https://imageservice2.republica.dk/motive/785-7770?size=240&format=png&trim=1&key=abc');
  });

  it('steps around the one size the service flattens onto white', () => {
    expect(sizedImage(feed, 200)).toContain('size=220');
  });

  it('never asks for more than the feed linked, and leaves print alone', () => {
    expect(sizedImage(feed, 1200)).toBe(feed);
    expect(sizedImage(feed, null)).toBe(feed);
  });

  it('leaves every other image service as it is', () => {
    const tjek = 'https://image-transformer-api.tjek.com/?_id=v3&h=572&u=s3%3A%2F%2Fx';
    expect(sizedImage(tjek, 200)).toBe(tjek);
  });
});
