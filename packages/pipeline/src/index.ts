import {
  Brand, coversWeek, weekName, type CatalogDocument, type CatalogWeek, type PageTemplate,
} from '@incitio/schema';
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
  /**
   * Extra layouts for this chain, on top of the ones its brand file
   * declares — see `npm run derive:templates`, which reads them off the
   * chain's own published pages.
   *
   * Passed in rather than loaded here because the pipeline is a library
   * and does not own a filesystem. NOT exposed by the HTTP API: the
   * brand is still resolved from `brandId`, so tenant isolation holds
   * for every caller, but a route that forwarded this from a request
   * body would hand one tenant a way to inject another's shapes. The
   * CLI is the only caller.
   */
  extraTemplates?: PageTemplate[];
  /**
   * The week the paper is for.
   *
   * Three things at once, and they are the same thing: the feed is cut
   * to the offers that actually run that week, the document is named
   * after it, and the document carries it so every later stage can ask.
   *
   * Omit and nothing is filtered and nothing is named — which is what
   * every caller did before anybody asked which week, and is still the
   * right answer for a one-off build off a file with no dates worth
   * trusting.
   */
  week?: CatalogWeek;
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
  /**
   * Offers the feed carried that do not run in the week.
   *
   * Reported rather than swallowed: a file that turns out to be last
   * week's is a number in the thousands here, and that is the fastest
   * way anybody will ever find out.
   */
  outsideWeek: number;
  /**
   * How many of the feed's offers actually run in the week, or null
   * when no week was asked for.
   *
   * Zero is the interesting value and the reason this is not just
   * `outsideWeek`: it means the filter matched nothing, the whole feed
   * went through unfiltered, and what came back is NOT week 39's
   * paper. Silently building it anyway — which is what the fallback
   * does, deliberately — would be dishonest without this.
   */
  inWeek: number | null;
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
  /*
   * Derived layouts go FIRST so a draw at a given capacity can actually
   * reach them; the brand's own set stays behind them, because this
   * widens the vocabulary rather than replacing it. Re-parsed through
   * `Brand` so a caller cannot smuggle in anything the schema rejects.
   */
  const brand = options.extraTemplates?.length
    ? Brand.parse({
      ...definition.brand,
      templates: [...options.extraTemplates, ...definition.brand.templates],
    })
    : definition.brand;

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
   * The week, applied where it costs nothing: before selection.
   *
   * A feed is a range, not a paper. SuperBrugsen's own file carries
   * every offer the chain is running, with its own dates on each row,
   * and building week 39's avis out of all of them is how a product
   * that stopped being on offer on Sunday ends up printed. Cut here so
   * neither the selector nor the curator ever sees them.
   *
   * Never to nothing: a filter that empties the feed has found a
   * mislabelled file or the wrong week, and building an empty
   * catalogue would hide both. The offers go through unfiltered and
   * `outsideWeek` says how many were in question.
   */
  const inWeek = options.week
    ? feed.offers.filter((offer) => coversWeek(offer, options.week!))
    : feed.offers;
  const offers = inWeek.length > 0 ? inWeek : feed.offers;
  const outsideWeek = feed.offers.length - offers.length;

  /*
   * Selection runs before curation, not after.
   *
   * Every offer sent to the curator goes into its prompt, so a
   * 1,235-offer range would be a large call to produce a six-page
   * leaflet. Cutting to the page budget first also means the model is
   * choosing an arrangement rather than doing the chain's buying.
   */
  const selection = selectOffers(offers, {
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
    name: options.name ?? (options.week ? weekName(brand.name, options.week) : brand.name),
    brand,
    ...(options.seed ? { seed: options.seed } : {}),
  });

  return {
    ...composed,
    // The week travels with the document, not only with this reply:
    // the paper is week 39's from here on, including after it has been
    // saved, reopened on another machine and printed.
    document: { ...composed.document, week: options.week ?? null },
    issues,
    outsideWeek,
    inWeek: options.week ? inWeek.length : null,
    offerCount: feed.offers.length,
    notSelected: selection.rejected,
    dropped: plan.dropped,
    curated,
    source: { id: source.id, name: source.name, reason },
    ...(curationError ? { curationError } : {}),
    ...(usage ? { usage } : {}),
  };
}
