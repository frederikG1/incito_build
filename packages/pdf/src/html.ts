import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import type { Brand, CatalogDocument } from '@incitio/schema';
import { CatalogView } from '@incitio/renderer';
import { withAssetBase } from './assets.js';

const require = createRequire(import.meta.url);

/** The catalogue stylesheet, inlined so the page needs no network. */
function stylesheet(): string {
  return readFileSync(require.resolve('@incitio/renderer/styles.css'), 'utf8');
}

export interface RenderHtmlOptions {
  /** Page width in millimetres. A4 portrait is 210. */
  widthMm?: number;
  /** Base URL for root-relative asset paths. See withAssetBase. */
  assetBase?: string;
  /** Extra CSS appended after the stylesheet, for one-off overrides. */
  extraCss?: string;
}

/**
 * A whole catalogue as one self-contained HTML document.
 *
 * The same React components the editor renders, run through
 * `renderToStaticMarkup` — so what a person approves on screen is
 * literally the markup that goes to print, rather than a second
 * implementation that drifts. The stylesheet is inlined; product
 * photography is still fetched over the network, which is why the PDF
 * step waits for images before printing.
 */
export function renderCatalogueHtml(
  document: CatalogDocument,
  brand: Brand,
  options: RenderHtmlOptions = {},
): string {
  const widthMm = options.widthMm ?? 210;
  const source = options.assetBase ? withAssetBase(document, options.assetBase) : document;
  const body = renderToStaticMarkup(createElement(CatalogView, { document: source, brand }));

  const heightMm = (widthMm / brand.pageAspect).toFixed(2);

  return `<!doctype html>
<html lang="da">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(document.name)}</title>
<style>${stylesheet()}</style>
<style>
  /*
   * Print geometry, scoped to print.
   *
   * Kept in a media query rather than applied unconditionally so this
   * same file is a usable on-screen proof: opened in a browser it
   * behaves like the editor's preview, and printed — which is what
   * Chromium does when it makes the PDF — it becomes millimetre-exact
   * sheets.
   */
  html, body { margin: 0; padding: 24px 0; background: #e9e9ea; }

  @page { size: ${widthMm}mm ${heightMm}mm; margin: 0; }

  @media print {
    html, body { padding: 0; background: #fff; }
    .catalog { gap: 0; }
    .page {
      max-width: none;
      width: ${widthMm}mm;
      /* Explicit rather than from aspect-ratio: Chromium's paged layout
         resolves percentage heights against the sheet, and an
         aspect-ratio box inside it rounds to a hairline overflow that
         costs a blank page after every real one. */
      height: ${heightMm}mm;
      aspect-ratio: auto;
      break-after: page;
    }
    .page:last-child { break-after: auto; }
    * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
${options.extraCss ? `<style>${options.extraCss}</style>` : ''}
</head>
<body>${body}</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);
}
