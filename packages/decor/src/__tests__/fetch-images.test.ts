import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchImages, forgetImages } from '../cluster.js';

function png(): Response {
  return new Response(new Uint8Array([1, 2, 3]), {
    status: 200,
    headers: { 'content-type': 'image/png' },
  });
}

afterEach(() => {
  forgetImages();
  vi.restoreAllMocks();
});

describe('fetchImages', () => {
  it('downloads a cutout once, however many times it is asked for', async () => {
    const fetcher = vi.fn(async () => png());
    vi.stubGlobal('fetch', fetcher);

    const first = await fetchImages(['https://x.test/a.png']);
    const second = await fetchImages(['https://x.test/a.png']);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(first[0]?.mimeType).toBe('image/png');
    expect(second[0]?.bytes).toEqual(first[0]?.bytes);
  });

  it('shares one download between clusters asking at the same time', async () => {
    const fetcher = vi.fn(async () => png());
    vi.stubGlobal('fetch', fetcher);

    await Promise.all([
      fetchImages(['https://x.test/b.png', 'https://x.test/c.png']),
      fetchImages(['https://x.test/b.png']),
    ]);

    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('does not remember a failure', async () => {
    const fetcher = vi.fn(async () => new Response('', { status: 404 }));
    vi.stubGlobal('fetch', fetcher);

    expect((await fetchImages(['https://x.test/d.png']))[0]).toBeNull();
    expect((await fetchImages(['https://x.test/d.png']))[0]).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('keeps a missing picture as a hole, so the numbering survives', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => png()));
    const got = await fetchImages(['https://x.test/e.png', null, 'ftp://nope']);
    expect(got.map((image) => (image ? 'ok' : null))).toEqual(['ok', null, null]);
  });
});
