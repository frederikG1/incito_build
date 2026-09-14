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
 */
import Anthropic from '@anthropic-ai/sdk';
import { jsonSchemaOutputFormat } from '@anthropic-ai/sdk/helpers/json-schema';
import { chromium, type Browser } from 'playwright';
import {
  Brand, CatalogDocument, PageTemplate, validateTemplate,
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
    const pool = feed.offers
      .filter((o) => o.imageUrl)
      .slice(0, Math.max(4, options.poolSize ?? 60));
    if (pool.length === 0) {
      throw new MatchError('feedet indeholder ingen tilbud med billede');
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
        subtitle: '',
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
