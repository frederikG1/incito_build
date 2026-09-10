import type { CatalogDocument } from '@incitio/schema';
import { ingestCsv, ingestJson, type IngestIssue, type LabelDictionary } from '@incitio/ingest';
import {
  findSource, getBrand, resolveSource,
  type BrandDefinition, type FeedSource,
} from '@incitio/brands';
import {
  composeCatalog,
  DEFAULT_MAX_PAGES,
  offerBudget,
  planByCategory,
  selectOffers,
  type ComposeResult,
  type SelectionReject,
} from '@incitio/compose';
import { curateCatalogue } from '@incitio/curator';

export interface BuildOptions {
  catalogId?: string;
  name?: string;
  /** Page budget. Also sets how many offers are selected from the feed. */
  maxPages?: number;
  /** Skip the model and use deterministic category planning. */
  skipCuration?: boolean;
  /** Editor direction, passed to the curator. */
  brief?: string;
  model?: string;
  /** Certification marks. Omit and labels render as plain text. */
  labels?: LabelDictionary;
  /** Layout seed. Defaults to the catalogue id. */
  seed?: string;
  /**
   * Which of the chain's readers to use. Omit and the file is matched
   * against all of them — see resolveSource.
   */
  sourceId?: string;
  /**
   * How many offers to publish.
   *
   * Overrides the page budget's own estimate, for the common request
   * that names a count rather than a shape: "the eight best across two
   * pages". Omit and the budget decides.
   */
  offerCount?: number;
}

export interface BuildResult extends ComposeResult {
  document: CatalogDocument;
  /** Rows the feed lost in normalisation, with the reason. */
  issues: IngestIssue[];
  offerCount: number;
  /** Offers deliberately left out of the catalogue, with the reason. */
  notSelected: SelectionReject[];
  /** Offers the plan could not fit inside the page budget. */
  dropped: string[];
  /** Which reader ran, and what it matched on. */
  source: { id: string; name: string; reason: string };
  curated: boolean;
  curationError?: string;
  usage?: { inputTokens: number; outputTokens: number };
}

/**
 * The whole pipeline, in order: ingest → curate → compose.
 *
 * One entry point so the CLI, the API and the tests cannot drift into
 * slightly different notions of what "build a catalogue" means. The
 * brand is the first argument and everything downstream is resolved
 * through it — templates, feed mapping, language, identity — which is
 * what makes tenant isolation a property of the call rather than
 * something each caller has to remember to enforce.
 */
export async function buildCatalogue(
  brandId: string,
  feedText: string,
  options: BuildOptions = {},
): Promise<BuildResult> {
  const definition: BrandDefinition = getBrand(brandId);
  const { brand } = definition;

  /*
   * Which reader runs. Naming one skips detection — useful when a
   * chain publishes two formats whose signatures could both match a
   * hand-edited file — and an unknown name is an error rather than a
   * silent fall back to the default.
   */
  let source: FeedSource;
  let reason: string;

  if (options.sourceId) {
    const named = findSource(definition, options.sourceId);
    if (!named) {
      throw new Error(
        `${brand.name} har ingen kilde "${options.sourceId}". `
        + `Kendte: ${definition.sources.map((s) => s.id).join(', ')}`,
      );
    }
    source = named;
    reason = `valgt med --source ${named.id}`;
  } else {
    const match = resolveSource(definition, feedText);
    if (!match.source) throw new Error(match.reason);
    source = match.source;
    reason = match.reason;
  }

  const { feed, issues } = source.format === 'csv'
    ? ingestCsv(feedText, source.mapping, options.labels)
    : ingestJson(feedText, source.mapping, options.labels);

  const maxPages = Math.max(1, options.maxPages ?? DEFAULT_MAX_PAGES);

  /*
   * Selection runs before curation, not after.
   *
   * Every offer sent to the curator goes into its prompt, so a
   * 1,235-offer range would be a large call to produce a six-page
   * leaflet. Cutting to the page budget first also means the model is
   * choosing an arrangement rather than doing the chain's buying.
   */
  const selection = selectOffers(feed.offers, {
    targetCount: options.offerCount ?? offerBudget(brand, maxPages),
  });

  let curated = false;
  let curationError: string | undefined;
  let usage: BuildResult['usage'];
  /*
   * An explicit offer count is a brief with a shape: "eight across two
   * pages" wants four and four, not the varied rhythm a whole book
   * wants. See planByCategory's `evenPages`.
   */
  let plan = planByCategory(
    brand, selection.selected, maxPages, options.seed, options.offerCount !== undefined,
  );

  if (!options.skipCuration) {
    const result = await curateCatalogue(brand, selection.selected, {
      maxPages,
      ...(options.brief ? { brief: options.brief } : {}),
      ...(options.model ? { model: options.model } : {}),
    });
    plan = result.plan;
    curated = !result.fellBack;
    curationError = result.error;
    usage = result.usage;
  }

  const composed = composeCatalog(plan, selection.selected, {
    id: options.catalogId ?? `${brand.id}-1`,
    name: options.name ?? brand.name,
    brand,
    ...(options.seed ? { seed: options.seed } : {}),
  });

  return {
    ...composed,
    issues,
    offerCount: feed.offers.length,
    notSelected: selection.rejected,
    dropped: plan.dropped,
    curated,
    source: { id: source.id, name: source.name, reason },
    ...(curationError ? { curationError } : {}),
    ...(usage ? { usage } : {}),
  };
}
