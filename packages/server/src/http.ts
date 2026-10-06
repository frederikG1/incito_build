import { OfferRules, withOfferGrids, type OfferDesign } from '@incitio/schema';
import { type BrandDefinition } from '@incitio/brands';
import { type LabelDictionary } from '@incitio/ingest';
import type { Browser } from 'playwright';
import { uploadStore } from './uploads.js';
import { sharedBrowser } from '@incitio/decor';
import { Store } from './db.js';
import { type PriceSource } from '@incitio/workflow';
import { type Measure } from './workflow.js';
import { type AuthMode, type User } from './auth.js';

/**
 * How a request says which chain it is acting as.
 *
 * A header rather than a path segment or a body field, because it must
 * be impossible to forget: the middleware below resolves it once, and
 * every route reads the resolved brand instead of a string from the
 * caller. When real authentication arrives it replaces this one function
 * and nothing else — the routes never learn where the brand came from.
 */
export const BRAND_HEADER = 'x-incitio-brand';

/**
 * A key for the image model, carried by the request instead of by the
 * server's environment.
 *
 * The reason it exists: a key in `.env` is a key on the machine, and
 * the person who has one is not always the person who started the
 * server — so the studio lets an editor paste theirs into the browser
 * and sends it along. It is read here, used for that one call and
 * never stored, never logged and never echoed back; `/decor/status`
 * keeps reporting the SERVER's key, because the browser already knows
 * about its own.
 *
 * `.env` still wins nothing and loses nothing: the header takes
 * precedence when it is there, and the environment answers when it is
 * not, so a deployment that sets the key centrally is unaffected.
 */
export const KEY_HEADER = 'x-gemini-key';

/**
 * The key this request should draw with, if any.
 *
 * Shape-checked rather than trusted: a Google API key is a short
 * printable token, and anything else is a header somebody sent by
 * mistake — refusing it here means it can never reach a log or a URL.
 */
export function imageKey(c: { req: { header: (name: string) => string | undefined } }): string | null {
  const sent = (c.req.header(KEY_HEADER) ?? '').trim();
  if (sent && /^[A-Za-z0-9._-]{20,200}$/.test(sent)) return sent;
  return process.env['GEMINI_API_KEY'] || null;
}

export interface Scope {
  /** `user` is who the session belongs to — null when signed out, or when sign-in is off. */
  Variables: { brand: BrandDefinition; user: User | null };
}

export interface AppOptions {
  /** Directory root-relative feed images resolve against, for PDF export. */
  assetDir?: string;
  /**
   * The certification marks, for turning a feed's label names into
   * artwork.
   *
   * Passed in rather than read here, for the same reason `assetDir` is:
   * this is a library and does not own a filesystem. `main.ts` loads the
   * shipped export and hands it over.
   *
   * Omitting it is not a neutral default, which is why it is worth
   * saying out loud. Every reader falls back to an empty dictionary, and
   * an empty dictionary resolves "Økologi" to the plain WORD "Økologi" —
   * so the Ø-mark the chain contractually expects on the page silently
   * becomes a text chip. That is exactly what the studio did until this
   * existed: the CLI passed a dictionary and the API did not, so the
   * same feed printed marks from the terminal and words from the editor.
   */
  labels?: LabelDictionary;
  /**
   * Offer designs a chain starts with before it has saved its own — read
   * from `data/designs/<brand>-cms.json`, the CMS's own export. Passed in
   * for the same reason as `labels`: this library owns no filesystem.
   */
  defaultDesigns?: Record<string, { designs: OfferDesign[]; tag: string | null; rules?: OfferRules }>;
  /**
   * The 30-day price history "før"-prices are judged by when publishing
   * and on a published avis. Defaults to the stand-in the studio shows
   * (`standInPrices`) — a chain's price file replaces it here.
   */
  prices?: PriceSource;
  /**
   * Draw and measure an avis before it is published — the print checks
   * that need the page drawn (clipped words, a price on a name). `main.ts`
   * passes the Chromium one (`measuredFindings`); tests leave it out, and
   * then only the checks the document can answer gate publishing.
   */
  measure?: Measure;
  /**
   * Whether a request must be signed in, and may only act as a chain it
   * is a member of. 'off' (the default) is the laptop: the brand header
   * alone decides, as it always has. See `auth.ts`.
   */
  auth?: AuthMode;
  /**
   * A deployment that serves real chains. Refuses to build the app with
   * Eksempeltal or with sign-in off — see `production.ts`.
   */
  production?: boolean;
}

/** The chain a Tjek offers file names on its rows, when it names one. */
export function feedDealer(text: string): string | null {
  if (!text.trimStart().startsWith('[') && !text.trimStart().startsWith('{')) return null;
  try {
    const payload = JSON.parse(text) as unknown;
    const rows = Array.isArray(payload) ? payload : [];
    for (const row of rows.slice(0, 20)) {
      const record = row as { dealer?: { name?: unknown }; branding?: { name?: unknown } };
      const name = record.dealer?.name ?? record.branding?.name;
      if (typeof name === 'string' && name.trim()) return name.trim();
    }
  } catch { /* not JSON the dealer can be read from */ }
  return null;
}

/**
 * A chain as every route draws it: its brand file, with its own offer
 * rules and offer designs folded in — its saved ones, else the ones it
 * ships with. Exported so a script that renders (the pixel diff) draws
 * exactly what the PDF route prints.
 */
export function chainBrand(
  store: Store,
  definition: BrandDefinition,
  defaultDesigns: AppOptions['defaultDesigns'] = {},
): BrandDefinition {
  const id = definition.brand.id;
  const rules = store.offerRules(id);
  const designs = store.offerDesigns(id) ?? defaultDesigns[id] ?? null;
  return {
    ...definition,
    brand: withOfferGrids({
      ...definition.brand,
      // Its own rules, else the ones its designs ship with ("uden billede → …").
      ...(rules && rules.length > 0 ? { offerRules: rules } : defaultDesigns[id]?.rules?.length
        ? { offerRules: defaultDesigns[id]!.rules! } : {}),
      ...(designs ? { offerDesigns: designs.designs, designTag: designs.tag } : {}),
    }),
  };
}




/**
 * The cutouts, re-served from this server and numbered.
 *
 * Shared by `/cluster/prepare` and by `/cluster` when it is asked for
 * copies, because the numbering is the contract: the prompt says
 * "image 1: Klovborg skæreost", so the file has to say so too, or the
 * upload order is guesswork and every label lands on the wrong
 * product. Same-origin as well as named — a canvas may not read
 * another origin's pixels, and the studio measures how much of each
 * file is product before it stands the composition up.
 */
export function copyCutouts(
  offers: { name: string }[],
  fetched: { bytes: Buffer; mimeType: string }[],
  store: ReturnType<typeof uploadStore>,
): { index: number; name: string; url: string; bytes: number }[] {
  return offers.map((offer, index) => {
    const image = fetched[index]!;
    const extension = image.mimeType.split('/')[1] ?? 'png';
    const stored = store.put(image.bytes, extension);
    return {
      index: index + 1,
      // Numbered first so a folder sorts into the prompt's own order.
      name: `${index + 1}-${offer.name.replace(/[^\p{L}\p{N} .-]/gu, '').trim().slice(0, 50)}`
        + `.${extension}`,
      url: stored.ref,
      bytes: image.bytes.length,
    };
  });
}

/**
 * Chromium for a flood fill, launched once for the whole server.
 *
 * Falls back to letting `cutout` launch its own: a browser that will
 * not start is a reason to be slow, not a reason to refuse to compose.
 */
export async function cutOptions(): Promise<{ trim: true; browser?: Browser }> {
  try {
    return { trim: true, browser: await sharedBrowser() };
  } catch {
    return { trim: true };
  }
}
