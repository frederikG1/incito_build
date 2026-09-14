import { createHash } from 'node:crypto';
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Generated artwork on disk, addressed by the prompt that made it.
 *
 * Every other step in this pipeline is free to re-run — that is the
 * point of `npm run render`, which re-draws a built catalogue without
 * paying for curation again. Image generation is the first step that
 * costs real money per call, so it gets the same property: the file name
 * is a hash of the exact prompt, and asking for the same motif twice is
 * a stat() rather than a request.
 *
 * Hashing the PROMPT rather than the subject is deliberate. A change to
 * the craft wording in `imagePrompt` is a change to the artwork, and a
 * cache keyed on "almonds" would keep serving the old drawing forever
 * while the code that was supposed to improve it sat there doing
 * nothing.
 */

export interface DecorStore {
  /** Where the file would live, whether or not it exists yet. */
  pathFor(prompt: string): { key: string; file: string; ref: string };
  has(prompt: string): boolean;
  put(prompt: string, bytes: Buffer): { key: string; file: string; ref: string };
}

/**
 * @param assetRoot The directory served as the web root — `data/` here.
 * @param folder    Subdirectory within it. Also the URL's first segment.
 */
export function decorStore(assetRoot: string, folder = 'decor'): DecorStore {
  const dir = join(assetRoot, folder);

  const pathFor = (prompt: string) => {
    /*
     * Twelve hex characters. Long enough that a collision needs
     * ~16 million motifs, short enough that the filename stays
     * readable in a diff of `data/`.
     */
    const key = createHash('sha256').update(prompt).digest('hex').slice(0, 12);
    return {
      key,
      file: join(dir, `${key}.png`),
      /*
       * Root-relative, which is the form `withAssetBase` knows how to
       * rewrite for a `file://` print run. An absolute path here would
       * render in the studio and break in the PDF.
       */
      ref: `/${folder}/${key}.png`,
    };
  };

  return {
    pathFor,
    has: (prompt) => existsSync(pathFor(prompt).file),
    put: (prompt, bytes) => {
      const at = pathFor(prompt);
      mkdirSync(dir, { recursive: true });
      writeFileSync(at.file, bytes);
      return at;
    },
  };
}
