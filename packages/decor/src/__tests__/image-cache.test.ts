import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const URL = 'https://imageservice2.republica.dk/motive/791-8748?size=560&format=png&trim=1&key=abc';
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

describe('cachedImage', () => {
  let dir: string;
  let calls: string[];

  beforeEach(() => {
    vi.resetModules();
    dir = mkdtempSync(join(tmpdir(), 'image-cache-'));
    calls = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(url);
      return new Response(PNG, { headers: { 'content-type': 'image/png' } });
    }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    rmSync(dir, { recursive: true, force: true });
  });

  it('asks the image service once per picture, however often and however many at once', async () => {
    const { cacheImagesIn, cachedImage } = await import('../image-cache.js');
    cacheImagesIn(dir);
    const together = await Promise.all([cachedImage(URL), cachedImage(URL), cachedImage(URL)]);
    const later = await cachedImage(URL);
    expect(calls).toEqual([URL]);
    for (const image of [...together, later]) expect(image).toEqual({ bytes: Buffer.from(PNG), mimeType: 'image/png' });
  });

  it('keeps it across restarts', async () => {
    (await import('../image-cache.js')).cacheImagesIn(dir);
    await (await import('../image-cache.js')).cachedImage(URL);
    vi.resetModules();
    const fresh = await import('../image-cache.js');
    fresh.cacheImagesIn(dir);
    expect(await fresh.cachedImage(URL)).not.toBeNull();
    expect(calls).toHaveLength(1);
  });

  it('fetches nothing for other hosts', async () => {
    const { cacheImagesIn, cachedImage } = await import('../image-cache.js');
    cacheImagesIn(dir);
    expect(await cachedImage('https://example.com/a.png')).toBeNull();
    expect(await cachedImage('http://imageservice2.republica.dk/motive/1')).toBeNull();
    expect(calls).toEqual([]);
  });

  it('does not retry a failure straight away', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => { calls.push(url); return new Response('', { status: 500 }); }));
    const { cacheImagesIn, cachedImage } = await import('../image-cache.js');
    cacheImagesIn(dir);
    expect(await cachedImage(URL)).toBeNull();
    expect(await cachedImage(URL)).toBeNull();
    expect(calls).toHaveLength(1);
  });
});
