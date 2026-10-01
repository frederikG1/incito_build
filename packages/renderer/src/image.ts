import { createContext, useContext } from 'react';

/**
 * How large a product photograph needs to be where it is drawn.
 *
 * The feed links every packshot at 800 pixels — right for print, and
 * three times what a page on screen shows. The image service makes any
 * size from the same signed link, and a smaller one arrives in less than
 * half the time, which is most of what a new week's pages wait for.
 *
 * `null` — the default, and what the PDF renders with — leaves every
 * link exactly as the feed wrote it.
 */
export const ImageSize = createContext<number | null>(null);

/** Only this service is known to resize by its `size` parameter, and to keep the signature valid when it does. */
const RESIZES = /^https:\/\/imageservice\d*\.republica\.dk\/.*[?&]size=(\d+)/;

/**
 * Sizes the service answers with a flattened picture: at exactly 200 it
 * returns a stored thumbnail on white, and every cut-out packshot on a
 * coloured page showed up as a white box. Measured; any other size keeps
 * the transparency.
 */
const FLATTENED = new Set([200]);

/** The same photograph at `px` pixels, never larger than the feed's own. */
export function sizedImage(url: string, px: number | null): string {
  if (!px) return url;
  const match = RESIZES.exec(url);
  if (!match) return url;
  const own = Number(match[1]);
  const size = FLATTENED.has(px) ? px + 20 : px;
  return size >= own ? url : url.replace(/([?&])size=\d+/, `$1size=${size}`);
}

/** The resizer for the photographs drawn here — see `ImageSize`. */
export function useSizedImage(): (url: string) => string {
  const px = useContext(ImageSize);
  return (url) => sizedImage(url, px);
}
