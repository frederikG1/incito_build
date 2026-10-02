import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Product photographs from the chain's image service, kept on disk.
 *
 * Republica wrote to say our key went from a few thousand pictures a day
 * to 60–200.000, nearly all at 240 and 560 — the studio's two sizes,
 * warmed for every offer on every reload, from a service that sends no
 * cache headers. A picture behind one URL never changes (the motive id,
 * the size and the format are all in it), so it is fetched from the
 * service ONCE per machine and answered from here ever after: the
 * studio through `/api/images`, the server's own model calls through
 * `fetchImages`, the PDF and the print checks through Chromium's routes.
 *
 * Only hosts listed in `CACHED` — this must not become an open proxy.
 */
export const CACHED = /^https:\/\/imageservice\d*\.republica\.dk\//;

export interface CachedImage {
  bytes: Buffer;
  mimeType: string;
}

const TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const FETCH_MS = 10_000;
const MAX_BYTES = 6 * 1024 * 1024;
/** A picture that would not come is not asked for again for this long — a retry loop must not become the next email. */
const MISS_MS = 10 * 60_000;

let dir: string | null = null;
const pending = new Map<string, Promise<CachedImage | null>>();
const missed = new Map<string, number>();

/** Where the pictures are kept. Until this is called, nothing is cached and `cachedImage` fetches every time. */
export function cacheImagesIn(directory: string): void {
  mkdirSync(directory, { recursive: true });
  dir = directory;
}

/** The picture behind `url`, from disk when it has been fetched before. Only for `CACHED` hosts. */
export function cachedImage(url: string): Promise<CachedImage | null> {
  if (!CACHED.test(url)) return Promise.resolve(null);
  const key = createHash('sha256').update(url).digest('hex');
  const file = dir ? join(dir, key) : null;
  if (file) {
    try {
      return Promise.resolve({ bytes: readFileSync(file), mimeType: readFileSync(`${file}.type`, 'utf8') });
    } catch { /* not fetched yet */ }
  }
  const at = missed.get(key);
  if (at !== undefined && Date.now() - at < MISS_MS) return Promise.resolve(null);
  // Six tiles asking for the same picture at once share one download.
  const inflight = pending.get(key);
  if (inflight) return inflight;
  const job = download(url).then((image) => {
    if (!image) missed.set(key, Date.now());
    else if (file) {
      // Type first, bytes renamed into place last: a half-written file is never read as a picture.
      writeFileSync(`${file}.type`, image.mimeType);
      writeFileSync(`${file}.part`, image.bytes);
      renameSync(`${file}.part`, file);
    }
    return image;
  }).finally(() => pending.delete(key));
  pending.set(key, job);
  return job;
}

async function download(url: string): Promise<CachedImage | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_MS) });
    if (!response.ok) return null;
    const type = (response.headers.get('content-type') ?? '').split(';')[0]!.trim();
    if (!TYPES.includes(type)) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_BYTES) return null;
    return { bytes, mimeType: type };
  } catch {
    return null;
  }
}
