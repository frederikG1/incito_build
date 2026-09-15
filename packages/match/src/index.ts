/**
 * Rebuild a published page with this week's products.
 *
 * Hand it one page — a photograph, a screenshot, a page of a PDF — and
 * a feed, and it returns that page's layout carrying the feed's offers.
 *
 * This is deliberately NOT `derive:templates`. That one reads a book to
 * build a chain's vocabulary and then fills the shapes generically,
 * which is why its pages still do not look much like the chain's. Here
 * the reference IS the design brief: the model sees the page and the
 * offers together, and says which offer belongs in which cell and why.
 * Everything that can be measured rather than asked for — the page's
 * ground colour — is measured.
 *
 * The three stages are the three imports below, in order:
 *   1. the reference becomes an image and a measured ground  (page-image)
 *   2. the feed becomes Offers through the chain's own reader (@incitio/ingest)
 *   3. the model casts those offers into the page's grid      (prompt)
 * and what comes out is an ordinary `CatalogDocument`, which the
 * existing renderer, editor and PDF path already know how to handle.
 *
 * A library, not a script: the CLI (`npm run match`) and the HTTP API
 * (`POST /api/brand/reproduce`) both call this one function, so the
 * studio and the terminal cannot drift into two different notions of
 * what rebuilding a page means.
 *
 * Several references make several pages — see `matchPages` at the
 * bottom. A whole catalogue is now a stack of printed pages handed in,
 * not a brief handed to a planner.
 */
import Anthropic from '@anthropic-ai/sdk';
import { jsonSchemaOutputFormat } from '@anthropic-ai/sdk/helpers/json-schema';
import { chromium, type Browser } from 'playwright';
import {
  Brand, CatalogDocument, PageTemplate, mergeCatalogDocuments, validateTemplate,
  type Offer,
} from '@incitio/schema';
import {
  findSource, getBrand, resolveSource,
  type BrandDefinition, type FeedSource,
} from '@incitio/brands';
import { ingestCsv, ingestJson, type LabelDictionary } from '@incitio/ingest';
import { matchSystemPrompt, MATCH_SCHEMA, type MatchPlan } from './prompt.js';
import { pageImage, sampleGround, type ImageMediaType } from './page-image.js';

export * from './prompt.js';
export * from './page-image.js';

export interface MatchOptions {
  /** The reference: an image, or a PDF to take one page out of. */
  file: Buffer;
  /** Which page of a PDF. Ignored for an image. */
  pageNumber?: number;
  /** This week's feed, as the chain publishes it. */
  feedText: string;
  /** Force one of the chain's readers instead of matching the file. */
  sourceId?: string;
  /** A steer from the editor, followed unless it breaks the page. */
  note?: string;
  /**
   * Offers already printed on another page of the same run.
   *
   * Taken out of the pool BEFORE it is cut to `poolSize`, so page four
   * chooses from four pages' worth of unused feed rather than from the
   * leftovers of page one's sixty. This is what stops the same coffee
   * leading three spreads when several references are rebuilt together.
   */
  exclude?: string[];
  /** How many offers the model gets to choose between. */
  poolSize?: number;
  model?: string;
  /** Certification marks. Omit and labels render as plain text. */
  labels?: LabelDictionary;
  /** Reuse a browser. One is launched and closed if absent. */
  browser?: Browser;
  catalogId?: string;
  /** Shown as the document's name and in the template's own name. */
  referenceName?: string;
}

export interface MatchResult {
  document: CatalogDocument;
  /** The chain, carrying the one layout this page needs. Render with it. */
  brand: Brand;
  template: PageTemplate;
  /** The page's field, measured in the reference's margins. */
  ground: string;
  /** What the model chose, and why, slot by slot. Kept for the editor. */
  casting: { slotId: string; offerId: string; role: string; why: string }[];
  /** Which reader ran, and what it matched on. */
  source: { id: string; name: string; reason: string };
  /** The reference as the model saw it, for showing side by side. */
  reference: { image: Buffer; type: ImageMediaType };
  offersInFeed: number;
  poolSize: number;
  /** Slots the model filled with an id the feed does not have. */
  rejected: number;
  usage: { inputTokens: number; outputTokens: number };
  elapsedMs: number;
}

/** A slot id the schema will accept, whatever the model called it. */
function ident(raw: string, index: number): string {
  const cleaned = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
  return /^[a-z]/.test(cleaned) ? cleaned : `s${index}`;
}

/** One line per offer: everything the model needs to cast it, nothing else. */
function summarise(offer: Offer): string {
  return [
    offer.id,
    offer.brand ? `${offer.brand} ${offer.name}` : offer.name,
    `${offer.price} ${offer.currency}`,
    offer.prePrice ? `was ${offer.prePrice}` : '',
    offer.category,
    offer.description.slice(0, 90),
    offer.imagePack.length > 1 ? `${offer.imagePack.length} variants` : '',
  ].filter(Boolean).join(' | ');
}

export class MatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MatchError';
  }
}

export async function matchPage(
  brandId: string,
  options: MatchOptions,
): Promise<MatchResult> {
  if (!process.env['ANTHROPIC_API_KEY']) {
    throw new MatchError('ANTHROPIC_API_KEY er ikke sat på serveren');
  }
  const definition: BrandDefinition = getBrand(brandId);

  /* ------------------------------------------------ 1. the reference */

  const browser = options.browser ?? (await chromium.launch());
  let reference: { image: Buffer; type: ImageMediaType };
  let ground: string;
  try {
    reference = await pageImage(browser, options.file, options.pageNumber ?? 1);
    ground = await sampleGround(browser, reference.image, reference.type);
  } catch (error) {
    if (!options.browser) await browser.close();
    throw error instanceof MatchError
      ? error
      : new MatchError(error instanceof Error ? error.message : 'kunne ikke læse referencen');
  }

  try {
    /* ------------------------------------------------------ 2. the feed */

    if (!options.feedText.trim()) {
      // The library owns no filesystem, so there is no chain default to
      // fall back to here — the caller supplies the week's file. Said
      // plainly, because "Unexpected end of JSON input" out of the
      // parser is not something an editor can act on.
      throw new MatchError('der er ikke indlæst noget feed — upload denne uges fil først');
    }

    let source: FeedSource;
    let reason: string;
    if (options.sourceId) {
      const named = findSource(definition, options.sourceId);
      if (!named) {
        throw new MatchError(
          `${definition.brand.name} har ingen kilde "${options.sourceId}". `
          + `Kendte: ${definition.sources.map((s) => s.id).join(', ')}`,
        );
      }
      source = named;
      reason = `valgt manuelt: ${named.name}`;
    } else {
      const match = resolveSource(definition, options.feedText);
      if (!match.source) throw new MatchError(match.reason);
      source = match.source;
      reason = match.reason;
    }

    const { feed } = source.format === 'csv'
      ? ingestCsv(options.feedText, source.mapping, options.labels)
      : ingestJson(options.feedText, source.mapping, options.labels);

    // Only offers with artwork can stand in for a product on a printed page.
    const spent = new Set(options.exclude ?? []);
    const available = feed.offers.filter((o) => o.imageUrl && !spent.has(o.id));
    const pool = available.slice(0, Math.max(4, options.poolSize ?? 60));
    if (pool.length === 0) {
      throw new MatchError(spent.size > 0
        ? 'feedet har ikke flere ubrugte tilbud med billede — færre sider, eller et større feed'
        : 'feedet indeholder ingen tilbud med billede');
    }

    /* ----------------------------------------------------- 3. the model */

    const client = new Anthropic();
    const started = Date.now();
    const stream = client.messages.stream({
      model: options.model ?? 'claude-opus-5',
      max_tokens: 32000,
      system: matchSystemPrompt(definition.brand.language),
      thinking: { type: 'adaptive' },
      output_config: { format: jsonSchemaOutputFormat(MATCH_SCHEMA), effort: 'high' },
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: `A published ${definition.brand.name} page:` },
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: reference.type,
              data: reference.image.toString('base64'),
            },
          },
          {
            type: 'text',
            text: [
              `Rebuild this page with these ${pool.length} offers.`,
              'Each line is: id | name | price | previous price | category | fine print | variants',
              '',
              pool.map(summarise).join('\n'),
              ...(options.note
                ? ['', `Direction from the editor — follow it unless it breaks the page: ${options.note}`]
                : []),
            ].join('\n'),
          },
        ],
      }],
    });

    const response = await stream.finalMessage();
    const elapsedMs = Date.now() - started;
    if (!response.parsed_output) {
      throw new MatchError('modellen returnerede intet læsbart');
    }
    const plan = response.parsed_output as MatchPlan;
    if (plan.slots.length === 0 || plan.areas.length === 0) {
      throw new MatchError(
        'modellen kunne ikke se en tilbudsavis-side i billedet — prøv et tydeligere opslag',
      );
    }

    /* ------------------------------------------------------ validate it */

    /*
     * Slot ids are rewritten to something CSS can name before anything
     * is parsed. The schema demands a grid-area ident and the model is
     * asked for one, but "top-left" costs a 500 on an upload rather
     * than a rebuilt page, and the id is private to this template —
     * nothing outside it means anything by the name.
     */
    const renamed = new Map<string, string>();
    plan.slots.forEach((slot, index) => {
      if (!renamed.has(slot.id)) renamed.set(slot.id, ident(slot.id, index));
    });

    const byId = new Map(pool.map((o) => [o.id, o]));
    const used = new Set<string>();
    const kept = plan.slots.filter((s) => {
      // An invented or repeated id would render an empty cell, which
      // reads as a broken page rather than as a missing product.
      if (!byId.has(s.offerId) || used.has(s.offerId)) return false;
      used.add(s.offerId);
      return true;
    });
    if (kept.length === 0) {
      throw new MatchError('modellen brugte ingen af feedets varer — prøv igen');
    }

    const live = new Set(kept.map((s) => renamed.get(s.id)!));
    const stamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
    const label = options.referenceName ?? 'reference';

    const template = PageTemplate.parse({
      id: `${brandId}/match-${stamp}`,
      name: `Efter ${label}`,
      // A dropped slot must leave the grid too, or `validateTemplate`
      // sees a cell naming nothing and the whole page is refused.
      areas: plan.areas.map((row) => row.trim().replace(/\s+/g, ' ').split(' ')
        .map((cell) => {
          const id = renamed.get(cell);
          return id && live.has(id) ? id : '.';
        })
        .join(' ')),
      slots: kept.map((s) => ({
        id: renamed.get(s.id)!,
        role: s.role,
        bleed: Math.min(1.6, Math.max(1, (s.bleedPercent ?? 100) / 100)),
      })),
    });

    const problems = validateTemplate(template);
    if (problems.length > 0) {
      throw new MatchError(`modellens gitter holder ikke: ${problems.join('; ')}`);
    }

    /* ---------------------------------------------------- the document */

    /*
     * The layout travels WITH the document rather than being added to
     * the chain's set. A template read off one reference page is not
     * part of the chain's vocabulary — nobody drew it, and it would be
     * offered in the layout picker on every unrelated page. The brand
     * returned here carries it for as long as this document is open;
     * `document.templates` is what makes it survive a save and a print.
     */
    const brand = brandWithTemplates(definition.brand, [template]);

    const now = new Date().toISOString();
    const document = CatalogDocument.parse({
      id: options.catalogId ?? `${brandId}-match`,
      schemaVersion: 2,
      name: `${definition.brand.name} efter ${label}`,
      brandId,
      templates: [template],
      pages: [{
        id: 'page-1',
        templateId: template.id,
        title: plan.heading,
        subtitle: plan.subtitle?.trim() ?? '',
        rationale: `bygget efter ${label}`,
        // Measured, not chosen: see `sampleGround`.
        ground,
        placements: kept.map((s) => ({
          offerId: s.offerId,
          slotId: renamed.get(s.id)!,
          overrides: {},
        })),
      }],
      offers: kept.map((s) => byId.get(s.offerId)!),
      createdAt: now,
      updatedAt: now,
    });

    return {
      document,
      brand,
      template,
      ground,
      casting: kept.map((s) => ({
        slotId: renamed.get(s.id)!,
        offerId: s.offerId,
        role: s.role,
        why: s.why,
      })),
      source: { id: source.id, name: source.name, reason },
      reference,
      offersInFeed: feed.offers.length,
      poolSize: pool.length,
      rejected: plan.slots.length - kept.length,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
      elapsedMs,
    };
  } finally {
    if (!options.browser) await browser.close();
  }
}

/**
 * The chain, plus layouts that are not part of its vocabulary.
 *
 * Re-parsed through `Brand` so nothing the schema rejects can be
 * smuggled in, and the extra layouts go FIRST so an id lookup finds
 * them. Lives here rather than in `@incitio/brands` because it exists
 * for one case — a document that brought its own layout — and a general
 * "add templates to a brand" helper in the registry is the hole through
 * which one chain's layouts reach another chain's page.
 */
export function brandWithTemplates(brand: Brand, templates: PageTemplate[]): Brand {
  if (templates.length === 0) return brand;
  return Brand.parse({ ...brand, templates: [...templates, ...brand.templates] });
}

/* ------------------------------------------------- several references */

/** One reference in a run: a file, and which page of it if it is a PDF. */
export interface MatchReference {
  file: Buffer;
  /** Which page of a PDF. Ignored for an image. */
  pageNumber?: number;
  /** Shown in the page's own name, and in an error about it. */
  name?: string;
}

export interface MatchPagesOptions
  extends Omit<MatchOptions, 'file' | 'pageNumber' | 'exclude' | 'referenceName'> {
  /** The pages to rebuild, in the order they should print. */
  references: MatchReference[];
  /** Called before each reference, so a caller can say where it is. */
  onPage?: (progress: { index: number; total: number; name: string }) => void;
  /**
   * Keep the pages that worked when one reference fails.
   *
   * On by default: a run of eight pages that throws away seven because
   * page six was a photograph of a car park is not a thing anyone wants
   * to pay for twice.
   */
  continueOnError?: boolean;
  /** The catalogue's name. Defaults to the chain plus the first reference. */
  name?: string;
}

export interface MatchPagesResult {
  /** All the rebuilt pages as one ordinary catalogue. */
  document: CatalogDocument;
  /** The chain, carrying every layout this catalogue needs. Render with it. */
  brand: Brand;
  /** Each reference's own result, in order, for reporting per page. */
  pages: MatchResult[];
  /** References that could not be rebuilt, and why. */
  failures: { name: string; message: string }[];
}

/**
 * Several published pages, rebuilt into one catalogue.
 *
 * Sequential, not parallel, and that is the whole design: each page is
 * told which offers the pages before it already used, so the catalogue
 * does not print the same coffee four times. Running them at once would
 * be four times faster and would need a de-duplication pass afterwards
 * that could only take an offer OFF a page — leaving a hole in a layout
 * the model built around it.
 *
 * One browser for the run, because launching Chromium per reference is
 * a second a page for nothing.
 *
 * The studio does not call this: it makes one HTTP request per
 * reference so it can show progress and keep partial results, and a
 * request that hung for eight pages' worth of model time would be cut
 * off by the server long before it answered. Both paths share what
 * matters — `exclude` above, and `mergeCatalogDocuments` below.
 */
export async function matchPages(
  brandId: string,
  options: MatchPagesOptions,
): Promise<MatchPagesResult> {
  const { references, onPage, continueOnError = true, browser: given, ...rest } = options;
  if (references.length === 0) throw new MatchError('ingen referencer at genskabe');

  const browser = given ?? (await chromium.launch());
  const pages: MatchResult[] = [];
  const failures: { name: string; message: string }[] = [];
  const spent: string[] = [];

  try {
    for (const [index, reference] of references.entries()) {
      const name = reference.name ?? `reference ${index + 1}`;
      onPage?.({ index, total: references.length, name });
      try {
        const result = await matchPage(brandId, {
          ...rest,
          browser,
          file: reference.file,
          exclude: spent,
          referenceName: name,
          ...(reference.pageNumber ? { pageNumber: reference.pageNumber } : {}),
        });
        pages.push(result);
        spent.push(...result.document.offers.map((offer) => offer.id));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!continueOnError) throw error;
        failures.push({ name, message });
      }
    }
  } finally {
    if (!given) await browser.close();
  }

  const first = pages[0];
  if (!first) {
    throw new MatchError(failures[0]?.message ?? 'ingen af siderne kunne genskabes');
  }

  const document = mergeCatalogDocuments(pages.map((page) => page.document), {
    ...(options.catalogId ? { id: options.catalogId } : {}),
    ...(options.name ? { name: options.name } : {}),
  });

  return {
    document,
    // Every layout in the run, on top of the chain's own set. Without
    // this the editor can render page one and calls the rest unknown.
    brand: brandWithTemplates(getBrand(brandId).brand, document.templates),
    pages,
    failures,
  };
}
