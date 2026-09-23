import { describe, expect, it } from 'vitest';
import { deflateSync } from 'node:zlib';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BRAND_HEADER, createApp, Store } from '../index.js';

/**
 * A real PNG: a dark square on a white field that reaches every edge.
 *
 * Built here rather than read off disk so the test has no fixture to go
 * missing, and shaped deliberately: white to the border is exactly the
 * picture the old flood fill WOULD have keyed out, so a route that
 * still cut would not return these bytes.
 */
function png(size = 8): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer): number => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer): Buffer => {
    const head = Buffer.alloc(4);
    head.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc(body));
    return Buffer.concat([head, body, tail]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 2;   // truecolour
  // The raw scanlines: filter byte, then RGB triples.
  const raw = Buffer.concat(Array.from({ length: size }, (_, y) => {
    const row = Buffer.alloc(1 + size * 3, 0xff);
    row[0] = 0;
    for (let x = 0; x < size; x += 1) {
      const inside = x > 1 && x < size - 2 && y > 1 && y < size - 2;
      if (inside) row.fill(0x20, 1 + x * 3, 1 + x * 3 + 3);
    }
    return row;
  }));

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

describe('the chain\'s own pictures', () => {
  const upload = (dir: string, bytes: Buffer, name = 'grape.png') =>
    createApp(new Store(':memory:'), { assetDir: dir }).request('/api/brand/uploads', {
      method: 'POST',
      headers: { [BRAND_HEADER]: 'superbrugsen', 'content-type': 'application/json' },
      body: JSON.stringify({ file: bytes.toString('base64'), name }),
    });

  /*
   * The route used to flood-fill the background out of every upload.
   * It does not any more: a chain keeps its own cut-out artwork, and a
   * filter that guesses ate skies out of photographs. This is the whole
   * claim, stated as bytes.
   */
  it('stores the file exactly as it was handed in', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'incitio-uploads-'));
    const bytes = png();

    const response = await upload(dir, bytes);
    expect(response.status).toBe(200);
    const body = await response.json() as { url: string; bytes: number };

    expect(body.bytes).toBe(bytes.length);
    // Under the chain's own folder: the file name is the content's
    // hash, so a flat tree would hand every tenant a URL every other
    // tenant can reach by uploading the same bytes.
    expect(body.url).toMatch(/^\/uploads\/superbrugsen\/[0-9a-f]{12}\.png$/);

    const [stored] = readdirSync(join(dir, 'uploads', 'superbrugsen'));
    expect(readFileSync(join(dir, 'uploads', 'superbrugsen', stored!)).equals(bytes)).toBe(true);
  });

  it('keeps two chains apart even when the bytes are identical', async () => {
    // The same picture, uploaded by two chains: one file each, under
    // its own folder, and neither URL is reachable by guessing from
    // the other.
    const dir = mkdtempSync(join(tmpdir(), 'incitio-uploads-'));
    const bytes = png();
    const app = createApp(new Store(':memory:'), { assetDir: dir });
    const post = (brand: string) => app.request('/api/brand/uploads', {
      method: 'POST',
      headers: { [BRAND_HEADER]: brand, 'content-type': 'application/json' },
      body: JSON.stringify({ file: bytes.toString('base64'), name: 'grape.png' }),
    });

    const mine = await (await post('superbrugsen')).json() as { url: string };
    const theirs = await (await post('netto')).json() as { url: string };

    expect(mine.url).toContain('/uploads/superbrugsen/');
    expect(theirs.url).toContain('/uploads/netto/');
    expect(mine.url).not.toBe(theirs.url);
  });

  it('lists a chain its own pictures and nobody else\'s', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'incitio-uploads-'));
    const app = createApp(new Store(':memory:'), { assetDir: dir });
    const post = (brand: string, name: string) => app.request('/api/brand/uploads', {
      method: 'POST',
      headers: { [BRAND_HEADER]: brand, 'content-type': 'application/json' },
      body: JSON.stringify({ file: png().toString('base64'), name }),
    });
    await post('superbrugsen', 'balloner.png');
    await post('netto', 'flag.png');

    const listed = await app.request('/api/brand/uploads', {
      headers: { [BRAND_HEADER]: 'superbrugsen' },
    });
    const body = await listed.json() as { uploads: { name: string }[] };
    expect(body.uploads.map((entry) => entry.name)).toEqual(['balloner.png']);
  });

  it('forgets a picture without deleting the file', async () => {
    // A catalogue saved last week may still be printing it: a library
    // says what is on offer, not what exists.
    const dir = mkdtempSync(join(tmpdir(), 'incitio-uploads-'));
    const app = createApp(new Store(':memory:'), { assetDir: dir });
    const put = await app.request('/api/brand/uploads', {
      method: 'POST',
      headers: { [BRAND_HEADER]: 'superbrugsen', 'content-type': 'application/json' },
      body: JSON.stringify({ file: png().toString('base64'), name: 'balloner.png' }),
    });
    const { url } = await put.json() as { url: string };

    const gone = await app.request(`/api/brand/uploads?ref=${encodeURIComponent(url)}`, {
      method: 'DELETE',
      headers: { [BRAND_HEADER]: 'superbrugsen' },
    });
    expect(gone.status).toBe(200);

    const listed = await app.request('/api/brand/uploads', {
      headers: { [BRAND_HEADER]: 'superbrugsen' },
    });
    expect((await listed.json() as { uploads: unknown[] }).uploads).toEqual([]);
    expect(readdirSync(join(dir, 'uploads', 'superbrugsen'))).toHaveLength(1);
  });

  it('keeps the format the bytes actually are, not the name', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'incitio-uploads-'));
    const response = await upload(dir, png(), 'grape.jpg');
    const body = await response.json() as { url: string };
    // Sniffed, because a `.jpg` holding a PNG is what a designer's
    // folder contains and the extension decides how it is SERVED.
    expect(body.url.endsWith('.png')).toBe(true);
  });

  it('refuses a file that is not an image', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'incitio-uploads-'));
    const response = await upload(dir, Buffer.from('ikke et billede'), 'note.txt');
    expect(response.status).toBe(415);
  });
});
