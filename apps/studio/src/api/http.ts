/** The one door to the API: base path, headers, the image key, and how a refusal is read. */


export const BASE = '/api';

/**
 * Which chain this session is acting as.
 *
 * Sent on every scoped request as a header. Today it is a picker in the
 * toolbar; when real sign-in arrives, this module is the only place that
 * changes — the rest of the studio already assumes it can only ever see
 * one chain's catalogues, layouts and feed.
 */
export const BRAND_HEADER = 'x-incitio-brand';

/**
 * Where the editor's own key for the image model is carried.
 *
 * The alternative is `GEMINI_API_KEY` in the server's `.env`, and it
 * stays the default. This is for the ordinary case where the person
 * with the key is not the person who started the server: they paste it
 * into the studio, it lives in THEIR browser, and it rides along on
 * the requests that draw. It is never written to the repo, never sent
 * anywhere but this project's own API, and the server uses it for the
 * one call and forgets it.
 */
export const KEY_HEADER = 'x-gemini-key';

/** Survives a reload, and only in this browser. */
const KEY_STORE = 'incitio.geminiKey';

let imageKey = read();

function read(): string {
  try {
    return window.localStorage.getItem(KEY_STORE) ?? '';
  } catch {
    // Private browsing. The key still works for this session.
    return '';
  }
}

/** Whether a key is in hand. Never the key itself — nothing needs it. */
export function hasImageKey(): boolean {
  return imageKey.trim().length > 0;
}

/** The last four characters, for showing that the right one is in. */
export function imageKeyTail(): string {
  const value = imageKey.trim();
  return value.length > 4 ? value.slice(-4) : '';
}

/** Keep it, or forget it when given an empty string. */
export function setImageKey(value: string): void {
  imageKey = value.trim();
  try {
    if (imageKey) window.localStorage.setItem(KEY_STORE, imageKey);
    else window.localStorage.removeItem(KEY_STORE);
  } catch { /* private browsing; it holds for this session */ }
}

export function headers(brandId: string, extra: Record<string, string> = {}): HeadersInit {
  return {
    [BRAND_HEADER]: brandId,
    // Only when there is one: an empty header would override nothing
    // and confuse a proxy.
    ...(imageKey ? { [KEY_HEADER]: imageKey } : {}),
    ...extra,
  };
}

export async function fail(response: Response): Promise<never> {
  // The session ran out or was ended elsewhere: the sign-in screen takes over — see `session.ts`.
  if (response.status === 401) window.dispatchEvent(new Event(SIGNED_OUT_EVENT));
  const body = (await response.json().catch(() => ({}))) as {
    detail?: string;
    error?: string;
    issues?: { path?: (string | number)[]; message?: string }[];
  };
  /*
   * A rejected body says WHICH field was wrong.
   *
   * "invalid request" on its own cost an afternoon: a route capped its
   * product list at eight, the studio started sending a whole page's
   * worth, and the only thing on screen was the file name and those
   * two words. The server already sends `issues`; not showing them was
   * the whole of the mystery.
   */
  const issue = body.issues?.[0];
  const said = body.detail ?? body.error ?? `${response.status} ${response.statusText}`;
  throw new Error(issue?.message
    ? `${said} (${[...(issue.path ?? [])].join('.') || 'body'}: ${issue.message})`
    : said);
}

/** Fired when the API answers 401, so the studio can ask for a sign-in instead of showing an error. */
export const SIGNED_OUT_EVENT = 'incitio:signed-out';

export interface SignedInUser {
  id: string;
  email: string;
  name: string;
  brands: { brandId: string; role: string }[];
}
