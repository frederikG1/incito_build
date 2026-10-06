import type { CatalogDocument } from '@incitio/schema';
import { mergeCatalogDocuments } from '@incitio/schema';
import { weekName } from '@incitio/schema';
import * as api from '../../api.js';
import { countPages } from '../../pdf.js';
import { type ReferenceFile, type PageRun, wholeDocument, count, referenceJobs, type StudioState } from '../model.js';
import { message, withTemplates, toBase64 } from '../cluster.js';
import { work } from '../saving.js';
import type { StoreContext } from '../context.js';

/** Regler, varedesigns og genskab-en-side fra referencer. */
export function reproduceActions(ctx: StoreContext): Pick<StudioState, 'setReproduceOpen' | 'setRulesOpen' | 'setDesignsOpen' | 'setDesignEditing' | 'setOfferDesigns' | 'setOfferRules' | 'addReferences' | 'setReferencePages' | 'removeReference' | 'moveReference' | 'clearReferences' | 'setReproduceNote' | 'setReproduceAppend' | 'reproduce'> {
  const { set, get, askingWeek, weekId, withWeek } = ctx;
  return {
    setReproduceOpen: (open) => set({ reproduceOpen: open, error: null }),

    setRulesOpen: (open) => set({ rulesOpen: open }),
    setDesignsOpen: (open, how) => {
      const { view, openPageId, designsReturn, document } = get();
      if (open) {
        set({
          view: 'varedesigns',
          designEditing: how?.designId ?? null,
          designsFromRules: Boolean(how?.fromRules),
          // Opened again from the page itself keeps the first way back.
          designsReturn: view === 'varedesigns' ? designsReturn : { view, openPageId },
          rulesOpen: false,
          addPagesOpen: false,
        });
        return;
      }
      const back = designsReturn ?? { view: document ? 'bog' as const : 'hjem' as const, openPageId: null };
      // A page that was deleted meanwhile is the book.
      const page = back.openPageId && document?.pages.some((p) => p.id === back.openPageId) ? back.openPageId : null;
      set({
        view: back.view === 'side' && !page ? 'bog' : back.view === 'hjem' || document ? back.view : 'hjem',
        openPageId: page,
        designEditing: null,
        designsReturn: null,
        designsFromRules: false,
      });
    },
    setDesignEditing: (designId) => set({ designEditing: designId }),

    setOfferDesigns(designs, tag) {
      const { brand, brandId } = get();
      if (!brand || !brandId) return;
      set({ brand: { ...brand, offerDesigns: designs, designTag: tag }, designsSaving: 'saving' });
      window.clearTimeout(work.designsTimer);
      work.designsTimer = window.setTimeout(() => {
        api.saveOfferDesigns(brandId, designs, tag)
          .then(() => { if (get().brandId === brandId) set({ designsSaving: 'saved' }); })
          .catch(() => { if (get().brandId === brandId) set({ designsSaving: 'failed' }); });
      }, 600);
    },

    setOfferRules(rules) {
      const { brand, brandId } = get();
      if (!brand || !brandId) return;
      set({ brand: { ...brand, offerRules: rules }, rulesSaving: 'saving' });
      window.clearTimeout(work.rulesTimer);
      work.rulesTimer = window.setTimeout(() => {
        api.saveOfferRules(brandId, rules)
          .then(() => { if (get().brandId === brandId) set({ rulesSaving: 'saved' }); })
          .catch(() => { if (get().brandId === brandId) set({ rulesSaving: 'failed' }); });
      }, 600);
    },

    /*
     * The files, read once and kept as base64.
     *
     * Appended rather than replaced: picking four files and then
     * remembering a fifth is the normal way this list is built, and a
     * picker that threw the first four away would be a trap. A file
     * that cannot be read is reported by name and the rest still land.
     */
    async addReferences(files: File[]) {
      if (files.length === 0) return;
      set({ busy: files.length > 1 ? `Læser ${files.length} filer…` : 'Læser referencen…', error: null });
      const added: ReferenceFile[] = [];
      const failed: string[] = [];
      for (const file of files) {
        try {
          const bytes = new Uint8Array(await file.arrayBuffer());
          // Read from the bytes, not the name: what matters is whether a
          // page has to be picked out of it.
          const isPdf = String.fromCharCode(...bytes.subarray(0, 5)) === '%PDF-';
          const pageCount = isPdf ? await countPages(bytes) : null;
          added.push({
            id: `ref-${Date.now().toString(36)}-${added.length}-${Math.random().toString(36).slice(2, 7)}`,
            name: file.name,
            base64: toBase64(bytes),
            isPdf,
            pageCount,
            /*
             * The whole file, not its first page.
             *
             * A chain hands in last week's avis as one PDF, and a row
             * that defaults to "1" reads as a tool that can only see the
             * front page — which is what it looked like. The field is
             * still the editor's: it is filled in, not locked, and
             * nothing is spent until the run button is pressed. What a
             * long file costs is on the button itself, in pages and
             * minutes, beside the cap.
             */
            pages: wholeDocument(pageCount),
          });
        } catch (error) {
          failed.push(`${file.name} (${message(error)})`);
        }
      }
      const references = [...get().references, ...added];
      set({
        references,
        busy: null,
        ...(failed.length > 0 ? { error: `Kunne ikke læse ${failed.join(', ')}` } : {}),
        note: added.length > 0
          ? `${count(referenceJobs(references).length, 'side', 'sider')} klar til at blive genskabt`
          : null,
      });
    },

    setReferencePages: (id, spec) => set({
      references: get().references.map((reference) => (reference.id === id
        // Kept as typed, not as parsed: a half-typed "1-" has to stay
        // on screen long enough to become "1-6".
        ? { ...reference, pages: spec.slice(0, 40) }
        : reference)),
    }),

    removeReference: (id) => set({
      references: get().references.filter((reference) => reference.id !== id),
    }),

    moveReference(id, delta) {
      const references = [...get().references];
      const at = references.findIndex((reference) => reference.id === id);
      const to = at + delta;
      if (at < 0 || to < 0 || to >= references.length) return;
      const [moved] = references.splice(at, 1);
      references.splice(to, 0, moved!);
      set({ references });
    },

    clearReferences: () => set({ references: [], error: null }),

    setReproduceNote: (note) => set({ reproduceNote: note }),
    setReproduceAppend: (append) => set({ reproduceAppend: append }),

    /*
     * The rebuilt pages arrive as ordinary documents, so everything the
     * editor already does — dragging a tile, nudging a price, saving,
     * printing — works on them unchanged.
     *
     * One request per page, in order, and the reason is worth keeping:
     *
     *  - each page is told which offers the pages before it used, so a
     *    catalogue does not print the same coffee on four spreads;
     *  - the canvas grows a page at a time, so a run of eight is
     *    something you can watch rather than a spinner for six minutes;
     *  - a reference the model cannot read costs that one page, not the
     *    seven that already worked.
     *
     * The loop lives here rather than on the server because a single
     * request carrying eight model calls would be cut off by the
     * server's own request timeout long before it answered. The pieces
     * that must not differ between this and the terminal's `matchPages`
     * — what is excluded, and how pages are merged — are shared.
     *
     * The brand is replaced by the one the replies carry, extended with
     * every layout in the run. A page read off a reference sits on a
     * grid that is not in the chain's set, and without it the canvas
     * renders "ukendt skabelon" over a page that is perfectly valid.
     */
    async reproduce() {
      const { brandId, feed, references, reproduceNote, reproduceAppend } = get();
      const jobs = referenceJobs(references);
      if (!brandId || jobs.length === 0) return;
      // These pages cost a model call each and are saved the moment
      // they land, so the week has to be known BEFORE the first one.
      if (askingWeek(() => void get().reproduce())) return;
      const week = get().week;

      /*
       * Adding to what is open, or starting again.
       *
       * Appending is how a whole avis gets built here: four pages, look
       * at them, two more. The document already on the canvas becomes
       * the first part of the merge — hand edits included — and its
       * offers join the exclusion list so the new pages bring new goods.
       */
      const base = reproduceAppend ? get().document : null;
      const parts: CatalogDocument[] = base ? [base] : [];
      const spent = base ? base.offers.map((offer) => offer.id) : [];

      /*
       * Merging renumbers pages by position, so a run that appends
       * moves the ids the old runs were keyed by. Re-keyed here, or the
       * reference shown above page five would be page two's.
       */
      let runs: PageRun[] = base
        ? (() => {
            const moved = new Map(base.pages.map((page, index) => [page.id, `page-${index + 1}`]));
            return get().reproductions.map((run) => ({
              ...run,
              pageId: moved.get(run.pageId) ?? run.pageId,
            }));
          })()
        : [];

      /*
       * A name of its own, so this run does not overwrite the last one.
       *
       * Every run is saved when it finishes — see the end of this
       * function — and a fixed id would mean each rebuilt page quietly
       * replaced the previous one in the store. The whole point of
       * keeping them is that a page cost a model call once.
       *
       * Appending keeps the open catalogue's id: adding two pages to an
       * avis is the same avis, not a new one.
       */
      const stamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 12);
      /*
       * The week names it when there is one.
       *
       * The timestamp below is what this used to be, and it is what
       * made the picker unreadable: every run of every week called
       * itself by the minute it happened. With a week, a second run of
       * week 39 is a new VERSION of week 39's avis — every save
       * appends to the version table, so nothing is lost — and the
       * picker has one line per week, which is how the people making
       * the paper think about it.
       */
      const catalogId = base
        ? base.id
        : (week ? weekId(brandId, week) : `${brandId}-${stamp}`);
      const catalogName = base
        ? base.name
        : (week
          ? weekName(get().brand?.name ?? brandId, week)
          : `${get().brand?.name ?? brandId} · ${new Date().toLocaleString('da-DK', {
            day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
          })}`);

      const failures: { refId: string; name: string; message: string }[] = [];
      const cost = { inputTokens: 0, outputTokens: 0 };
      const started = Date.now();
      set({ busy: 'Claude læser siden…', error: null, note: null, reproduceOpen: false });

      for (const [index, job] of jobs.entries()) {
        set({
          busy: jobs.length > 1
            ? `Claude læser side ${index + 1} af ${jobs.length}…`
            : 'Claude læser siden…',
        });
        try {
          const reply = await api.reproducePage(brandId, {
            file: job.base64,
            feed: feed?.text ?? '',
            referenceName: job.name,
            ...(job.pageNumber ? { pageNumber: job.pageNumber } : {}),
            ...(reproduceNote.trim() ? { note: reproduceNote.trim() } : {}),
            ...(spent.length > 0 ? { exclude: spent } : {}),
          });

          parts.push(reply.document);
          spent.push(...reply.document.offers.map((offer) => offer.id));
          cost.inputTokens += reply.usage.inputTokens;
          cost.outputTokens += reply.usage.outputTokens;

          const document = withWeek(mergeCatalogDocuments(parts, {
            id: catalogId,
            name: catalogName,
          }));
          const landed = document.pages[document.pages.length - 1];
          runs = [...runs, {
            pageId: landed?.id ?? `page-${document.pages.length}`,
            reference: reply.reference,
            referenceName: job.name,
            template: reply.template,
            ground: reply.ground,
            grid: reply.grid,
            casting: reply.casting,
            source: reply.source,
            offersInFeed: reply.offersInFeed,
            poolSize: reply.poolSize,
            rejected: reply.rejected,
            usage: reply.usage,
            elapsedMs: reply.elapsedMs,
          }];

          /*
           * Set after every page, not at the end: the pages appear as
           * they are built. History is cleared rather than appended to
           * — the run is one action, and undoing it a page at a time
           * would leave a catalogue nobody asked for.
           */
          set({
            document,
            brand: withTemplates(reply.brand, document.templates),
            reproductions: runs,
            past: [],
            future: [],
            activePageId: document.pages[document.pages.length - 1]?.id ?? null,
            selectedOfferId: null,
            selectedPart: null,
            selectedPack: null,
            selectedText: null,
          });
        } catch (error) {
          failures.push({ refId: job.refId, name: job.name, message: message(error) });
        }
      }

      const built = runs.length - (base ? base.pages.length : 0);
      const seconds = ((Date.now() - started) / 1000).toFixed(0);
      const spend = (cost.inputTokens * 5 + cost.outputTokens * 25) / 1e6;

      /*
       * What worked leaves the list; what did not stays in it.
       *
       * Otherwise the next run silently rebuilds the pages you already
       * have — and with "læg til" ticked, pays for them twice. A
       * reference that failed is left where it is, because the usual
       * answer to a page the model could not read is to try that one
       * again, not to find the file again.
       */
      /*
       * Saved here rather than left to the Gem button.
       *
       * These pages cost a model call each. Leaving them unsaved means a
       * reload, a chain switch or a second run throws away something
       * that was paid for — and the only way back is to pay again. A
       * failure to save is reported but does not fail the run: the
       * pages are on the canvas either way.
       */
      if (built > 0) {
        const made = get().document;
        if (made) {
          try {
            await api.saveCatalogue(brandId, made, 'genskabt');
            await get().refreshCatalogues();
          } catch (error) {
            failures.push({ refId: '', name: 'gem', message: message(error) });
          }
        }
      }

      const stuck = new Set(failures.map((failure) => failure.refId));
      set({
        busy: null,
        references: get().references.filter((reference) => stuck.has(reference.id)),
        // The run built something, so adding to it is the next likely
        // move; it was opt-in for a run that replaces what is open.
        reproduceAppend: built > 0,
        // Every page failed: there is nothing to look at, so the reason
        // is the whole message rather than a footnote under a result.
        ...(built === 0
          ? { error: failures[0]?.message ?? 'ingen sider kunne genskabes' }
          : {
            error: failures.length > 0
              ? `${count(failures.length, 'side', 'sider')} kunne ikke genskabes: ${failures.map((f) => `${f.name} — ${f.message}`).join(' · ')}`
              : null,
            note: [
              `${count(built, 'side', 'sider')} genskabt`,
              `${seconds}s`,
              `≈ $${spend.toFixed(2)}`,
            ].join(' · '),
          }),
      });
    },
  };
}
