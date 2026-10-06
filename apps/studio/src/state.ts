import * as api from './api.js';
import { type PlacePromptId } from '@incitio/curator/place-prompt';
import { rememberedWeek, type StudioState } from './state/model.js';
import { type ClusterWay, WAY_KEY, IMAGE_MODEL_KEY, PLACE_MODEL_KEY, STRICT_KEY, PROMPT_KEY, PROMPT_ID_KEY, CHECKS_KEY, remembered, rememberedRuns } from './state/cluster.js';
import { WORK_KEY, work, rememberedStamps, markWork, scheduleAutosave } from './state/saving.js';
import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import './image-route.js';
import { makeContext } from './state/context.js';
import { navigationActions } from './state/actions/navigation.js';
import { catalogueActions } from './state/actions/catalogue.js';
import { reproduceActions } from './state/actions/reproduce.js';
import { decorActions } from './state/actions/decor.js';
import { editingActions } from './state/actions/editing.js';
import { clustersActions } from './state/actions/clusters.js';
import { tileActions } from './state/actions/tile.js';
import { sectionsActions } from './state/actions/sections.js';
import { pagesActions } from './state/actions/pages.js';
import { placingActions } from './state/actions/placing.js';
import { editionsActions } from './state/actions/editions.js';
import { layoutActions } from './state/actions/layout.js';

export { suggestedWeek, MAX_REFERENCE_PAGES, pageNumbers, wholeDocument, count, referenceJobs } from './state/model.js';
export type { ReferenceFile, PageRun, ReferenceJob, PanelKey, StudioView, BookView, StudioState } from './state/model.js';
export { isVariantPiece, isPicturePage, withTemplates } from './state/cluster.js';
export type { Ghost, ClusterWay, ClusterRun, PromptRun } from './state/cluster.js';
export { SHAPE_KEEPS, carryOverrides, benchOf, withFeedFacts, layoutKey, pageInLayout, sameAvis, departmentOfPage, sectionNaming, THUMB_PX, EDITOR_PX } from './state/layout.js';
export type { CellSize } from './state/layout.js';
export { parkedWork } from './state/saving.js';

export const useStudio = create<StudioState>((set, get) => {
  const ctx = makeContext(set, get);
  return {
    brands: [],
    brandId: null,
    brand: null,
    sources: [],
    feed: null,
    document: null,
    week: rememberedWeek(),
    askWeek: null,
    weekOnly: false,
    view: 'bog',
    openPageId: null,
    scrollToPageId: null,
    bookView: 'opslag',
    addPagesOpen: false,
    trayFilter: null,
    savedAt: null,
    goodsShow: null,
    themes: [],
    themesOpen: false,
    saveState: 'saved',
    // Kept across reloads, so the avis parked in this browser is checked against what the server had.
    serverStamps: rememberedStamps(),
    historyOpen: false,
    variantId: null,
    variantBase: null,
    variantNotes: [],
    uploads: [],
    drawer: 'varer',
    panel: null,
    standingUp: [],
    findings: [],
    findingsOpen: remembered(CHECKS_KEY, '1') === '1',
    catalogues: [],
    curationReady: false,
    decorReady: api.hasImageKey(),
    serverKey: false,
    imageKeyTail: api.imageKeyTail(),
    decorModel: '',
    clusterWay: remembered<ClusterWay>(WAY_KEY, 'koordinater'),
    clusterImageModel: remembered(IMAGE_MODEL_KEY, ''),
    clusterPlaceModel: remembered(PLACE_MODEL_KEY, ''),
    placeStrict: remembered(STRICT_KEY, '1') === '1',
    clusterPrompt: remembered(PROMPT_KEY, ''),
    clusterPromptId: remembered<PlacePromptId>(PROMPT_ID_KEY, 'regler'),
    promptRuns: rememberedRuns(),
    clusterRun: null,
    decorNote: '',
    decorStyle: '',
    busy: null,
    error: null,
    note: null,
    reproduceOpen: false,
    references: [],
    reproduceNote: '',
    reproduceAppend: false,
    reproductions: [],
    feedOffers: [],
    feedReading: null,
    sections: [],
    sectionsOpen: false,
    rulesOpen: false,
    rulesSaving: 'saved',
    designEditing: null,
    designsReturn: null,
    designsFromRules: false,
    designsSaving: 'saved',
    sectionsAt: 0,
    feedArrival: null,
    feedChanges: null,
    carryReport: null,
    selectedIncito: null,
    libraryOpen: false,
    librarySearch: '',
    librarySelection: [],
    libraryClosedGroups: [],
    arrangeNote: '',
    activePageId: null,
    publicationUrl: '',
    publicationPages: '',
    publicationAppend: false,
    publicationWithOffers: true,
    layoutCells: 6,
    layoutNote: '',
    layoutAppend: false,
    selectedOfferId: null,
    selectedDecorId: null,
    selectedNoteId: null,
    layoutEditPageId: null,
    selectedPart: null,
    selectedPack: null,
    ghosts: [],
    selectedText: null,
    maxPages: 6,
    past: [],
    future: [],

    ...navigationActions(ctx),
    ...catalogueActions(ctx),
    ...reproduceActions(ctx),
    ...decorActions(ctx),
    ...editingActions(ctx),
    ...clustersActions(ctx),
    ...tileActions(ctx),
    ...sectionsActions(ctx),
    ...pagesActions(ctx),
    ...placingActions(ctx),
    ...editionsActions(ctx),
    ...layoutActions(ctx),
  };
});


/**
 * How long after the last change the document is written down.
 *
 * Long enough that a drag is one write rather than sixty, short
 * enough that a reload two seconds after an edit still has it.
 */
const SAVE_AFTER_MS = 1500;

let saveTimer: number | undefined;

useStudio.subscribe((state, before) => {
  if (state.document === before.document && state.variantBase === before.variantBase) return;
  if (!state.document || (state.document === work.clean.document && state.variantBase === work.clean.base)) return;
  if (state.saveState === 'saved') useStudio.setState({ saveState: 'dirty' });
  if (state.brandId) markWork(state.brandId, false);
  if (state.saveState !== 'conflict') scheduleAutosave();
});

// Closing the tab with work the server does not have yet asks first.
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', (event) => {
    const { saveState, document } = useStudio.getState();
    if (!document || saveState === 'saved') return;
    event.preventDefault();
    event.returnValue = '';
  });
}

/**
 * Keep the open catalogue across a reload.
 *
 * Not a replacement for `Gem`, which puts a named catalogue in the
 * database and is what an editor keeps. This is the other thing: the
 * thing you are in the middle of. The studio reloads all day during a
 * session — Vite hot-reloads on every save, a stylesheet change, a
 * crash, a closed laptop — and every one of those used to mean
 * building the draft again, grouping the products again and running
 * the arrangement again before you were back where you were.
 *
 * In the browser and nowhere else: it is this machine's working
 * state, it never travels, and `Gem` is still the thing that shares
 * it.
 */
/*
 * An edition belongs to the catalogue it was opened from. Anything that
 * puts another catalogue on screen — opening one, a new week, a fresh
 * draft — leaves the edition, or its base would be saved over the new one.
 */
useStudio.subscribe((state) => {
  if (state.variantBase && (!state.document || state.document.id !== state.variantBase.id)) {
    useStudio.setState({ variantBase: null, variantId: null, variantNotes: [] });
  }
});

useStudio.subscribe((state, before) => {
  if (state.document === before.document) return;
  const { brandId } = state;
  if (!brandId) return;
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    // Parked as stored: the base, with an open edition recorded into it.
    const document = useStudio.getState().storedDocument();
    try {
      if (document) {
        window.localStorage.setItem(
          WORK_KEY(brandId),
          JSON.stringify({ at: new Date().toISOString(), document }),
        );
      } else {
        window.localStorage.removeItem(WORK_KEY(brandId));
      }
    } catch {
      /*
       * Out of room, or private browsing. Nothing to do and nothing
       * to say: the catalogue is on screen and `Gem` still works.
       */
    }
  }, SAVE_AFTER_MS);
});
/**
 * The store, but only the fields named — the component re-renders when
 * one of THOSE changes, not on every change anywhere in the studio.
 * `useStudio()` with no selector re-rendered every component that used
 * it on each keystroke and each frame of a drag.
 */
export function useStudioPick<K extends keyof StudioState>(...keys: K[]): Pick<StudioState, K> {
  return useStudio(useShallow((state: StudioState) => {
    const picked = {} as Pick<StudioState, K>;
    for (const key of keys) picked[key] = state[key];
    return picked;
  }));
}
