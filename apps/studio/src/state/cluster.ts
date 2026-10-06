import type { Brand, CatalogDocument, Offer, PageTemplate, PackOverride, PlacementOverrides } from '@incitio/schema';
import { CatalogPage, packOverride } from '@incitio/schema';
import { notOnePhotograph, readPackSize } from '@incitio/schema';
import * as api from '../api.js';
import { PACK_LIMITS, planCluster, type Complaint, type GhostFrame, type MeasuredProduct, type PackPatch, type PlacedProduct } from '../cluster-layout.js';
import { inkOf, WHOLE, type InkBox } from '../ink.js';
import { type PlacePromptId } from '@incitio/curator/place-prompt';

export const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * The chain, carrying layouts that are not part of its vocabulary.
 *
 * A page rebuilt from a reference sits on a grid nobody drew for the
 * chain. It travels inside the document — which is what makes it
 * survive a save and a print — but the editor's own template lookups
 * (`resolveTemplate`, reseating, the layout picker) go through the
 * brand, so the brand it renders with has to know about them too.
 *
 * First wins, so a run's own layouts resolve before the chain's.
 */
/**
 * A variant cut out of, or taken from, one offer's pictures so the tile
 * can be stood up — see `splitAndStandUp`. It is part of that offer's
 * artwork, never a product of its own: it has no page, no reserve and no
 * place in the list.
 */
export function isVariantPiece(offerId: string): boolean {
  return /~v\d+$/.test(offerId);
}

/** A page made from a publication's picture — see `pagedPage` in `@incitio/publication`. */
export function isPicturePage(page: CatalogPage): boolean {
  return Boolean(page.incito && (page.incito.view as Record<string, unknown>)['paged']);
}

/** How many cells the document's picture pages were given. */
export function cellCount(document: CatalogDocument): number {
  return document.pages.filter(isPicturePage)
    .reduce((sum, page) => sum + (document.templates.find((t) => t.id === page.templateId)?.slots.length ?? 0), 0);
}

export function withTemplates(brand: Brand, templates: PageTemplate[]): Brand {
  const all = new Map<string, PageTemplate>();
  for (const template of [...templates, ...brand.templates]) {
    if (!all.has(template.id)) all.set(template.id, template);
  }
  return { ...brand, templates: [...all.values()] };
}

/**
 * Bytes as base64, in chunks.
 *
 * `btoa(String.fromCharCode(...bytes))` is the one-liner and it throws
 * on anything bigger than the argument limit — which a 4 MB page scan
 * comfortably is. 32k at a time is well under it and costs nothing.
 */
export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return window.btoa(binary);
}

/**
 * Wait until an uploaded picture can actually be fetched back.
 *
 * The file is on the server's disk the moment the reply lands —
 * `writeFileSync` returns before the route does — but it reaches the
 * EDITOR through the dev server's static root, and that tree needs a
 * beat to notice a path it has never served. Measured: the request made
 * immediately after the upload 404s and the same URL is fine a moment
 * later.
 *
 * Retried rather than failed, because the file is genuinely there; and
 * probed at all rather than trusted, because an `<img>` that fails once
 * never retries a `src` it has already failed. Without this the page
 * keeps a picture that is permanently a broken box on screen — while
 * the PDF, which reads the same file off disk, prints it perfectly. A
 * defect that exists only in the editor is the worst kind to chase.
 *
 * The cache-buster is what makes the retry mean anything: a browser
 * that has just cached a 404 for this exact URL would otherwise answer
 * every later attempt from that cache.
 */
export async function reachable(url: string): Promise<boolean> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const ok = await new Promise<boolean>((resolve) => {
      const probe = new Image();
      probe.onload = () => resolve(true);
      probe.onerror = () => resolve(false);
      probe.src = attempt === 0 ? url : `${url}?t=${Date.now()}`;
    });
    if (ok) return true;
    await new Promise((wait) => { setTimeout(wait, 150 * (attempt + 1)); });
  }
  return false;
}

/** The degrees in a CSS `rotate` property — "6deg", or "none". */
export function spin(value: string): number {
  const match = /(-?[\d.]+)deg/.exec(value);
  return match ? Number.parseFloat(match[1]!) : 0;
}

/**
 * One product of a cluster as it is actually DRAWN, not as its box.
 *
 * The distinction is the whole point. Every product in a cluster is an
 * `img` filling its own track with `object-fit: contain`, so its
 * element is as wide as the track and the artwork inside it is
 * letterboxed — a tall bottle in a wide track draws at a fraction of
 * its element's width. Measuring the element and calling that the
 * product is how a composition read off a picture came back with the
 * tall things tiny.
 *
 * The centre needs no such care: the axis-aligned box the browser
 * reports for a transformed rectangle is centred on that rectangle's
 * own centre, whatever turned it and around which point — and `contain`
 * centres the artwork in the element.
 */
export function measurePack(
  node: Element | null,
  already: PackOverride,
  /** Where the product sits inside its own picture — see `inkOf`. */
  ink: InkBox,
): MeasuredProduct | null {
  if (!(node instanceof HTMLImageElement)) return null;
  if (node.naturalWidth === 0 || node.naturalHeight === 0) return null;
  const aspect = node.naturalWidth / node.naturalHeight;

  const rect = node.getBoundingClientRect();
  if (rect.width === 0 || node.offsetWidth === 0) return null;

  /*
   * The arrangement's own transform AND the corrections, which are
   * written as the individual `scale`/`rotate` properties precisely so
   * they compose with it — see `OfferTile`. Both have to be read, and
   * the layout size has to come from `offsetWidth`, because a rotated
   * element's reported box is bigger than the element.
   */
  const style = window.getComputedStyle(node);
  const matrix = new DOMMatrixReadOnly(style.transform === 'none' ? '' : style.transform);
  const own = style.scale === 'none' ? 1 : (Number.parseFloat(style.scale) || 1);
  const drawn = Math.min(
    node.offsetWidth * Math.hypot(matrix.a, matrix.b) * own,
    node.offsetHeight * Math.hypot(matrix.c, matrix.d) * own * aspect,
  );
  if (drawn <= 0 || ink.width <= 0 || ink.height <= 0) return null;

  /*
   * The PRODUCT, not the picture it came in.
   *
   * The model measures the pack; this has to measure the same thing or
   * the two are not comparable — see `ink.ts`. Both the size and the
   * centre move: a product sitting off-centre in its own file is off
   * its element's centre by the same fraction, at whatever size the
   * page happens to draw it.
   */
  const height = drawn / aspect;
  const driftX = (ink.left + ink.width / 2 - 0.5) * drawn;
  const driftY = (ink.top + ink.height / 2 - 0.5) * height;
  return {
    cx: rect.left + rect.width / 2 + driftX,
    cy: rect.top + rect.height / 2 + driftY,
    width: drawn * ink.width,
    driftX,
    driftY,
    rotate: (Math.atan2(matrix.b, matrix.a) * 180) / Math.PI + spin(style.rotate),
    // The product's own proportions, which is what decides how tall a
    // box the composition needs for it.
    aspect: (aspect * ink.width) / ink.height,
    already,
  };
}

/**
 * The uploaded picture's proportions.
 *
 * Read from the file, never assumed: the composition prompt ASKS for
 * the cell's aspect ratio and the image model answers with whatever it
 * renders. 1 on anything unreadable, which is the shape it usually is.
 */
export async function pictureAspect(file: File): Promise<number> {
  try {
    const bitmap = await createImageBitmap(file);
    const aspect = bitmap.width / bitmap.height;
    bitmap.close();
    return Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  } catch {
    return 1;
  }
}

/**
 * A cutout's own proportions — the PRODUCT's, not the file's.
 *
 * A packshot arrives in a frame with margin around it, and the frame
 * is not the product: a bottle in a square JPEG would report 1:1 and
 * be placed as wide as it is tall. `inkOf` has already scanned where
 * the ink actually is, for the placement arithmetic, and this is the
 * same scan read for a different number.
 */
export async function cutoutAspect(url: string): Promise<number> {
  const [ink, frame] = await Promise.all([inkOf(url), frameAspect(url)]);
  const aspect = frame * (ink.width / ink.height);
  return Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
}

/** The file's own width over height. */
export async function frameAspect(url: string): Promise<number> {
  return new Promise((done) => {
    const probe = new Image();
    probe.onload = () => done(
      probe.naturalHeight > 0 ? probe.naturalWidth / probe.naturalHeight : 1,
    );
    probe.onerror = () => done(1);
    probe.src = url;
  });
}

/**
 * The products behind a cluster's pictures, in the pack's own order.
 *
 * The pack is not the member list. `groupOffers` deduplicates the
 * pictures — two variants of one product very often carry the same
 * photograph — and drops members that have none, so `imagePack[2]` is
 * not reliably `members[2]`. Everything that reads a composition
 * addresses products by their place in the PACK (`data-pack="2"` is a
 * picture, not a member), so the list handed to a model has to be the
 * pack's, or product three's position gets applied to product four's
 * cutout and the tile comes out scrambled with no error anywhere.
 */
export function packMembers(offer: Offer, document: CatalogDocument): Offer[] {
  const members = offer.members
    .map((id) => document.offers.find((entry) => entry.id === id))
    .filter((entry): entry is Offer => Boolean(entry));
  if (offer.imagePack.length === 0) return members;
  return offer.imagePack.map((url, index) => (
    members.find((member) => member.imageUrl === url) ?? members[index] ?? members[0]!
  ));
}

/**
 * A composed picture, laid over the cluster it was read from.
 *
 * Here and not in the document, deliberately. It is a PROOF, not a
 * layer of the page: it must never print, never be saved and never
 * survive a reload — and a person looking at it has to be able to
 * answer "did it use my picture?" without reading a number.
 */
export interface Ghost {
  offerId: string;
  url: string;
  /** The picture's rectangle, in fractions of the artwork box. */
  left: number;
  top: number;
  width: number;
  height: number;
  /** Whether it is being drawn. Kept when hidden, so it can come back. */
  shown: boolean;
  /** What the arithmetic did, line by line — see `standUpCluster`. */
  report: string[];
}

/** What one picture does to one tile, before anything is written down. */
export interface StoodUp {
  offerId: string;
  patches: Map<number, PackPatch>;
  frame: GhostFrame | null;
  report: string[];
  /** Products of this tile the picture did not hold. */
  missing: number;
  /** What is wrong with the arrangement — see `reviewCluster`. */
  complaints: Complaint[];
}

/**
 * One composition, applied to one cluster — as arithmetic.
 *
 * Everything from the page's own geometry to the corrections, and
 * nothing written anywhere: the store decides what to do with it. That
 * separation is what lets a whole page be stood up in one go — the same
 * routine runs per tile and the results are written together, so a
 * sheet of six clusters is one undo step and not six.
 */
export async function standUpCluster(args: {
  offerId: string;
  members: Offer[];
  overrides: PlacementOverrides;
  /** The same-origin copies of the cutouts, by their 1-based place. */
  copies: { index: number; url: string }[];
  /** What the model read, numbered within THIS tile's pack. */
  placed: PlacedProduct[];
  /** The picture's own proportions, width over height. */
  picture: number;
}): Promise<StoodUp | { error: string }> {
  const { offerId, members, overrides, placed } = args;

  /*
   * First the cutouts' own margins.
   *
   * Read from the copies `prepareCluster` put on this server rather
   * than from the chain's image host, because a canvas may not read
   * another origin's pixels — see `inkOf`. Awaited before the page is
   * measured, not after: everything below has to describe one layout.
   */
  const inks = await Promise.all(members.map((_, index) => {
    const copy = args.copies.find((entry) => entry.index === index + 1);
    return copy ? inkOf(copy.url) : Promise.resolve(WHOLE);
  }));

  /*
   * Measured on the PAGE.
   *
   * The composition comes back as fractions of a picture, and to turn
   * those into a move for a real cutout we need to know where that
   * cutout is now — which only the browser knows, because it is the
   * browser that laid the cluster out.
   */
  const tile = window.document.querySelector(`[data-offer-id="${CSS.escape(offerId)}"]`);
  const media = tile?.querySelector('.tile__media, .dtile__pack')?.getBoundingClientRect();
  const page = tile?.closest('.page')?.getBoundingClientRect();
  if (!media || !page || media.width === 0 || page.width === 0) {
    return { error: `${tileName(members)}: flisen skal være synlig på siden` };
  }

  const now = members.map((_, index) => measurePack(
    tile?.querySelector(`[data-pack="${index}"]`) ?? null,
    packOverride(overrides, index),
    inks[index] ?? WHOLE,
  ));

  /*
   * What each pack says it holds, for the review below — never for the
   * placement. See `readPackSize`: the feed's own field is empty in
   * every SuperBrugsen offer, and the sentence carries the number.
   */
  const sizes = members.map((member) => {
    const said = readPackSize(member.description ?? '') ?? readPackSize(member.name ?? '');
    return said ? said.value : null;
  });

  const { patches, frame, complaints } = planCluster({
    media, page, picture: args.picture, placed, measured: now, sizes,
  });

  /*
   * The whole calculation, in words.
   *
   * Cheap to build and the only thing that can settle a tile that comes
   * out wrong: the numbers are the difference between "it ignored my
   * picture" and "product three was measured in the wrong place".
   */
  const report = [
    `felt ${media.width.toFixed(0)}×${media.height.toFixed(0)}`
    + ` · side ${page.width.toFixed(0)}×${page.height.toFixed(0)}`
    + ` · billede ${args.picture.toFixed(2)}:1`
    + ` · ${members.length} varer, ${now.filter(Boolean).length} målt`
    + `${frame ? '' : ' · ingen ramme'}`,
    ...members.map((member, index) => {
      const stands = now[index];
      const read = placed.find((product) => product.index - 1 === index);
      const patch = patches.get(index);
      const name = `${index}. ${(member.brand ? `${member.brand} ` : '') + member.name}`
        .slice(0, 44);
      if (!stands) return `${name}: ingen billedkasse på siden — sprunget over`;
      const margin = inks[index] ?? WHOLE;
      const at = `står ${((stands.cx - media.left) / media.width).toFixed(2)}`
        + `/${((stands.cy - media.top) / media.height).toFixed(2)}`
        + ` b${(stands.width / media.width).toFixed(2)}`
        + (margin.width < 0.97 || margin.height < 0.97
          ? ` (udklip ${Math.round(margin.width * 100)}% fyldt)` : '');
      if (!read) return `${name}: ${at} · ikke fundet i billedet`;
      if (!patch) return `${name}: ${at} · læst ${read.cx.toFixed(2)} men ingen rettelse`;
      const limit = [
        Math.abs(patch.offsetX) >= PACK_LIMITS.offset
          || Math.abs(patch.offsetY) >= PACK_LIMITS.offset ? 'FLYT-GRÆNSE' : '',
        patch.scale <= PACK_LIMITS.minScale
          || patch.scale >= PACK_LIMITS.maxScale ? 'SKALA-GRÆNSE' : '',
      ].filter(Boolean).join(' ');
      return `${name}: ${at} · læst ${read.cx.toFixed(2)}/${read.cy.toFixed(2)}`
        + ` b${read.width.toFixed(2)} ↓${(read.bottom ?? 0).toFixed(3)}`
        + ` · retter ${patch.offsetX.toFixed(1)}`
        + `/${patch.offsetY.toFixed(1)}% ×${patch.scale.toFixed(2)}${limit ? ` · ${limit}` : ''}`;
    }),
  ];

  /*
   * The review, in the same words the panel shows. It corrects nothing
   * — a composition an editor asked for is theirs — but a tool that
   * cannot say "this one covers half of that one" is a tool nobody can
   * trust to run unattended.
   */
  if (complaints.length > 0) {
    report.push(...complaints.map((entry) => (entry.index === null
      ? `⚠ ${entry.said}`
      : `⚠ ${entry.index}. ${(members[entry.index]?.name ?? '').slice(0, 30)}: ${entry.said}`)));
  }

  return {
    offerId,
    patches,
    frame,
    report,
    missing: members.length - patches.size,
    complaints,
  };
}

/**
 * The products of one cluster, back to front.
 *
 * Read off what the arrangement actually did rather than off the
 * model's prose: a product standing lower on the page stands in
 * front, which is how a printed group reads and how `planCluster`
 * stacks them. Hidden ones are left out — they are not in the
 * photograph at all.
 */
export function backToFront(stood: StoodUp, members: Offer[]): string[] {
  return [...stood.patches.entries()]
    .sort((a, b) => a[1].offsetY - b[1].offsetY)
    .map(([index]) => members[index]?.name ?? `vare ${index + 1}`);
}

/** What to call a cluster on screen: its products, not its id. */
export function tileName(members: Offer[]): string {
  return members.map((member) => member.name.split(/[,(]/)[0]!.trim()).join(' · ').slice(0, 60);
}

/** Write one tile's corrections into the document. */
export function withPatches(
  document: CatalogDocument,
  stood: StoodUp[],
): CatalogDocument {
  const byOffer = new Map(stood.map((entry) => [entry.offerId, entry.patches]));
  return {
    ...document,
    pages: document.pages.map((page) => ({
      ...page,
      placements: page.placements.map((placement) => {
        const patches = byOffer.get(placement.offerId);
        if (!patches) return placement;
        return {
          ...placement,
          overrides: {
            ...placement.overrides,
            pack: [...patches.entries()].reduce(
              (all, [index, patch]) => ({
                ...all,
                [String(index)]: { ...packOverride(placement.overrides, index), ...patch },
              }),
              placement.overrides.pack,
            ),
          },
        };
      }),
    })),
  };
}

/**
 * The picture itself, kept where it can be SEEN.
 *
 * Stored on the server only so the tile has a URL to draw — it never
 * enters the document, so it cannot print and cannot be saved. Uncut:
 * the white field is what `mix-blend-mode: multiply` disappears, and a
 * keyed-out one would hide the very edges being compared. A failed
 * upload costs the proof and not the placement, which has already
 * happened.
 */
export async function keepGhost(
  brandId: string,
  stood: StoodUp,
  bytes: Uint8Array,
  name: string,
): Promise<Ghost | null> {
  if (!stood.frame) return null;
  try {
    const { url } = await api.uploadImage(brandId, toBase64(bytes), name);
    return {
      offerId: stood.offerId,
      url,
      ...stood.frame,
      shown: true,
      report: stood.report,
    };
  } catch {
    return null;
  }
}

/** One ghost per tile: a second picture of the same cluster replaces it. */
export function withGhost(list: Ghost[], ghost: Ghost | null): Ghost[] {
  if (!ghost) return list;
  return [...list.filter((entry) => entry.offerId !== ghost.offerId), ghost];
}

/**
 * The tiles on one sheet that can be ONE photograph each, and why the
 * others cannot.
 *
 * Asked before anything is fetched or paid for. A tile holding washing
 * powder, frozen croquettes and rye bread is three offers that share a
 * price, and handing that list to an image model buys a picture of a
 * scene nobody would print — see `notOnePhotograph`. The skipped ones
 * are named, with their reason, because "del flisen op" is something an
 * editor can act on and "skipped" is not.
 */
export function pagePhotographs(
  page: CatalogPage,
  document: CatalogDocument,
): { clusters: { offer: Offer; members: Offer[] }[]; skipped: string[] } {
  const clusters: { offer: Offer; members: Offer[] }[] = [];
  const skipped: string[] = [];
  for (const placement of page.placements) {
    const offer = document.offers.find((entry) => entry.id === placement.offerId);
    if (!offer || offer.members.length < 2) continue;
    const members = packMembers(offer, document);
    const why = notOnePhotograph(members);
    if (why) skipped.push(`${tileName(members)}: ${why}`);
    else clusters.push({ offer, members });
  }
  return { clusters, skipped };
}

/**
 * How many clusters are composed at the same time.
 *
 * Every cluster is an image-model call of half a minute or more, and
 * they have nothing to say to each other — so a sheet of six is six
 * minutes done one at a time and about a minute and a half done four
 * at a time. Four and not sixteen because each one is also a paid call
 * against a per-minute quota, and a whole book fired off in one breath
 * is how a 429 is met. Raise it when the key's quota allows.
 */
export const CLUSTER_AT_ONCE = Number(
  (typeof localStorage !== 'undefined' && localStorage.getItem('incitio.clusterAtOnce')) || 4,
) || 4;

/** The two ways a cluster can be stood up — see `clusterWay`. */
export type ClusterWay = 'koordinater' | 'rundtur';

/** Remembered across reloads: it is a standing preference, not a step. */
export const WAY_KEY = 'incitio.clusterWay';
export const IMAGE_MODEL_KEY = 'incitio.clusterImageModel';
export const PLACE_MODEL_KEY = 'incitio.clusterPlaceModel';
/** Whether a run may be answered by a model nobody asked for. */
export const STRICT_KEY = 'incitio.placeStrict';
export const PROMPT_KEY = 'incitio.clusterPrompt';
/** Which standing prompt is chosen. A preference, so it is remembered. */
export const PROMPT_ID_KEY = 'incitio.clusterPromptId';
/** Whether the checklist is open. A habit, so it survives a reload. */
export const CHECKS_KEY = 'incitio.checks.open';

export function remembered<T extends string>(key: string, fallback: T): T {
  try {
    return (window.localStorage.getItem(key) as T | null) ?? fallback;
  } catch {
    return fallback;
  }
}

export function remember(key: string, value: string): void {
  try {
    if (value) window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);
  } catch { /* private browsing; it holds for this session */ }
}

/**
 * What one run of the cluster machinery did.
 *
 * Reported rather than summarised: which way it went, which model
 * answered, how long it took, how many products it actually placed and
 * in which order they stand. Everything here is measured — nothing is
 * an estimate dressed up as a fact, and there is no price, because the
 * only honest price is the one on the bill.
 */
export interface ClusterRun {
  way: ClusterWay;
  /** The model that decided the arrangement. */
  model: string;
  /** The one that was asked for, when it was busy and another answered. */
  insteadOf: string | null;
  /** The image model, when one drew. */
  drawnBy: string | null;
  elapsedMs: number;
  tokens: number | null;
  /**
   * The two halves, kept apart.
   *
   * A price needs them: reading six cutouts is input and forty
   * numbers is output, and the two are charged at rates an order of
   * magnitude apart — so a single total cannot be turned back into
   * kroner. `tokens` stays because it is what the line says when
   * nobody cares about the money.
   */
  inputTokens: number;
  outputTokens: number;
  /** Products placed, out of how many the tile holds. */
  placed: number;
  of: number;
  /** Back to front, as they now stand. */
  order: string[];
  /** What the review complained about, if anything. */
  complaints: string[];
  /**
   * Whether the group was stood on a floor or laid out flat.
   *
   * The placing call chooses it from how the cutouts were
   * photographed — see `PLACE_SYSTEM` — and it is the one decision in
   * the answer that is not a number, so it is worth showing.
   */
  view: 'side' | 'top' | null;
}

/**
 * One run, kept so the next one can be compared with it.
 *
 * The prompt is the feature, and a prompt is improved by changing a
 * line and looking — which only works if you can still see what the
 * line before it produced. Everything here is what the panel already
 * showed and then threw away: the words that were sent, the model
 * that answered and how much of the tile it actually placed.
 *
 * The prompt is stored in full. It is a few thousand characters and
 * five of them fit in the browser's storage many times over; keeping
 * a hash would save nothing and give back nothing to restore.
 */
export interface PromptRun {
  at: string;
  /** What the tile was called, so a list of runs can be read. */
  tile: string;
  /** '' when a standing prompt was used — `promptId` says which. */
  prompt: string;
  /**
   * Which shipped prompt the run used.
   *
   * Optional, because runs kept in this browser from before there was
   * more than one carry no answer, and inventing one for them would
   * be a claim about a run nobody can check.
   */
  promptId?: PlacePromptId;
  model: string;
  elapsedMs: number;
  placed: number;
  of: number;
}

/** How many are kept. Five is two afternoons of iterating. */
export const PROMPT_RUNS = 5;
export const RUNS_KEY = 'incitio.promptRuns';

export function rememberedRuns(): PromptRun[] {
  try {
    const raw = window.localStorage.getItem(RUNS_KEY);
    const said = raw ? JSON.parse(raw) as unknown : null;
    return Array.isArray(said) ? said.slice(0, PROMPT_RUNS) as PromptRun[] : [];
  } catch {
    return [];
  }
}
