/**
 * Getting the incito out of a link somebody pasted.
 *
 * The viewer serves the whole document inside the page it renders —
 * `<script id="incito-data">`, URL-encoded — so there is no second
 * request and no private API involved: what is read here is exactly
 * what the browser at that link is handed.
 *
 * A preview link carries its own signature in `?s=`, and that signature
 * is the access. Without it the viewer answers 401 with a note about
 * scraping, and that answer is passed straight through to the editor
 * rather than being worked around: a link that was not shared with us
 * is not ours to open.
 */

/** How much HTML we will read before giving up. A catalogue is ~1–5 MB. */
const MAX_BYTES = 40 * 1024 * 1024;

export class PublicationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PublicationError';
  }
}

/** Only http(s), and never a link that resolves inside this machine. */
function checkedUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new PublicationError('det er ikke en URL');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new PublicationError(`${url.protocol} kan ikke hentes — brug et http(s)-link`);
  }
  /*
   * A URL typed into the editor reaches the SERVER's network, not the
   * browser's, so an address on the server's own machine would let the
   * field read things the editor can otherwise not see. Refused by
   * name: anything more clever than this (resolving the host, checking
   * the address family) belongs in a proxy, not in a feature.
   */
  if (/^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|\[?::1)/i.test(url.hostname)) {
    throw new PublicationError('lokale adresser kan ikke hentes');
  }
  return url;
}

/**
 * The incito document behind a viewer link.
 *
 * Returns the parsed JSON exactly as published; `readIncito` is what
 * turns it into pages. Kept apart so a document already on disk can be
 * read without the network — which is what the tests do.
 */
export async function fetchIncito(raw: string): Promise<unknown> {
  const url = checkedUrl(raw);

  let response: Response;
  try {
    response = await fetch(url, { redirect: 'follow' });
  } catch (error) {
    throw new PublicationError(
      `kunne ikke nå ${url.hostname}: ${error instanceof Error ? error.message : 'ukendt fejl'}`,
    );
  }

  if (!response.ok) {
    const body = (await response.text().catch(() => '')).slice(0, 300);
    throw new PublicationError(
      `${url.hostname} svarede ${response.status}${body ? ` — ${body}` : ''}`,
    );
  }

  const type = response.headers.get('content-type') ?? '';
  const text = await response.text();
  if (text.length > MAX_BYTES) throw new PublicationError('udgivelsen er for stor');

  // A link straight to the document itself is just as good a source as
  // the viewer around it, and costs one branch.
  if (type.includes('json')) return JSON.parse(text);

  return extractIncito(text);
}

/**
 * The document out of a viewer page.
 *
 * Exported because it is the only part of this file worth testing: the
 * encoding is the surprise here — the JSON is `encodeURIComponent`'d
 * inside the script tag, so a plain `JSON.parse` of the tag's contents
 * fails on the very first character.
 */
export function extractIncito(html: string): unknown {
  const found = /<script id="incito-data"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (!found) {
    throw new PublicationError(
      'siden indeholder ingen incito-udgivelse — er linket til en avis hos Tjek?',
    );
  }
  const raw = found[1]!.trim();
  try {
    return JSON.parse(raw.startsWith('{') ? raw : decodeURIComponent(raw));
  } catch (error) {
    throw new PublicationError(
      `udgivelsen kunne ikke læses: ${error instanceof Error ? error.message : 'ugyldig JSON'}`,
    );
  }
}
