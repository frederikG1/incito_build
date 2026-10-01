import { z } from 'zod';
import { ImageRef } from './offer.js';

/**
 * A theme: the chain's dress for an occasion — birthday flags, Halloween
 * pumpkins, the Black Friday band — chosen for a whole avis at once.
 *
 * Every piece is one of the chain's own pictures (its library, or a file
 * uploaded for the purpose), a place on the page and which pages carry
 * it. Applied, each becomes an ordinary `PageDecoration` that can be
 * moved and resized like any other, marked as the theme's so choosing
 * another theme — or none — takes exactly those off again.
 *
 * The chain's, not the avis's: made once, used every year.
 */

/** Where on the page a piece goes — the places occasion artwork actually sits. */
export const THEME_PLACES = ['top', 'bottom', 'top-left', 'top-right', 'bottom-left', 'bottom-right'] as const;
export type ThemePlace = (typeof THEME_PLACES)[number];

export const ThemePiece = z.object({
  imageUrl: ImageRef,
  /** What the file was called, so a person can tell the pieces apart. */
  subject: z.string().max(120).default(''),
  place: z.enum(THEME_PLACES).default('top'),
  /**
   * How big: for a band across the top or bottom, its height as a share
   * of the page; for a corner piece, its width.
   */
  size: z.number().min(0.05).max(0.6).default(0.14),
  /** Which pages: the front page, every page, or the back page. */
  on: z.enum(['forside', 'alle', 'bagside']).default('alle'),
  /** Over the products rather than behind them — a sticker, not wallpaper. */
  front: z.boolean().default(false),
});
export type ThemePiece = z.infer<typeof ThemePiece>;

export const Theme = z.object({
  id: z.string().min(1).max(60),
  name: z.string().trim().min(1).max(60),
  pieces: z.array(ThemePiece).max(8).default([]),
  /** The page colour for the occasion, when it has one. Null keeps the chain's own. */
  ground: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().default(null),
});
export type Theme = z.infer<typeof Theme>;

export const Themes = z.array(Theme).max(40);
export type Themes = z.infer<typeof Themes>;

/** The decoration id a theme's piece gets on a page — and how it is recognised again. */
export const themeDecorId = (themeId: string, index: number) => `theme-${themeId}-${index}`;
export const isThemeDecor = (decorId: string) => decorId.startsWith('theme-');

/** What an avis remembers of the theme it wears — enough to take it off again. */
export const AppliedTheme = z.object({
  id: z.string(),
  name: z.string(),
  ground: z.string().nullable().default(null),
});
export type AppliedTheme = z.infer<typeof AppliedTheme>;

interface ThemedPage {
  kind: string;
  ground: string | null;
  decorations: {
    id: string; imageUrl: string; subject: string; offerId: string | null;
    anchor: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
    scale: number; rotate: number; opacity: number; flip: boolean; front: boolean;
    offsetX: number; offsetY: number; rect?: { x: number; y: number; w: number; h: number };
  }[];
}

/** One piece as the decoration it becomes on a page. */
export function themeDecoration(themeId: string, piece: ThemePiece, index: number): ThemedPage['decorations'][number] {
  const band = piece.place === 'top' || piece.place === 'bottom';
  return {
    id: themeDecorId(themeId, index),
    imageUrl: piece.imageUrl,
    subject: piece.subject,
    offerId: null,
    anchor: band ? (piece.place === 'top' ? 'top-left' : 'bottom-left') : piece.place as ThemedPage['decorations'][number]['anchor'],
    scale: band ? 0.26 : piece.size,
    rotate: 0,
    opacity: 1,
    flip: false,
    front: piece.front,
    offsetX: 0,
    offsetY: 0,
    ...(band ? { rect: { x: 0, y: piece.place === 'top' ? 0 : 1 - piece.size, w: 1, h: piece.size } } : {}),
  };
}

/**
 * The avis in `theme` — or, with null, in none.
 *
 * Whatever the previous theme put on the pages comes off first, and only
 * that: a picture somebody laid on a page by hand stays. The page colour
 * follows the same rule — a page whose colour is still the old theme's
 * takes the new one's; a page somebody coloured themselves keeps theirs.
 */
export function withTheme<D extends { pages: P[]; theme?: AppliedTheme | undefined }, P extends ThemedPage>(
  document: D,
  theme: Theme | null,
): D {
  const was = document.theme?.ground ?? null;
  const offers = document.pages.map((page, index) => ({ page, index })).filter(({ page }) => page.kind === 'offers');
  const first = offers[0]?.index;
  const last = offers.at(-1)?.index;
  const pages = document.pages.map((page, index) => {
    const own = page.decorations.filter((decor) => !isThemeDecor(decor.id));
    if (page.kind !== 'offers') return { ...page, decorations: own };
    const pieces = (theme?.pieces ?? [])
      .map((piece, n) => ({ piece, n }))
      .filter(({ piece }) => piece.on === 'alle' || (piece.on === 'forside' && index === first) || (piece.on === 'bagside' && index === last && index !== first));
    const ground = page.ground === was ? (theme?.ground ?? null) : page.ground;
    return {
      ...page,
      ground,
      // The theme's pieces first, so a picture laid on by hand keeps its place on top; twelve at most.
      decorations: [...pieces.map(({ piece, n }) => themeDecoration(theme!.id, piece, n)), ...own].slice(0, 12),
    };
  });
  const next = { ...document, pages };
  if (theme) next.theme = { id: theme.id, name: theme.name, ground: theme.ground };
  else delete next.theme;
  return next;
}
