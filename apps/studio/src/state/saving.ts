import type { CatalogDocument } from '@incitio/schema';
import { CatalogDocument as CatalogDocumentSchema } from '@incitio/schema';
import { useStudio } from '../state.js';

/* ------------------------------------------- the work, kept in place */

/**
 * Where the open catalogue is parked between reloads.
 *
 * Per chain, because switching chain is switching document, and a
 * restored SuperBrugsen page on Netto's sheet would be nonsense.
 */
export const WORK_KEY = (brandId: string) => `incitio.work.${brandId}`;

/*
 * Saving to the server as the avis is worked on.
 *
 * `clean` is the document as last saved or opened — compared by
 * reference, which is free: every edit makes a new document. Anything
 * else on screen is unsaved, and a few seconds after the last change it
 * is saved under "auto". The server folds automatic saves ten minutes
 * apart into one point of the history, so this can run as often as it
 * likes.
 */
export const AUTOSAVE_AFTER_MS = 2500;
/**
 * The save's own bookkeeping, shared by the actions that save and the
 * subscription that schedules it: the autosave timer, the document as
 * the server last had it (`clean`), and the save in flight.
 */
export const work = {
  autosaveTimer: undefined as number | undefined,
  clean: { document: null, base: null } as { document: CatalogDocument | null; base: CatalogDocument | null },
  saving: null as Promise<void> | null,
  /** The debounced saves of the chain's offer rules and offer designs. */
  rulesTimer: undefined as number | undefined,
  designsTimer: undefined as number | undefined,
};

// A literal, not a const: this runs while the store is being created, above any const below.
export function rememberedStamps(): Record<string, string> {
  try {
    return JSON.parse(window.localStorage.getItem('incitio.serverStamps') ?? '{}') as Record<string, string>;
  } catch {
    return {};
  }
}
export function rememberStamp(id: string, updatedAt: string): Record<string, string> {
  const stamps = { ...useStudio.getState().serverStamps, [id]: updatedAt };
  try { window.localStorage.setItem('incitio.serverStamps', JSON.stringify(stamps)); } catch { /* private window */ }
  return stamps;
}

/** Whether the avis parked in this browser was also on the server — see the restore in `signInAs`. */
export function markWork(brandId: string, saved: boolean): void {
  try { window.localStorage.setItem(`incitio.workSaved.${brandId}`, saved ? '1' : '0'); } catch { /* private window */ }
}
export function workWasSaved(brandId: string): boolean {
  try { return window.localStorage.getItem(`incitio.workSaved.${brandId}`) === '1'; } catch { return false; }
}

export function scheduleAutosave(after = AUTOSAVE_AFTER_MS): void {
  window.clearTimeout(work.autosaveTimer);
  work.autosaveTimer = window.setTimeout(() => {
    const state = useStudio.getState();
    if (state.saveState === 'conflict' || !state.document) return;
    if (state.document === work.clean.document && state.variantBase === work.clean.base) return;
    void state.persist('auto');
  }, after);
}
/** The rules' own save, a moment after the last change — see `setOfferRules`. */

/** What was parked for this chain, if anything still parses. */
export function parkedWork(brandId: string): { at: string; document: CatalogDocument } | null {
  try {
    const raw = window.localStorage.getItem(WORK_KEY(brandId));
    if (!raw) return null;
    const said = JSON.parse(raw) as { at?: unknown; document?: unknown };
    const parsed = CatalogDocumentSchema.safeParse(said.document);
    if (!parsed.success) return null;
    return {
      at: typeof said.at === 'string' ? said.at : '',
      document: parsed.data,
    };
  } catch {
    return null;
  }
}

/*
 * Nothing throws the parked work away on purpose, and nothing needs
 * to: every way of starting something else — a fresh draft, an
 * imported publication, a saved catalogue opened — replaces the
 * document, and the subscription above writes the new one over the
 * old within a second and a half.
 */
