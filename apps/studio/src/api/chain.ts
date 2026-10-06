/** The chain's own settings: profile, feed check, themes, sections, rules and offer designs. */
import { Brand, CatalogPage, Offer, OfferRules, PageTemplate, Themes, type Theme } from '@incitio/schema';
import type { FeedHealth } from '@incitio/brands';
import type { OfferDesign } from '@incitio/schema';
import { BASE, headers, fail } from './http.js';

export interface BrandSummary { id: string; name: string; color?: string; accent?: string }

export async function fetchBrands(): Promise<BrandSummary[]> {
  const response = await fetch(`${BASE}/brands`);
  if (!response.ok) await fail(response);
  return ((await response.json()) as { brands: BrandSummary[] }).brands;
}

export interface BrandSource {
  id: string;
  name: string;
  format: 'csv' | 'json';
  /** A sample shipped with the repo, or null. */
  path: string | null;
  /** Whether this is the sample the editor should open with. */
  sample: boolean;
}

export interface BrandProfile {
  brand: Brand;
  /** A publication link to test with, from the server's own `.env`. */
  testPublication?: string;
  /** Every format this chain delivers. The first is the default. */
  sources: BrandSource[];
}

/** A feed file judged before anything is built from it — see `feedHealth` in @incitio/brands. */
export async function checkFeed(brandId: string, file: File): Promise<FeedHealth> {
  const response = await fetch(`${BASE}/brand/feed-health?name=${encodeURIComponent(file.name)}`, {
    method: 'POST',
    headers: headers(brandId, { 'content-type': 'text/plain' }),
    body: await file.text(),
  });
  if (!response.ok) await fail(response);
  return (await response.json()) as FeedHealth;
}

export async function fetchBrandProfile(brandId: string): Promise<BrandProfile> {
  const response = await fetch(`${BASE}/brand/profile`, { headers: headers(brandId) });
  if (!response.ok) await fail(response);
  const body = (await response.json()) as {
    brand: unknown;
    sources: BrandSource[];
    testPublication?: string;
  };
  return {
    brand: Brand.parse(body.brand),
    sources: body.sources,
    // The machine's own test avis, when its `.env` names one.
    ...(body.testPublication ? { testPublication: body.testPublication } : {}),
  };
}

export async function fetchCurationStatus(brandId: string): Promise<boolean> {
  try {
    const response = await fetch(`${BASE}/brand/curation/status`, { headers: headers(brandId) });
    if (!response.ok) return false;
    return Boolean(((await response.json()) as { configured?: boolean }).configured);
  } catch {
    return false;
  }
}

export interface DecorStatus {
  /** Whether the server holds a GEMINI_API_KEY — mood artwork needs one. */
  configured: boolean;
  /** The model that will be billed, so the studio can name it on screen. */
  imageModel: string;
}

export async function fetchDecorStatus(brandId: string): Promise<DecorStatus> {
  try {
    const response = await fetch(`${BASE}/brand/decor/status`, { headers: headers(brandId) });
    if (!response.ok) return { configured: false, imageModel: '' };
    const body = (await response.json()) as Partial<DecorStatus>;
    return { configured: Boolean(body.configured), imageModel: body.imageModel ?? '' };
  } catch {
    return { configured: false, imageModel: '' };
  }
}

/**
 * One of the chain's saved page designs — see `Section` in the server.
 * The page as it printed, the grid when the document owned it, and the
 * products it printed with, for the gallery's picture of it.
 */
export interface Section {
  id: string;
  name: string;
  tags: string[];
  page: CatalogPage;
  template: PageTemplate | null;
  preview: Offer[];
  createdAt: string;
  version?: number;
  updatedAt?: string;
}

export async function fetchThemes(brandId: string): Promise<Theme[]> {
  const response = await fetch(`${BASE}/brand/themes`, { headers: headers(brandId) });
  if (!response.ok) await fail(response);
  return Themes.parse(((await response.json()) as { themes: unknown }).themes);
}

/** The chain's themes, saved whole. */
export async function saveThemes(brandId: string, themes: Theme[]): Promise<Theme[]> {
  const response = await fetch(`${BASE}/brand/themes`, {
    method: 'PUT',
    headers: headers(brandId, { 'content-type': 'application/json' }),
    body: JSON.stringify({ themes }),
  });
  if (!response.ok) await fail(response);
  return Themes.parse(((await response.json()) as { themes: unknown }).themes);
}

export async function fetchSections(brandId: string): Promise<Section[]> {
  const response = await fetch(`${BASE}/brand/sections`, { headers: headers(brandId) });
  if (!response.ok) await fail(response);
  return ((await response.json()) as { sections: Section[] }).sections;
}

/** Save the chain's offer rules, whole — their order is their precedence. */
export async function saveOfferRules(brandId: string, rules: OfferRules): Promise<OfferRules> {
  const response = await fetch(`${BASE}/brand/offer-rules`, {
    method: 'PUT',
    headers: headers(brandId, { 'content-type': 'application/json' }),
    body: JSON.stringify({ rules }),
  });
  if (!response.ok) await fail(response);
  return OfferRules.parse(((await response.json()) as { rules: unknown }).rules);
}

export async function saveOfferDesigns(brandId: string, designs: OfferDesign[], tag: string | null): Promise<void> {
  const response = await fetch(`${BASE}/brand/offer-designs`, {
    method: 'PUT',
    headers: headers(brandId, { 'content-type': 'application/json' }),
    body: JSON.stringify({ designs, tag }),
  });
  if (!response.ok) await fail(response);
}

export async function saveSection(brandId: string, section: Section): Promise<Section> {
  const response = await fetch(`${BASE}/brand/sections`, {
    method: 'POST',
    headers: headers(brandId, { 'content-type': 'application/json' }),
    body: JSON.stringify(section),
  });
  if (!response.ok) await fail(response);
  return ((await response.json()) as { section: Section }).section;
}

export async function removeSection(brandId: string, id: string): Promise<void> {
  const response = await fetch(`${BASE}/brand/sections/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: headers(brandId),
  });
  if (!response.ok) await fail(response);
}
