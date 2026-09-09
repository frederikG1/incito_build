import { CatalogDocument, TemplateLibrary } from '@incitio/schema';
import { parseLabelDictionary, EMPTY_LABEL_DICTIONARY, type LabelDictionary } from '@incitio/ingest';

const BASE = '/api';

export async function fetchCatalog(id: string): Promise<CatalogDocument | null> {
  const response = await fetch(`${BASE}/catalogs/${encodeURIComponent(id)}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`load failed: ${response.status}`);

  const body = (await response.json()) as { document: unknown };
  const parsed = CatalogDocument.safeParse(body.document);
  // A stored document that no longer matches the schema is treated as
  // absent rather than crashing the editor; the caller regenerates.
  return parsed.success ? parsed.data : null;
}

export async function saveCatalog(document: CatalogDocument, label = ''): Promise<void> {
  const query = label ? `?label=${encodeURIComponent(label)}` : '';
  const response = await fetch(`${BASE}/catalogs/${encodeURIComponent(document.id)}${query}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(document),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`save failed: ${response.status} ${detail.slice(0, 200)}`);
  }
}

/**
 * Coalesces a burst of edits into one write. Dragging a tile produces a
 * document mutation per drop, and version history is more useful when it
 * records intentions rather than every intermediate state.
 */
export function createAutosave(delayMs: number, onError: (message: string) => void) {
  let timer: number | undefined;
  let pending: CatalogDocument | null = null;

  return {
    schedule(document: CatalogDocument): void {
      pending = document;
      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const target = pending;
        pending = null;
        timer = undefined;
        if (target) {
          saveCatalog(target).catch((error: unknown) =>
            onError(error instanceof Error ? error.message : String(error)),
          );
        }
      }, delayMs);
    },
    async flush(): Promise<void> {
      if (timer !== undefined) window.clearTimeout(timer);
      timer = undefined;
      const target = pending;
      pending = null;
      if (target) await saveCatalog(target);
    },
  };
}

/**
 * Templates mined from real catalogs by the Python sidecar. Absent on a
 * clean checkout — the caller falls back to the authored library rather
 * than failing, so the app never depends on a harvest having been run.
 */
export async function fetchMinedLibrary(path = '/templates/mined.json'): Promise<TemplateLibrary | null> {
  try {
    const response = await fetch(path);
    if (!response.ok) return null;
    const parsed = TemplateLibrary.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Certification marks, served from the same static root as the feeds.
 * Absent on a clean checkout, in which case labels render as text — the
 * catalog is still correct, just less branded.
 */
export async function fetchLabelDictionary(
  path = '/labels/tjek-labels.json',
): Promise<LabelDictionary> {
  try {
    const response = await fetch(path);
    if (!response.ok) return EMPTY_LABEL_DICTIONARY;
    return parseLabelDictionary(await response.json()).dictionary;
  } catch {
    return EMPTY_LABEL_DICTIONARY;
  }
}

export interface PlannedGroup {
  title: string;
  subtitle: string;
  offerIds: string[];
}

export interface PlanReply {
  groups: PlannedGroup[];
  reasoning: string[];
  usage: { inputTokens: number; outputTokens: number } | null;
}

/** Whether the API has an Anthropic key, so the button can say so up front. */
export async function fetchPlannerStatus(): Promise<boolean> {
  try {
    const response = await fetch(`${BASE}/plan/status`);
    if (!response.ok) return false;
    return Boolean(((await response.json()) as { configured?: boolean }).configured);
  } catch {
    return false;
  }
}

/**
 * Ask the server to plan the pages. The key stays in the server's
 * environment — this request carries offers, not credentials.
 */
export async function planPages(
  offers: { id: string }[],
  body: Record<string, unknown>,
): Promise<PlanReply> {
  const response = await fetch(`${BASE}/plan`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = (await response.json().catch(() => ({}))) as { detail?: string; error?: string };
    throw new Error(detail.detail ?? detail.error ?? `planning failed: ${response.status}`);
  }
  return (await response.json()) as PlanReply;
}
