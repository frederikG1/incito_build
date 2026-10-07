import type { Brand, CatalogDocument, CatalogPage, PageTemplate } from '@incitio/schema';
import { pageTemplate } from './apply.js';

/**
 * Shared designs: a section is saved once and used on many pages, in
 * many weeks' aviser. Each page records which section and which version
 * it came from (`CatalogPage.section`); when the chain saves a new
 * version, the pages behind it can take the new design — grid, ground,
 * background, artwork, notes, headline — and keep their own products.
 */
export interface SectionDesign {
  id: string;
  name: string;
  version?: number;
  page: CatalogPage;
  template: PageTemplate | null;
}

/** Pages whose section has moved on since they were made or last updated. */
export function sectionsBehind(document: CatalogDocument, sections: SectionDesign[]): { pageId: string; section: SectionDesign; from: number }[] {
  const byId = new Map(sections.map((s) => [s.id, s]));
  return document.pages.flatMap((page) => {
    const link = page.section;
    const section = link ? byId.get(link.id) : undefined;
    return link && section && (section.version ?? 1) > link.version
      ? [{ pageId: page.id, section, from: link.version }]
      : [];
  });
}

/**
 * The section's design on this page, with this page's products.
 *
 * Offers keep their order: the strongest cell's offer goes into the new
 * design's strongest cell, and so on. A design with fewer cells sends the
 * rest to the reserve and says how many; pinned tiles go first so they
 * are the ones that stay. Artwork tied to one of last week's products is
 * left behind — it belonged to that product, not to the design.
 */
export function applySection(
  document: CatalogDocument,
  brand: Brand,
  pageId: string,
  section: SectionDesign,
): { document: CatalogDocument; dropped: number } {
  const page = document.pages.find((p) => p.id === pageId);
  if (!page) throw new Error(`no page "${pageId}"`);
  const design = section.page;
  const next = brand.templates.find((t) => t.id === design.templateId)
    ?? document.templates.find((t) => t.id === design.templateId)
    ?? section.template
    ?? undefined;

  let placements = page.placements;
  let dropped = 0;
  if (next && design.kind === 'offers') {
    const old = pageTemplate(document, brand, page);
    const order = old ? old.slots.map((s) => s.id) : page.placements.map((p) => p.slotId);
    const ranked = [...page.placements].sort((a, b) => order.indexOf(a.slotId) - order.indexOf(b.slotId));
    const kept = [...ranked.filter((p) => p.overrides.pinned), ...ranked.filter((p) => !p.overrides.pinned)].slice(0, next.slots.length);
    placements = ranked.filter((p) => kept.includes(p)).map((p, i) => ({ ...p, slotId: next.slots[i]!.id }));
    dropped = ranked.length - placements.length;
  }

  const updated: CatalogPage = {
    ...page,
    kind: design.kind,
    templateId: design.templateId,
    title: design.title,
    subtitle: design.subtitle,
    ground: design.ground,
    ...(design.motif !== undefined ? { motif: design.motif } : {}),
    background: design.background,
    decorations: design.decorations.filter((d) => !d.offerId),
    notes: design.notes,
    texts: design.texts,
    ...(design.design !== undefined ? { design: design.design } : {}),
    placements,
    section: { id: section.id, version: section.version ?? 1 },
  };
  delete updated.layout;
  delete updated.layouts;

  // The section's own layout replaces the copy an earlier version left in the document — a re-imported CMS design keeps its id.
  const templates = next && !brand.templates.some((t) => t.id === next.id)
    ? [...document.templates.filter((t) => t.id !== next.id), next]
    : document.templates;
  return {
    document: { ...document, templates, pages: document.pages.map((p) => (p.id === pageId ? updated : p)) },
    dropped,
  };
}
