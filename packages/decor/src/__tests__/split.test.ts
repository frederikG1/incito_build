import { describe, expect, it } from 'vitest';
import { composedCount } from '../split.js';

describe('how many photographs a packshot is made of', () => {
  it('counts the products a Tjek transformer URL lays side by side', () => {
    const url = 'https://image-transformer-api.tjek.com/?_id=v3&h=374&u=s3%3A%2F%2Fa%2Fx%2Cs3%3A%2F%2Fa%2Fy%2Cs3%3A%2F%2Fa%2Fz&w=552&s=abc';
    expect(composedCount(url)).toBe(3);
  });

  it('says nothing about a single photograph or a plain URL', () => {
    expect(composedCount('https://image-transformer-api.tjek.com/?u=s3%3A%2F%2Fa%2Fx&w=552')).toBeNull();
    expect(composedCount('/uploads/superbrugsen/abc.png')).toBeNull();
  });
});
