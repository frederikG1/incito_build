/**
 * The Gemini calls, and nothing else.
 *
 * Plain `fetch` against the REST API rather than `@google/genai`. Two
 * reasons: the whole surface used here is two endpoints and one response
 * shape, and a generated leaflet should not gain a dependency tree to
 * fetch a picture of some almonds. The curator's Anthropic SDK earns its
 * place by doing structured output and streaming; this does not.
 */

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * Text model, for deciding what a page should depict.
 *
 * Pinned, not `gemini-flash-latest`. The alias was the obvious choice
 * and measured badly: it answered a one-line prompt fine and returned
 * 503 "experiencing high demand" to this package's actual request four
 * retries running, while this model answered 4/4 in ~1.2s. An alias
 * points at whatever is under the most load.
 *
 * Pinning has its own cost on this API — `gemini-2.5-flash` and
 * `-flash-lite` both answer "no longer available to new users" today —
 * so expect to move this, and `--model` overrides it without a release.
 */
export const DEFAULT_TEXT_MODEL = 'gemini-3.5-flash';
/**
 * Image model.
 *
 * NOTE: every image-capable model on this API is billing-gated — a key
 * on the free tier gets `limit: 0` and a 429, not a smaller quota. See
 * `describe` below, which says so in as many words rather than letting
 * it read as a transient rate limit.
 */
export const DEFAULT_IMAGE_MODEL = 'gemini-2.5-flash-image';

export interface GeminiOptions {
  apiKey?: string;
  model?: string;
  /** Abort the request after this long. Generation is slow; hanging is worse. */
  timeoutMs?: number;
  /** Tries before giving up, for the statuses `retryable` admits. Default 4. */
  attempts?: number;
}

/** Raised with a message already written for the person running the build. */
export class GeminiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'GeminiError';
  }
}

function key(options: GeminiOptions): string {
  const value = options.apiKey ?? process.env['GEMINI_API_KEY'];
  if (!value) {
    throw new GeminiError(
      'Ingen GEMINI_API_KEY. Sæt den i .env — se .env.example.',
    );
  }
  return value;
}

interface Part { text?: string; inlineData?: { mimeType: string; data: string } }

const sleep = (ms: number) => new Promise((r) => { setTimeout(r, ms); });

/**
 * Whether another attempt could plausibly go differently.
 *
 * 503 is the one that matters in practice: this API hands them out under
 * load, and a longer prompt draws them more often — the six-page subject
 * call got two in a row where a one-line call went straight through. It
 * is not a bad request and the retry costs nothing but a second.
 *
 * A quota-zero 429 is excluded deliberately. It looks like a rate limit
 * and is not one — the model is simply not on this plan — so retrying it
 * loops until the timeout and then reports the wrong cause.
 */
function retryable(status: number, message: string): boolean {
  if (status === 429) return !/limit:\s*0\b/.test(message);
  return status === 503 || status === 500 || status === 502 || status === 504;
}

async function once(
  model: string,
  body: unknown,
  options: GeminiOptions,
): Promise<{ ok: true; payload: Payload } | { ok: false; status: number; message: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 90_000);
  let response: Response;
  try {
    response = await fetch(`${ENDPOINT}/${model}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': key(options), 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new GeminiError(`Gemini svarede ikke inden for ${(options.timeoutMs ?? 90_000) / 1000}s`);
    }
    throw new GeminiError(`Kunne ikke nå Gemini: ${describeNetwork(error)}`);
  } finally {
    clearTimeout(timer);
  }

  const payload = await response.json().catch(() => null) as Payload | null;
  if (response.ok && payload) return { ok: true, payload };
  return { ok: false, status: response.status, message: payload?.error?.message ?? '' };
}

interface Payload {
  candidates?: { content?: { parts?: Part[] } }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  error?: { message?: string };
}

async function call(
  model: string,
  body: unknown,
  options: GeminiOptions,
): Promise<{ parts: Part[]; usage?: { input: number; output: number } }> {
  const attempts = Math.max(1, options.attempts ?? 4);
  let last: { status: number; message: string } | null = null;

  for (let attempt = 0; attempt < attempts; attempt++) {
    const result = await once(model, body, options);
    if (result.ok) {
      const parts = result.payload.candidates?.[0]?.content?.parts ?? [];
      if (parts.length === 0) throw new GeminiError(`${model} returnerede ingen indhold`);
      const meta = result.payload.usageMetadata;
      return {
        parts,
        ...(meta
          ? { usage: { input: meta.promptTokenCount ?? 0, output: meta.candidatesTokenCount ?? 0 } }
          : {}),
      };
    }
    last = result;
    if (attempt === attempts - 1 || !retryable(result.status, result.message)) break;
    // 1s, 2s, 4s, with jitter so a whole book's worth of pages does not
    // come back in lockstep and get throttled together.
    await sleep(2 ** attempt * 1000 + Math.random() * 400);
  }

  throw describe(last!.status, last!.message, model);
}

/** One prompt in, one JSON object out. Throws rather than guessing. */
export async function generateJson<T>(
  prompt: string,
  schema: unknown,
  options: GeminiOptions = {},
): Promise<{ value: T; usage?: { input: number; output: number } }> {
  const model = options.model ?? DEFAULT_TEXT_MODEL;
  const { parts, usage } = await call(model, {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: schema,
      /*
       * Zero, and it is the cache that demands it.
       *
       * `decorStore` keys artwork on the image prompt, which contains
       * the motif wording verbatim. At any temperature above 0 the same
       * page comes back as "a handful of raw almonds" one run and "a
       * loose handful of whole almonds" the next — two different keys,
       * two cache misses, two bills, for one unchanged page. Variety in
       * the phrasing buys nothing here and costs money every rebuild.
       */
      temperature: 0,
    },
  }, options);

  const text = parts.map((p) => p.text ?? '').join('').trim();
  try {
    return { value: JSON.parse(text) as T, ...(usage ? { usage } : {}) };
  } catch {
    throw new GeminiError(`${model} returnerede ugyldig JSON: ${text.slice(0, 160)}`);
  }
}

export interface GeneratedImage {
  bytes: Buffer;
  mimeType: string;
}

/** One prompt in, one image out. */
export async function generateImage(
  prompt: string,
  options: GeminiOptions = {},
): Promise<GeneratedImage> {
  const model = options.model ?? DEFAULT_IMAGE_MODEL;
  const { parts } = await call(model, {
    contents: [{ parts: [{ text: prompt }] }],
  }, options);

  const image = parts.find((p) => p.inlineData);
  if (!image?.inlineData) {
    // A refusal comes back as prose where the picture should be, and
    // that prose is the most useful thing to show.
    const said = parts.map((p) => p.text ?? '').join(' ').trim();
    throw new GeminiError(
      said
        ? `${model} tegnede ikke noget, men svarede: ${said.slice(0, 200)}`
        : `${model} returnerede intet billede`,
    );
  }
  return {
    bytes: Buffer.from(image.inlineData.data, 'base64'),
    mimeType: image.inlineData.mimeType || 'image/png',
  };
}

function describeNetwork(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Turn a status into something actionable.
 *
 * The 429 branch carries the surprise: on this API a free-tier key does
 * not get a small image quota, it gets ZERO, and the refusal arrives as
 * a rate limit. Read literally it says "try again shortly", which is
 * wrong and would send someone into a retry loop forever — the fix is
 * billing, not patience. Told apart by `limit: 0` in the body.
 */
function describe(status: number, message: string, model: string): GeminiError {
  if (status === 429 && /limit:\s*0\b/.test(message)) {
    return new GeminiError(
      `Modellen "${model}" er ikke med i gratis-niveauet — kvoten er 0, ikke opbrugt. `
      + 'Billedgenerering hos Gemini kræver fakturering på Google-projektet '
      + '(https://ai.dev/rate-limit). Teksttrinnet virker uden.',
      status,
    );
  }
  if (status === 429) return new GeminiError('Rate limit hos Gemini — prøv igen om lidt', status);
  if (status === 400 && /API key not valid/i.test(message)) {
    return new GeminiError('Ugyldig API-nøgle — tjek GEMINI_API_KEY i .env', status);
  }
  if (status === 403) return new GeminiError('API-nøglen har ikke adgang til denne model', status);
  if (status === 404) return new GeminiError(`Ukendt model: ${model}`, status);
  if (status >= 500) return new GeminiError('Googles API er nede — prøv igen om lidt', status);
  return new GeminiError(`Gemini-fejl ${status}: ${message.slice(0, 200)}`, status);
}
