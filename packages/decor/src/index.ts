import type { Browser } from 'playwright';
import type { Brand, CatalogDocument, DecorAnchor, Offer, PageDecoration } from '@incitio/schema';
import { chooseSubjects, type PageBrief } from './subject.js';
import { imagePrompt } from './prompt.js';
import { generateImage, GeminiError, type GeminiOptions } from './gemini.js';
import { cutout } from './cutout.js';
import { decorStore } from './store.js';

export * from './gemini.js';
export * from './subject.js';
export * from './prompt.js';
export * from './cutout.js';
export * from './store.js';

/**
 * Step 5: decoration.
 *
 * Runs AFTER composition, on a finished document, and returns a new one.
 * That ordering is the whole design — it needs to know what ended up on
 * each page, and it must be re-runnable on a catalogue someone has
 * already edited without disturbing a single placement.
 *
 * Two model calls of different kinds and different costs:
 *
 *   1. ONE text call for the whole book, deciding what each page should
 *      depict and, as often as not, that it should depict nothing.
 *   2. One image call per page that survived that, minus everything
 *      already in the cache.
 *
 * Failure is never fatal. A leaflet without atmosphere is a leaflet; a
 * build that dies because a picture of almonds could not be drawn is
 * not. Every error is collected and returned.
 */

export interface DecorateOptions extends GeminiOptions {
  /** Directory served as the web root. Artwork lands in `<assetRoot>/decor`. */
  assetRoot: string;
  /** The chain, for the register the artwork is drawn in. */
  brand?: Brand;
  /** Editor direction, same spirit as the curator's `brief`. */
  brief?: string;
  /** Image model, when it should differ from the text model. */
  imageModel?: string;
  /** Reuse one Chromium across the run. */
  browser?: Browser;
  /** Decorate at most this many pages. Omit for all of them. */
  maxPages?: number;
  /** Answer from the cache only — never call the image model. */
  offline?: boolean;
  /** Layout seed, so a rebuild puts the artwork back where it was. */
  seed?: string;
}

export interface DecorateResult {
  document: CatalogDocument;
  /** How many pages gained artwork. */
  drawn: number;
  /** Pages the model deliberately left plain, with no motif. */
  skipped: number;
  /** Images served from disk rather than generated. */
  cached: number;
  /** Anything that went wrong, page by page. Never thrown. */
  errors: { pageId: string; message: string }[];
  usage?: { input: number; output: number };
}

/**
 * Which corner, in what order.
 *
 * Bottom corners first: the masthead owns the top of every page, and the
 * first motif that landed under a section heading covered it. Rotated by
 * page so a six-page book does not stack six motifs in one corner.
 */
const ANCHORS: DecorAnchor[] = ['bottom-left', 'top-right', 'bottom-right', 'top-left'];

/** Deterministic small integer from a string — the composer's trick. */
function hashOf(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

export async function decorate(
  document: CatalogDocument,
  options: DecorateOptions,
): Promise<DecorateResult> {
  const offers = new Map(document.offers.map((o) => [o.id, o]));
  const errors: DecorateResult['errors'] = [];
  const store = decorStore(options.assetRoot);

  const pages = document.pages.slice(0, options.maxPages ?? document.pages.length);
  const briefs: PageBrief[] = pages.map((page) => ({
    pageId: page.id,
    title: page.title,
    offers: page.placements
      .map((p) => offers.get(p.offerId))
      .filter((o): o is Offer => Boolean(o)),
  }));

  let chosen;
  try {
    chosen = await chooseSubjects(briefs, {
      ...(options.apiKey ? { apiKey: options.apiKey } : {}),
      ...(options.model ? { model: options.model } : {}),
      ...(options.brief ? { brief: options.brief } : {}),
      ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
    });
  } catch (error) {
    // The text step failing means nothing can be decorated — but the
    // catalogue is untouched and still prints.
    return {
      document,
      drawn: 0,
      skipped: 0,
      cached: 0,
      errors: [{ pageId: '*', message: message(error) }],
    };
  }

  const byPage = new Map(chosen.pages.map((p) => [p.pageId, p.subject]));
  const seed = options.seed ?? document.id;
  const decorated = new Map<string, PageDecoration>();
  let cached = 0;
  let skipped = 0;

  for (const [index, page] of pages.entries()) {
    const subject = byPage.get(page.id);
    if (!subject) { skipped += 1; continue; }

    const prompt = imagePrompt(subject.motif, {
      ...(options.brand ? { brandName: options.brand.name } : {}),
    });
    const at = store.pathFor(prompt);

    try {
      if (store.has(prompt)) {
        cached += 1;
      } else if (options.offline) {
        // Not an error the user needs to act on — they asked for this.
        continue;
      } else {
        const image = await generateImage(prompt, {
          ...(options.apiKey ? { apiKey: options.apiKey } : {}),
          model: options.imageModel ?? undefined,
          ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
        });
        const cut = await cutout(image.bytes, image.mimeType, {
          ...(options.browser ? { browser: options.browser } : {}),
        });
        /*
         * `kept` near 1 means the flood fill found no white field to
         * remove — the model ignored the background instruction, and
         * what we have is a photograph with corners, not a cut-out.
         * Pasting that on a coloured page looks like a mistake, so it
         * is reported and skipped rather than printed.
         */
        if (cut.kept > 0.97) {
          errors.push({
            pageId: page.id,
            message: `"${subject.subject}" kom uden hvid baggrund at skære fra — udeladt`,
          });
          continue;
        }
        store.put(prompt, cut.bytes);
      }
    } catch (error) {
      errors.push({ pageId: page.id, message: message(error) });
      continue;
    }

    const spin = hashOf(`${seed}:${page.id}`);
    decorated.set(page.id, {
      id: `decor-${at.key}`,
      imageUrl: at.ref,
      subject: subject.subject,
      offerId: subject.offerId,
      anchor: ANCHORS[index % ANCHORS.length]!,
      // 0.22–0.34 of the page width, and −8°..+8°. Varied so a book does
      // not print the same sticker four times.
      scale: 0.22 + (spin % 13) / 100,
      rotate: (spin % 17) - 8,
      opacity: 1,
    });
  }

  return {
    document: {
      ...document,
      pages: document.pages.map((page) => {
        const decor = decorated.get(page.id);
        return decor ? { ...page, decorations: [decor] } : page;
      }),
    },
    drawn: decorated.size,
    skipped,
    cached,
    errors,
    ...(chosen.usage ? { usage: chosen.usage } : {}),
  };
}

function message(error: unknown): string {
  if (error instanceof GeminiError) return error.message;
  return error instanceof Error ? error.message : String(error);
}
