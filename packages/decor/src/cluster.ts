/**
 * One photograph of several products standing together.
 *
 * The other way to fill a cell with more than one product. The
 * stylesheet's own way lays the cutouts out side by side and lets the
 * editor move each one — see `PlacementOverrides.pack`. This way hands
 * the same cutouts to an image model and asks for ONE photograph of
 * them as a group: a shared floor, one hero in front, the rest
 * overlapping at the edges, which is what a printed leaflet actually
 * prints and what no amount of CSS produces.
 *
 * What it costs is the thing the other way has: the result is a
 * picture, so the products in it can no longer be moved individually.
 * That is the whole trade, and it is why both exist.
 *
 * The prompt is the feature. Everything in it that is not about THESE
 * products is a rule about how a Danish leaflet composes a group, and
 * it is written out in full rather than summarised, because every line
 * of it is a failure somebody would otherwise have to find in a proof:
 * a redrawn label, a deodorant the size of a shower gel, a contact
 * shadow that makes the cutout impossible to place on a coloured page.
 */
import { generateImage, type GeminiOptions, type GeneratedImage } from './gemini.js';

/** One product going into the cluster, as the prompt needs to name it. */
export interface ClusterProduct {
  /** What it is called, so the prompt can say which image is which. */
  name: string;
  /** The pack size as the label states it, when the feed knows one. */
  size?: string;
}

export interface ClusterOptions {
  /**
   * Width over height of the cell the photograph will sit in.
   *
   * Asked for as an aspect ratio rather than in pixels: the page is
   * drawn in container units from a thumbnail to A4, and a picture
   * generated at the cell's own proportions is the one that needs no
   * cropping at either size.
   */
  aspect?: number;
  /**
   * The editor's own words — "flaskerne i én række", "den store bagest".
   *
   * Placed after the craft and BEFORE the background contract, exactly
   * as `imagePrompt` places its `style`: the contract gets the last
   * word, so a direction that happens to ask for a table does not
   * silently take the white field away.
   */
  note?: string;
}

/** How a product is named in the list at the top of the prompt. */
function named(product: ClusterProduct): string {
  const size = product.size?.trim();
  return size ? `${product.name.trim()} (${size})` : product.name.trim();
}

/**
 * The prompt, for any number of products.
 *
 * Pure, exported and tested, so the studio can show it: this is the one
 * place where what the page will look like is decided in words, and a
 * prompt nobody can read is a prompt nobody can fix.
 */
export function clusterPrompt(
  products: ClusterProduct[],
  options: ClusterOptions = {},
): string {
  const count = products.length;
  const list = products.map((product, index) => `image ${index + 1}: ${named(product)}`)
    .join(', ');
  const ratio = (options.aspect && options.aspect > 0 ? options.aspect : 1).toFixed(2);

  return [
    'Create a supermarket leaflet offer image from the attached product images.',
    `There are exactly ${count} images and each shows one product cutout on white:`,
    list,
    '',
    'Arrange these same products into one natural product cluster, the way a Danish leaflet'
    + ' (SuperBrugsen, Kvickly, føtex) presents an offer.',
    '',
    /*
     * The section that carries the whole feature.
     *
     * An image model gentegner pixels — it does not copy them — and
     * what it is worst at is small type: a brand name, a fat
     * percentage, a barcode. On a leaflet that is not a blemish. The
     * chain has contracted for that artwork, and a redrawn Arla logo is
     * its name on a product it did not approve. So the job is named as
     * what it actually is — a collage — before anything else is asked
     * for, and the ban is spelled out at the level of the letter.
     */
    'CRITICAL: PIXEL-PERFECT COPYING ONLY',
    'Do NOT generate, redraw, or hallucinate any parts of the products. This is a pure'
    + ' cut-and-paste collage task. Every pixel, every letter of text, every barcode, and'
    + ' every label detail from the uploaded reference images MUST be reproduced identically'
    + ' to the source. Absolutely no blurring, character alteration, or AI upscaling of the'
    + ' text is allowed.',
    '',
    'CHANGE ONLY THE ARRANGEMENT',
    'Change only the position, size and layering of the products. Everything about each'
    + ' product itself must remain completely unchanged: reproduce its shape and'
    + ' proportions, its colours, the label text and typography, logos, cap and closure'
    + ' and the camera angle exactly as in its reference image, as if the cutout had been'
    + ' copied in and only moved and scaled.',
    'Treat every label as a logo that has to come out letter for letter.',
    'Use only these exact products, each exactly once. Do not restyle, relabel or invent'
    + ' products, and do not add any other objects.',
    '',
    'NATURAL SIZES',
    'The reference images are not to scale with each other. Give each product its natural'
    + ' size relative to the others, as they would stand together on a shelf: a roll-on'
    + ' deodorant is far smaller than a 1000 ml shower gel, a 500 g bag of coffee is the'
    + ' same size as another 500 g bag, a multipack is bigger than a single can. Read the'
    + ' pack sizes from the labels where you can. Keep every product large enough that its'
    + ' label stays readable.',
    '',
    'ARRANGEMENT & COMPOSITION',
    'Form a single, cohesive, and tightly knit product cluster that is well-balanced and'
    + ' compactly composed to fit beautifully within a printed leaflet page layout. All'
    + ' products share one baseline, as if standing on the same invisible line — there is'
    + ' NO visible floor, table, shelf or surface of any kind, and NO contact shadows,'
    + ' reflections or shading under them. Choose one hero, the product the offer is named'
    + ' after or the most recognisable one, and show it a little larger than its natural'
    + ' size and in front.',
    '',
    /*
     * The overlap is the whole difference between a group and a queue,
     * and it is also the rule a model overshoots: asked to overlap, it
     * buries half the products. So the licence and its limit are stated
     * together, and the limit is named in per cent — "mostly visible"
     * is not a number anybody can hold to.
     */
    'VISIBILITY & MODERATE OVERLAP (CRITICAL FINESSE)',
    'Products MUST overlap to create a natural, layered sense of depth, but this overlap'
    + ' requires finesse:',
    '* Do NOT scatter the products apart; they must touch or overlap to form one unified'
    + ' group.',
    '* Do NOT obscure any product heavily. Every single product must remain at least 85%'
    + ' visible.',
    '* Only overlap the outer edges or blank packaging areas. The main logo, product name,'
    + ' and key text on EVERY item must remain completely unobstructed and readable.',
    '* Layer logically: place smaller/shorter items in the front row and taller/bulkier'
    + ' items in the back row so no item is swallowed up by the one in front of it.',
    '',
    'HOW LEAFLETS ARRANGE EACH KIND OF PACKAGING',
    'Multipacks of beer or soft drinks stack two to four high when they share a camera'
    + ' angle. Bottles, cans and cartons stand in one straight row on one baseline,'
    + ' touching or overlapping slightly. Bags and boxes go in two staggered rows with the'
    + ' hero front and centre. Tubs and cups form a cascade, each row a little higher and'
    + ' further back. Flat trays and packs fan out like a hand of cards. Jars and tins'
    + ' stand side by side.',
    ...(options.note?.trim() ? ['', options.note.trim()] : []),
    '',
    'BACKGROUND AND OUTPUT',
    'The background is pure white (#FFFFFF) and absolutely nothing else, edge to edge and'
    + ' into every corner. No scene, no room, no table, shelf, counter or floor. No'
    + ' gradient, vignette, tint, texture or paper. No backdrop and no horizon line. No'
    + ' cast shadow, contact shadow, reflection or glow on the background. No props, text,'
    + ' prices, badges, logos or decoration of any kind.',
    'The white must reach all four edges of the frame, so the products can be cut out of it'
    + ' and printed on a coloured page.',
    'Even, soft studio light. Photorealistic, sharp, with clean edges around every product.'
    + ` Output aspect ratio ${ratio}:1. The reference images only show what each product`
    + ' looks like; their own shapes and their order do not matter.',
  ].join('\n');
}

/** What the image model will accept as a reference picture. */
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;
/** Long enough for a slow image host, short enough not to hold a click. */
const FETCH_MS = 10_000;
/** Past this a cutout is a poster; the API has its own limit anyway. */
const MAX_BYTES = 6 * 1024 * 1024;

/**
 * The cutouts, fetched as bytes.
 *
 * As bytes and not as links, because that is the only thing that works:
 * the chains' image services sign their URLs for a browser, and every
 * model API this repo has handed one to has answered that it could not
 * download the file. It is also the honest arrangement — the server is
 * the side that already knows the chain's image hosts.
 *
 * `null` in place of a picture that would not come, so the caller can
 * see WHICH one is missing. The prompt names image N by product N, so a
 * list quietly closed up would put every label on the wrong product.
 */
export async function fetchImages(urls: (string | null)[]): Promise<(GeneratedImage | null)[]> {
  return Promise.all(urls.map((url) => {
    if (!url || !/^https?:/.test(url)) return null;
    const hit = cached(url);
    if (hit) return hit;
    const pending = download(url);
    remember(url, pending);
    return pending;
  }));
}

/* ------------------------------------------------- the cutouts, kept */

/**
 * The same cutout is asked for several times in a row.
 *
 * Standing one cluster up fetches its products twice — once for the
 * same-origin copies the studio measures against, once for the
 * composition itself — and standing a whole sheet up, then trying a
 * second arrangement of the same tile, fetches them again. Every one of
 * those is a round trip to the chain's image host, in front of a person
 * waiting, for bytes that cannot have changed.
 *
 * So: the answer is held for ten minutes, and the PROMISE is held
 * rather than the bytes, which is what makes six clusters composed at
 * once share one download of a product two of them have in common.
 * A fetch that fails is dropped again immediately — a cache is not the
 * place to remember an outage.
 */
const CACHE_MS = 10 * 60_000;
/** Far more than a page's worth; the cap is only there so it ends. */
const CACHE_MAX = 300;

const store = new Map<string, { at: number; image: Promise<GeneratedImage | null> }>();

function cached(url: string): Promise<GeneratedImage | null> | null {
  const entry = store.get(url);
  if (!entry) return null;
  if (Date.now() - entry.at > CACHE_MS) { store.delete(url); return null; }
  // Re-inserted so the oldest key really is the least recently used.
  store.delete(url);
  store.set(url, entry);
  return entry.image;
}

function remember(url: string, image: Promise<GeneratedImage | null>): void {
  store.set(url, { at: Date.now(), image });
  void image.then((value) => { if (!value) store.delete(url); }, () => store.delete(url));
  while (store.size > CACHE_MAX) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    store.delete(oldest);
  }
}

/** Drop everything. For a test, and for an editor who replaced a photo. */
export function forgetImages(): void {
  store.clear();
}

async function download(url: string): Promise<GeneratedImage | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_MS) });
    if (!response.ok) return null;
    const type = (response.headers.get('content-type') ?? '').split(';')[0]!.trim();
    if (!IMAGE_TYPES.includes(type as (typeof IMAGE_TYPES)[number])) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_BYTES) return null;
    return { bytes, mimeType: type };
  } catch {
    return null;
  }
}

/*
 * How many cutouts one photograph can hold, and whether THESE cutouts
 * are one photograph at all, live in `@incitio/schema`.
 *
 * Not here, where they were written, because the studio has to ask the
 * same question before it spends anything — and this module reaches the
 * image model, whose SDK and whose Chromium have no business in a
 * browser bundle. The rule is about offers; the schema is where facts
 * about offers live.
 */
import { MAX_CLUSTER, MIN_CLUSTER } from '@incitio/schema';

export {
  clusterFamilies, MAX_CLUSTER, MIN_CLUSTER, notOnePhotograph,
} from '@incitio/schema';

export interface ClusterRequest extends ClusterOptions {
  products: ClusterProduct[];
  /** The cutouts, in the same order the prompt names them. */
  references: GeneratedImage[];
  gemini?: GeminiOptions;
}

export interface ClusterResult extends GeneratedImage {
  /** Exactly what was asked for, so the editor can read it. */
  prompt: string;
  model: string;
}

/**
 * Compose the cutouts into one leaflet photograph.
 *
 * Throws — unlike the arrangement call, which falls back. The caller
 * has a working answer already (the cutouts side by side) and asks for
 * this one on purpose, so a silent fallback would leave somebody
 * looking at the page wondering whether the button did anything.
 */
export async function composeCluster(request: ClusterRequest): Promise<ClusterResult> {
  const { products, references } = request;
  if (products.length < MIN_CLUSTER) {
    throw new Error(`en gruppe skal have mindst ${MIN_CLUSTER} varer`);
  }
  if (products.length > MAX_CLUSTER) {
    throw new Error(`en gruppe kan højst have ${MAX_CLUSTER} varer`);
  }
  /*
   * The prompt names image N by the product's name, so a missing cutout
   * would silently shift every name onto the wrong picture. Refused
   * rather than patched up: a tile whose labels belong to other
   * products is worse than a button that says why it did nothing.
   */
  if (references.length !== products.length) {
    throw new Error(
      `${products.length} varer, men ${references.length} billeder kunne hentes`,
    );
  }

  const prompt = clusterPrompt(products, request);
  const drawn = await generateImage(prompt, request.gemini ?? {}, references);
  return { ...drawn, prompt, model: request.gemini?.model ?? '' };
}
