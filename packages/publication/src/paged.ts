/**
 * A publication that was published as pictures.
 *
 * Most chains on Tjek do not publish incito at all — Netto, REMA and
 * Lidl hand in a PDF, and the viewer shows it as one image per page.
 * There is no tree to print, so one is made: a sheet the size of the
 * picture with the picture as its ground. Printed through the same
 * `IncitoPage` as a SuperBrugsen page, it is the published page pixel
 * for pixel, and everything the editor does to a published page — the
 * book, the PDF, the checks — works on it without knowing the
 * difference.
 *
 * The products come later, and from a model (`readPagedPage` in
 * `@incitio/match`): each one becomes an offer in the tree whose box
 * shows its own crop of the picture. So a printed product can be
 * pointed at, moved, hidden, or replaced — the paper under it is a
 * patch of the colour sampled around it.
 */
import type { Publication, PublicationOffer, PublicationPage } from './incito.js';

/** One page image in the viewer's paged view. */
export interface PagedImage {
  number: number;
  src: string;
  width: number;
  height: number;
}

export interface PagedSource {
  /** The viewer's `<title>` — the chain's name. */
  title: string;
  pages: PagedImage[];
}

/** The sheet's own width, in points — the width an incito sheet has. */
export const PAGED_WIDTH = 600;

const decode = (text: string) => text
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>');

/** The page images out of a viewer page showing a paged publication, or null. */
export function extractPaged(html: string): PagedSource | null {
  if (!/id="paged-root"/.test(html)) return null;
  const pages: PagedImage[] = [];
  for (const found of html.matchAll(/<img\b[^>]*\bid="page-(\d+)"[^>]*>/g)) {
    const tag = found[0];
    const src = /\bsrc="([^"]+)"/.exec(tag)?.[1];
    if (!src) continue;
    pages.push({
      number: Number(found[1]),
      src: decode(src),
      width: Number(/\bwidth="(\d+)"/.exec(tag)?.[1]) || 700,
      height: Number(/\bheight="(\d+)"/.exec(tag)?.[1]) || 1000,
    });
  }
  if (pages.length === 0) return null;
  pages.sort((a, b) => a.number - b.number);
  const title = decode(/<title>([^<]*)<\/title>/.exec(html)?.[1]?.trim() ?? '');
  return { title, pages };
}

/** Marks a sheet as made from a picture, and says how big the picture is. */
export interface PagedMark {
  image: string;
  /** The picture's own pixels. */
  width: number;
  height: number;
  /** The page's paper, for a cell whose own was never sampled. */
  paper?: string;
}

/** The picture behind a sheet made by `pagedPage`, or null for any other page. */
export function pagedMark(view: Record<string, unknown> | null | undefined): PagedMark | null {
  const mark = view?.['paged'] as PagedMark | undefined;
  return mark && typeof mark.image === 'string' ? mark : null;
}

/** A product the publication itself says stands in a cell — from Tjek's own offer data. */
export interface PagedProduct {
  id: string;
  name: string;
  description: string;
  pack: string;
  price: number | null;
  imageUrl: string | null;
}

/** One cell of a page picture, in the picture's own pixels. */
export interface PagedCell {
  box: { x0: number; y0: number; x1: number; y1: number };
  /** The paper around it. */
  paper?: string;
  /** What stands in it, when that is known. */
  product?: PagedProduct;
}

const HEX = /^#[0-9a-f]{6}$/i;

/**
 * A page of the publication as a sheet: the picture, and the cells on it.
 *
 * The cells become the page's layout (`TemplateSlot.rect`) — the tree
 * itself holds only the picture, and the renderer makes a box per cell
 * from the layout when it prints (`boundIncito`). A cell whose product
 * is known becomes a placement of that product; one found by its pixels
 * alone is only a place a product may be put.
 */
export function pagedPage(
  number: number,
  image: string,
  size: { width: number; height: number },
  cells: PagedCell[] = [],
  paper?: string,
): PublicationPage {
  const k = PAGED_WIDTH / size.width;
  const width = PAGED_WIDTH;
  const height = Math.round(size.height * k);
  const offers: PublicationOffer[] = cells.map((cell, index) => {
    const rect = {
      x: cell.box.x0 * k,
      y: cell.box.y0 * k,
      w: Math.max(1, (cell.box.x1 - cell.box.x0) * k),
      h: Math.max(1, (cell.box.y1 - cell.box.y0) * k),
    };
    const product = cell.product;
    return {
      id: product?.id ?? `cell-p${number}-${index + 1}`,
      rect,
      name: product?.name ?? '',
      description: product?.description ?? '',
      pack: product?.pack ?? '',
      price: product?.price ?? null,
      currency: 'DKK',
      imageUrl: product?.imageUrl ?? null,
      marks: [],
      frame: null,
      ...(product ? {} : { unbound: true }),
      ...(cell.paper && HEX.test(cell.paper) ? { paper: cell.paper.toLowerCase() } : {}),
    };
  });

  return {
    number,
    width,
    height,
    ground: paper && HEX.test(paper) ? paper.toLowerCase() : null,
    background: { imageUrl: image, opacity: 1 },
    masthead: null,
    artwork: [],
    labels: [],
    offers,
    view: {
      view_name: 'AbsoluteLayout',
      layout_width: width,
      layout_height: height,
      background_image: image,
      background_image_scale_type: 'center_crop',
      paged: {
        image, width: size.width, height: size.height,
        ...(paper && HEX.test(paper) ? { paper: paper.toLowerCase() } : {}),
      } satisfies PagedMark,
      child_views: [],
    },
  };
}

/** A whole publication of pictures, each with the cells found on it. */
export function pagedPublication(
  id: string,
  pages: { number: number; image: string; width: number; height: number; cells?: PagedCell[]; paper?: string }[],
): Publication {
  return {
    id,
    locale: 'da_DK',
    pages: pages.map((page) => pagedPage(page.number, page.image, page, page.cells ?? [], page.paper)),
    fonts: {},
    theme: { fontFamily: 'system-ui, sans-serif', color: '#000000', background: '#ffffff', lineHeight: 1.2 },
  };
}
