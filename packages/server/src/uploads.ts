import { createHash } from 'node:crypto';
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The chain's own artwork, on disk.
 *
 * A sibling of `decorStore` in `@incitio/decor` rather than a use of it,
 * because the two cache different things for different reasons. That one
 * is addressed by the PROMPT that generated a picture, so that asking
 * twice costs one API call; this is addressed by the BYTES, so that a
 * designer who drags the same photograph of grapes onto four pages
 * stores it once. Bending one into the other would leave a store whose
 * key means two things.
 *
 * The file keeps its real extension. The decor cache can hard-code
 * `.png` because it made the file; here the bytes arrive from a person's
 * disk, and a JPEG served as `image/png` is the kind of thing that works
 * in a browser and then does not work in the printer.
 *
 * Written under the directory the studio serves and the PDF resolves
 * against, and referenced root-relative for the same reason the decor
 * cache is: an absolute path renders on screen and breaks in a
 * `file://` print run.
 */

export interface UploadStore {
  put(bytes: Buffer, extension: string): { key: string; ref: string };
}

/**
 * One chain's corner of the upload tree.
 *
 * Scoped by brand, and not as a formality. The file name is the
 * content's own hash, so a flat tree hands every tenant a URL every
 * other tenant can arrive at by uploading the same bytes — or by
 * guessing twelve hex characters. Isolation in this repo is structural
 * everywhere else (`brand_id` on every row, the brand resolved once in
 * middleware), and the one place it was a convention was the one place
 * the artefact is served straight off disk by a static file server
 * that has never heard of a tenant.
 *
 * A chain's id is `[a-z0-9-]` by construction; it is filtered anyway,
 * because a path segment built from a request is exactly the sort of
 * thing that stops being safe the day somebody adds a brand.
 */
export function uploadStore(
  assetRoot: string,
  brandId: string,
  folder = 'uploads',
): UploadStore {
  const safe = brandId.replace(/[^a-z0-9-]/gi, '') || 'ukendt';
  const dir = join(assetRoot, folder, safe);
  /*
   * Made at boot, not at the first upload.
   *
   * The studio serves this tree through Vite's static root, and a
   * directory that appears while the dev server is running is not
   * necessarily served for the first request that asks for it —
   * measured: the very first upload into a fresh `data/uploads/` came
   * back 404, the `<img>` gave up, and an `<img>` never retries a `src`
   * it has already failed. Existing from the start costs one `mkdir`
   * and removes the whole class of first-run confusion.
   */
  mkdirSync(dir, { recursive: true });

  return {
    put(bytes, extension) {
      // Twelve hex characters of the content itself: the same picture
      // dropped on six pages is one file, and re-uploading it after a
      // reload does not grow the directory.
      const key = createHash('sha256').update(bytes).digest('hex').slice(0, 12);
      const name = `${key}.${extension}`;
      const file = join(dir, name);
      if (!existsSync(file)) writeFileSync(file, bytes);
      return { key, ref: `/${folder}/${safe}/${name}` };
    },
  };
}
