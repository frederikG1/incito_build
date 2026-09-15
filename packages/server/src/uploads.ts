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

export function uploadStore(assetRoot: string, folder = 'uploads'): UploadStore {
  const dir = join(assetRoot, folder);
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
      return { key, ref: `/${folder}/${name}` };
    },
  };
}
