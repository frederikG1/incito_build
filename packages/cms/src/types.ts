/**
 * Tjek CMS publications, as the CMS's own API hands them to the editor.
 *
 * One publication is four answers: the publication itself (name, tags,
 * target groups), its incito config (the sections, in order, with the
 * offers in each and the design tag that draws them), its design
 * templates (section designs and offer designs, one flat list) and its
 * offers (the "transformed offers" rows `tjekTransformed` already maps).
 *
 * Read leniently: every field the code below relies on is named here and
 * everything else passes through, so a CMS release that adds a field
 * does not break an import.
 */
import { z } from 'zod';

const nullableString = z.string().nullable().optional();

export const CmsSection = z.object({
  id: z.string().min(1),
  title: z.string().default(''),
  /** Wolt's cohort: the feed category the section is filled from. */
  group_label: nullableString,
  /** The section design that draws the section ("Main template"). */
  design_tag: z.string().default(''),
  /** The section design further offers spill onto ("Overflow template"). */
  secondary_design_tag: nullableString,
  offer_ids: z.array(z.string()).default([]),
  /** Offers the section's A slots take — the lead, the "1prio". */
  a_offer_ids: z.array(z.string()).default([]),
}).passthrough();
export type CmsSection = z.infer<typeof CmsSection>;

export const CmsConfig = z.object({
  width: z.number().optional(),
  height: z.number().optional(),
  bg_color: nullableString,
  sections: z.array(CmsSection).default([]),
}).passthrough();
export type CmsConfig = z.infer<typeof CmsConfig>;

const ImageUrl = z.object({ signed: z.string().optional(), unsigned: z.string().optional() }).nullable().optional();

/** One layer of a section design: a picture, a text, a colour field — or a box of offers. */
export const CmsSectionLayer = z.object({
  id: z.union([z.number(), z.string()]),
  name: nullableString,
  x1: z.number(), y1: z.number(), x2: z.number(), y2: z.number(),
  is_hidden: z.boolean().optional(),
  opacity: z.number().optional(),
  bg_color: nullableString,
  bg_image_url: ImageUrl,
  bg_image_size: nullableString,
  /** Set on an offer box: the offer design tag its offers are drawn in. */
  offers_tag: nullableString,
  /** How many offers the box takes; absent is "the rest". */
  offers_max_count: z.number().nullable().optional(),
  paragraphs: z.array(z.object({ text_content: z.string().default('') }).passthrough()).default([]),
}).passthrough();
export type CmsSectionLayer = z.infer<typeof CmsSectionLayer>;

export const CmsSectionDesign = z.object({
  id: z.string().min(1),
  tag: z.string().min(1),
  type: z.literal('section'),
  layers: z.array(CmsSectionLayer).default([]),
}).passthrough();
export type CmsSectionDesign = z.infer<typeof CmsSectionDesign>;

/** A row of the CMS's offers list — the transformed-offers format, keyed by the chain's own item number. */
export const CmsOffer = z.object({
  id: z.string().min(1),
  /** The chain's item number: the same product in every edition and every week. */
  external_id: nullableString,
  name: z.string().default(''),
  price: z.number().nullable().optional(),
  /** Fields somebody set by hand, which a feed sync leaves alone. */
  col_locks: z.array(z.string()).nullable().optional(),
}).passthrough();
export type CmsOffer = z.infer<typeof CmsOffer>;

export const CmsPublicationMeta = z.object({
  id: z.string().min(1),
  name: z.string().default(''),
  /** "Hovedavis", "Lokal" … */
  tags: z.array(z.string()).default([]),
  target_group_ids: z.array(z.string()).default([]),
  valid_from: nullableString,
  valid_until: nullableString,
}).passthrough();
export type CmsPublicationMeta = z.infer<typeof CmsPublicationMeta>;

/** One page as the CMS's own preview drew it: the section's incito view tree. */
export interface CmsRender {
  section_id: string;
  page_number: number;
  view: Record<string, unknown>;
}

export interface CmsPublication {
  meta: CmsPublicationMeta;
  config: CmsConfig;
  /** Section and offer designs, as the CMS lists them. Offer designs parse with `OfferDesign`. */
  designs: unknown[];
  offers: CmsOffer[];
  /** The CMS preview's pages, when captured — see `CmsRender`. */
  renders?: CmsRender[];
  /** The preview's `font_assets`, family → font URL: the chain's own faces. */
  fonts?: Record<string, string>;
}

/** One publication from its four API answers. Throws on a shape that is not a CMS publication. */
export function readCmsPublication(raw: {
  meta: unknown; config: unknown; designs?: unknown; offers: unknown;
  renders?: unknown; preview?: { font_assets?: Record<string, { src?: [string, string][] }> } | null;
}): CmsPublication {
  const fonts: Record<string, string> = {};
  for (const [family, asset] of Object.entries(raw.preview?.font_assets ?? {})) {
    const url = asset?.src?.[0]?.[1];
    if (url) fonts[family] = url;
  }
  return {
    meta: CmsPublicationMeta.parse(raw.meta),
    config: CmsConfig.parse(raw.config),
    designs: Array.isArray(raw.designs) ? raw.designs : [],
    offers: z.array(CmsOffer).parse(raw.offers),
    ...(Array.isArray(raw.renders) ? { renders: raw.renders as CmsRender[] } : {}),
    ...(Object.keys(fonts).length ? { fonts } : {}),
  };
}

/** The section designs in a design list; offer designs and anything unreadable are left out. */
export function sectionDesigns(designs: readonly unknown[]): CmsSectionDesign[] {
  const out: CmsSectionDesign[] = [];
  for (const entry of designs) {
    const parsed = CmsSectionDesign.safeParse(entry);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

/** An offer's key across editions and weeks: the chain's item number, else the CMS row id. */
export const offerKey = (offer: CmsOffer): string => offer.external_id || offer.id;
