import { describe, expect, it } from 'vitest';
import { BRAND_HEADER, createApp, Store } from '../index.js';

/**
 * Reading an uploaded feed without building anything from it.
 *
 * The studio's product library is what this route feeds, and the two
 * things worth pinning down here are the two that used to go wrong
 * silently: a file was accepted and only turned out to be unreadable
 * after a model call had been paid for, and a file belonging to another
 * chain was one mis-detection away from being read as this one's.
 */
const read = (brandId: string, feed: string, filename?: string) =>
  createApp(new Store(':memory:')).request('/api/brand/feed', {
    method: 'POST',
    headers: { [BRAND_HEADER]: brandId, 'content-type': 'application/json' },
    body: JSON.stringify({ feed, ...(filename ? { filename } : {}) }),
  });

/** One row in the shape SuperBrugsen's Tjek export has. */
const TJEK = JSON.stringify([{
  id: 'o1',
  heading: 'Coop paneret kylling',
  description: 'Dybfrost. 240-250 g.',
  pricing: { price: 49, currency: 'DKK' },
  quantity: { size: { from: 240, to: 250 }, unit: { symbol: 'g' } },
  run_from: '2026-09-14T00:00:00+0000',
  run_till: '2026-09-20T00:00:00+0000',
  images: { zoom: 'https://img.example/kylling.jpg' },
}]);

describe('reading a feed', () => {
  it('says which of the chain\'s readers ran, and what it found', async () => {
    const response = await read('superbrugsen', TJEK, 'uge38.json');
    expect(response.status).toBe(200);

    const body = await response.json() as {
      source: { id: string; name: string; reason: string };
      offers: { id: string; name: string; price: number }[];
      withImage: number;
    };
    expect(body.source.id).toBe('tjek');
    expect(body.offers).toHaveLength(1);
    expect(body.offers[0]).toMatchObject({ name: 'Coop paneret kylling', price: 49 });
    /*
     * Counted on the server, because it is the number that decides what
     * can go on a page: an offer with no photograph cannot stand in for
     * a product in print.
     */
    expect(body.withImage).toBe(1);
  });

  /*
   * A file is matched against THIS chain's readers, never against every
   * chain's — see "Kæder er adskilte" in the README. Netto has one
   * reader and it is a CSV; handed SuperBrugsen's JSON it has to refuse
   * rather than find something in it.
   */
  it('refuses another chain\'s file instead of guessing at it', async () => {
    const response = await read('netto', TJEK, 'uge38.json');
    expect(response.status).toBe(422);
    expect((await response.json() as { error: string }).error).toBeTruthy();
  });

  it('refuses a source this chain does not have, and says which it has', async () => {
    const response = await createApp(new Store(':memory:')).request('/api/brand/feed', {
      method: 'POST',
      headers: { [BRAND_HEADER]: 'superbrugsen', 'content-type': 'application/json' },
      body: JSON.stringify({ feed: TJEK, sourceId: 'nemlig-feed' }),
    });
    expect(response.status).toBe(400);
    const body = await response.json() as { detail: string };
    expect(body.detail).toContain('tjek');
  });

  it('says an empty file is empty rather than parsing nothing', async () => {
    expect((await read('superbrugsen', '   ')).status).toBe(400);
  });

  /** Unscoped requests never reach a reader at all. */
  it('cannot be called without a chain', async () => {
    const response = await createApp(new Store(':memory:')).request('/api/brand/feed', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ feed: TJEK }),
    });
    expect(response.status).toBe(403);
  });
});
