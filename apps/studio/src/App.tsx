import { useEffect } from "react";
import { ImagePage, PageView } from "@incitio/renderer";
import {
  brandCapacities,
  resolveTemplate,
  templatesForCount,
} from "@incitio/brands";
import { packLimits, pageTextLimits, partLimits } from "@incitio/schema";
import { useStudio } from "./state.js";
import { Steps, stepOf } from "./Steps.js";
import { Inspector } from "./Inspector.js";
import { TileEditor } from "./TileEditor.js";
import { PageTextEditor } from "./PageTextEditor.js";
import { Comparison, Reproduce } from "./Reproduce.js";
import { DecorBar } from "./DecorBar.js";
import { Ways } from "./Ways.js";
import { Library } from "./Library.js";

/**
 * Put a whole-sheet picture into the book here.
 *
 * Under each sheet rather than in a toolbar: where the page goes is the
 * decision being made, and the button sits at the seam.
 */
function InsertImage({ at }: { at: number }) {
  const addImagePage = useStudio((s) => s.addImagePage);
  const busy = useStudio((s) => Boolean(s.busy));

  return (
    <label
      className={`insert${busy ? " insert--busy" : ""}`}
      title="Læg en billedside ind her"
    >
      <input
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        disabled={busy}
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) await addImagePage(at, file);
        }}
      />
      <span>+ Tilføj billedside</span>
    </label>
  );
}

export function App() {
  const s = useStudio();

  useEffect(() => {
    void s.start();
  }, []);

  /*
   * Keyboard, for the two things a pointer is bad at: history, and
   * moving something by a known, repeatable amount. Ignored while the
   * caret is in a field, or typing "z" in a headline would undo.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      /*
       * Read at the moment the key is pressed, not when the listener
       * was bound.
       *
       * This effect used to close over the rendered `s` and list what
       * it read in its dependencies, which works right up until
       * somebody reads one thing and forgets to list it. That happened:
       * `selectedPack` was read and not listed, so picking a second
       * product of a cluster left the listener holding the first, and
       * + and − went on resizing the product you had just stopped
       * pointing at. Clicking out of the tile and back in fixed it,
       * because THAT changed something the list did contain.
       *
       * A dependency list is the wrong tool for this: the handler reads
       * a dozen things and the store is the one place that always has
       * them current. So it asks. The listener binds once and nothing
       * it reads can go stale.
       */
      const s = useStudio.getState();
      const target = event.target as HTMLElement | null;
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable === true;

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) s.redo();
        else s.undo();
        return;
      }

      if (typing || event.metaKey || event.ctrlKey) return;

      /*
       * A page's own line answers the same keys as a tile's box.
       *
       * Handled first and returned from, because the two selections are
       * mutually exclusive by construction — see `selectPageText` — and
       * because a heading in hand is what the person is looking at.
       */
      const text = s.selectedText;
      if (text) {
        if (event.key === "Escape") {
          event.preventDefault();
          s.selectPageText(text.pageId, null);
          return;
        }
        const { step, coarse } = pageTextLimits();
        const far = event.shiftKey ? coarse : step;
        const moves: Record<string, [number, number]> = {
          ArrowLeft: [-far, 0],
          ArrowRight: [far, 0],
          ArrowUp: [0, -far],
          ArrowDown: [0, far],
        };
        const step2 = moves[event.key];
        if (step2) {
          event.preventDefault();
          s.nudgePageText(text.pageId, text.part, step2[0], step2[1]);
          return;
        }
        if (event.key === "+" || event.key === "=") {
          event.preventDefault();
          s.scalePageText(text.pageId, text.part, 0.05);
          return;
        }
        if (event.key === "-") {
          event.preventDefault();
          s.scalePageText(text.pageId, text.part, -0.05);
          return;
        }
        if (event.key === "0") {
          event.preventDefault();
          s.resetPageText(text.pageId, text.part);
          return;
        }
        if (event.key === "Backspace" || event.key === "Delete") {
          event.preventDefault();
          s.setPageTextHidden(text.pageId, text.part, true);
          s.selectPageText(text.pageId, null);
        }
        // Everything else belongs to whatever is selected elsewhere,
        // and with a line in hand nothing else is.
        return;
      }

      const offerId = s.selectedOfferId;
      if (!offerId) return;

      /*
       * The keys act on whichever box is in hand, and the artwork is
       * what "the tile" means when no box has been named. That is what
       * keeps the shortcuts people already learned working unchanged
       * while making all nine boxes reachable with the same four keys.
       */
      const part = s.selectedPart ?? "media";
      /*
       * One product of a cluster, when one is in hand. It answers the
       * same keys as every box — move, resize, reset, take off the page
       * — plus two of its own for turning it, because a pasted-on
       * product is the one thing on a printed page that may sit
       * off-square.
       */
      const item = s.selectedPack;

      if (event.key === "Escape") {
        event.preventDefault();
        // Out of the variant, then out of the box, then out of the
        // tile. Each Escape gives back exactly one thing.
        if (item !== null) s.selectPackItem(null);
        else if (s.selectedPart) s.selectPart(null);
        else s.select(null);
        return;
      }

      if (item !== null) {
        const { step, coarse } = packLimits();
        const far = event.shiftKey ? coarse : step;
        const moves: Record<string, [number, number]> = {
          ArrowLeft: [-far, 0],
          ArrowRight: [far, 0],
          ArrowUp: [0, -far],
          ArrowDown: [0, far],
        };
        const step2 = moves[event.key];
        if (step2) {
          event.preventDefault();
          s.nudgePackItem(offerId, item, step2[0], step2[1]);
          return;
        }
        if (event.key === "+" || event.key === "=") {
          event.preventDefault();
          s.scalePackItem(offerId, item, 0.05);
          return;
        }
        if (event.key === "-") {
          event.preventDefault();
          s.scalePackItem(offerId, item, -0.05);
          return;
        }
        // The one gesture no other box has. `[` and `]` because they
        // are where a designer's hand already is for rotation.
        if (event.key === "[" || event.key === "]") {
          event.preventDefault();
          s.turnPackItem(offerId, item, event.key === "]" ? 2 : -2);
          return;
        }
        if (event.key === "0") {
          event.preventDefault();
          s.resetPackItem(offerId, item);
          return;
        }
        if (event.key === "Backspace" || event.key === "Delete") {
          event.preventDefault();
          s.setPackItemHidden(offerId, item, true);
          s.selectPackItem(null);
          return;
        }
        // Everything else belongs to the tile; with a variant in hand
        // nothing else is.
        return;
      }

      // A nudge is one step, or the coarse step with shift — the same
      // pair an image editor gives its arrow keys, sized per box
      // because the artwork counts in frames and the rest in page
      // percent. See `partLimits`.
      const { step, coarse } = partLimits(part);
      const distance = event.shiftKey ? coarse : step;
      const nudge: Record<string, [number, number]> = {
        ArrowLeft: [-distance, 0],
        ArrowRight: [distance, 0],
        ArrowUp: [0, -distance],
        ArrowDown: [0, distance],
      };
      const move = nudge[event.key];
      if (move) {
        event.preventDefault();
        s.nudgePart(offerId, part, move[0], move[1]);
        return;
      }
      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        s.scalePart(offerId, part, 0.05);
      }
      if (event.key === "-") {
        event.preventDefault();
        s.scalePart(offerId, part, -0.05);
      }
      if (event.key === "0") {
        event.preventDefault();
        s.resetPart(offerId, part);
      }
      /*
       * Delete takes the box off the page rather than deleting
       * anything. Not offered for the artwork: a tile with no picture
       * is a layout with a hole in it, and the way to lose the picture
       * is to have no picture in the feed.
       */
      if (
        (event.key === "Backspace" || event.key === "Delete") &&
        part !== "media"
      ) {
        event.preventDefault();
        s.setPartHidden(offerId, part, true);
        s.selectPart(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // Nothing: the handler reads the store itself — see the note above.
  }, []);

  const offers = new Map(
    (s.document?.offers ?? []).map((offer) => [offer.id, offer]),
  );
  /*
   * Offers the document carries that no page is showing.
   *
   * Read once per render and handed to every page bar, because it is
   * what decides whether a page can be made bigger — and a count a
   * person can pick but the document cannot fill is a control that
   * lies.
   */
  const bench = s.benched();

  /*
   * Which step the toolbar should be shouting about.
   *
   * Read from the same function the step strip uses — see `stepOf`. Two
   * places working it out separately is two places that can disagree,
   * and the whole point of one highlighted button is that it agrees
   * with the lit step.
   */
  const step = stepOf({
    feed: s.feed,
    pages: s.document?.pages.length ?? 0,
    touched: s.past.length > 0,
  });

  return (
    <div className="app">
      <header className="bar">
        <strong className="bar__mark">Incitio</strong>

        {/*
          * Grouped in the order the work happens.
          *
          * Ten controls on one line is a wall: nothing in it said that
          * the feed comes before the pages, or that undo belongs to
          * neither. Three groups with a rule between them say it
          * without a word of explanation — the avis you are in, what
          * goes on its pages, and the way out. Exactly one button is
          * lit at a time, and it is the one the step strip below is
          * talking about.
          */}
        <div className="bar__group" role="group" aria-label="Avisen">
          {/* Stands in for signing in. Everything below is scoped to it. */}
          <label className="field">
            <span>Kæde</span>
            <select
              value={s.brandId ?? ""}
              onChange={(e) => void s.signInAs(e.target.value)}
              disabled={Boolean(s.busy)}
            >
              {s.brands.map((brand) => (
                <option key={brand.id} value={brand.id}>
                  {brand.name}
                </option>
              ))}
            </select>
          </label>

          {/*
           * Yesterday's work, reopened for nothing.
           *
           * Every rebuilt page cost a model call and every run is saved
           * the moment it finishes, so this is the difference between
           * checking what a change did to last week's avis and paying to
           * find out. It is a picker rather than a button because the
           * question is always "which one".
           */}
          {s.catalogues.length > 0 && (
            <label className="field" title="Åbn en gemt avis — koster ingenting">
              <span>Åbn</span>
              <select
                value=""
                disabled={Boolean(s.busy)}
                onChange={(e) => {
                  void s.openCatalogue(e.target.value);
                }}
              >
                <option value="">{s.catalogues.length} gemte…</option>
                {s.catalogues.map((saved) => (
                  <option key={saved.id} value={saved.id}>
                    {saved.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          <button
            onClick={() => void s.save()}
            disabled={!s.document || Boolean(s.busy)}
          >
            Gem
          </button>
        </div>

        <div className="bar__rule" aria-hidden="true" />

        <div className="bar__group" role="group" aria-label="Indhold">
          <label
            className={`upload${step === "varer" ? " upload--accent" : ""}`}
            title="Upload denne uges feed"
          >
            <input
              type="file"
              accept=".csv,.json,.txt"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) await s.uploadFeed(file.name, await file.text());
              }}
            />
            <span>Upload feed</span>
          </label>

          {/* The way a catalogue is made: hand in the pages you want.
              Kept beside the feed upload because it takes the same feed. */}
          <button
            className={
              s.reproduceOpen ? "primary" : step === "sider" ? "accent" : ""
            }
            onClick={() => s.setReproduceOpen(!s.reproduceOpen)}
            title="Genskab trykte sider med denne uges varer"
          >
            Genskab sider
          </button>

          {/*
           * "Generér med AI" used to stand here: a brief in, a whole
           * book out, planned by the model from nothing but the feed.
           * It is gone. Pages made that way were generically correct
           * and never looked like the chain, because the model was
           * asked to invent a design instead of being shown one —
           * which is exactly what `Genskab sider` does instead.
           *
           * What is left is the plain draft: category order into the
           * chain's own layouts, no model, no key, instant. It is the
           * fast look at a feed, not the way to a page worth printing.
           */}
          <button
            onClick={() => void s.build({ fresh: true })}
            disabled={Boolean(s.busy) || !s.feed}
            title="Hurtigt udkast direkte fra feedet — kategorisortering, ingen model"
          >
            Hurtigt udkast
          </button>

          <label className="field" title="Hvor mange sider avisen må fylde">
            <span>Sider</span>
            <input
              type="number"
              min={1}
              max={60}
              value={s.maxPages}
              onChange={(e) => s.setMaxPages(Number(e.target.value))}
            />
          </label>

          {/* Said once, where the count is set, rather than on every page
              bar: it is one fact about the document, not six. */}
          {bench.length > 0 && (
            <span
              className="bar__note"
              title={bench.map((o) => o.name).join("\n")}
            >
              {bench.length} i reserve
            </span>
          )}
        </div>

        <div className="bar__gap" />

        {/* Neither a step nor a stage: the two that undo one. Drawn as
            marks rather than words so they stop competing with the
            things a person is meant to press. */}
        <div className="bar__group bar__group--quiet">
          <button onClick={s.undo} disabled={s.past.length === 0} title="Fortryd (⌘Z)">
            ↶
          </button>
          <button onClick={s.redo} disabled={s.future.length === 0} title="Gentag (⇧⌘Z)">
            ↷
          </button>
        </div>

        <div className="bar__rule" aria-hidden="true" />

        <button
          className={step === "pdf" ? "accent" : ""}
          onClick={() => void s.downloadPdf()}
          disabled={!s.document || Boolean(s.busy)}
        >
          Hent PDF
        </button>
      </header>

      <Steps />

      <DecorBar />
      <Ways />

      {/*
       * Where the work is, said in one place.
       *
       * It used to be the label of whichever button started it — which
       * worked while a run was one click and one page. A run of eight
       * references closes the panel it was started from and takes
       * minutes, so the progress has to live somewhere that is still
       * on screen while the pages appear underneath it.
       */}
      {s.busy && (
        <div className="banner banner--busy">
          <span className="spinner" aria-hidden="true" /> {s.busy}
        </div>
      )}
      {s.error && <div className="banner banner--error">{s.error}</div>}
      {s.note && !s.error && !s.busy && (
        <div className="banner banner--ok">{s.note}</div>
      )}
      {s.brand && !s.curationReady && (
        <div className="banner banner--hint">
          Sider kan ikke genskabes uden nøgle. Læg din i <code>.env</code> som{" "}
          <code>ANTHROPIC_API_KEY=sk-ant-…</code> og genstart API-serveren.
        </div>
      )}
      {s.brand && s.curationReady && !s.decorReady && (
        <div className="banner banner--hint">
          Stemningsbilleder er slået fra. Læg <code>GEMINI_API_KEY=…</code> i{" "}
          <code>.env</code> og genstart API-serveren. Billedmodellerne kræver
          desuden fakturering på Google-projektet.
        </div>
      )}

      <Reproduce />

      <div className="app__body">
        <Library />
        <main
          className="canvas"
          // Clicking the paper around the pages drops the selection, the
          // way clicking the canvas does in a drawing tool.
          onPointerDown={(event) => {
            if (event.target !== event.currentTarget) return;
            s.select(null);
            s.selectDecor(null);
          }}
        >
          {/*
            * The empty page, as a page.
            *
            * What to do next is said once, in the step strip — see
            * `Steps`. This used to say it again, in different words,
            * two inches lower; two sentences telling somebody to press
            * the same button is how a screen stops being read at all.
            * What is left is the shape of what they are about to get.
            */}
          {!s.document && s.brand && (
            <div className="blank">
              <div className="blank__sheet" aria-hidden="true" />
              <p className="blank__said">
                {s.feed
                  ? `Ingen sider endnu — feedet er klar (${s.feed.source}).`
                  : "Ingen sider endnu."}
              </p>
            </div>
          )}

          {s.document &&
            s.brand &&
            s.document.pages.map((page, index) => {
              const brand = s.brand!;
              if (page.kind === "image") {
                return (
                  <div className="sheet" key={page.id}>
                    <div className="sheet__bar sheet__bar--image">
                      <span className="sheet__kind">Billedside</span>
                      <span className="sheet__said">
                        {page.background?.subject || "uden navn"}
                      </span>
                      <div className="sheet__does">
                        <label className="sheet__image" title="Skift billedet">
                          <input
                            type="file"
                            accept="image/png,image/jpeg,image/webp,image/gif"
                            onChange={async (e) => {
                              const file = e.target.files?.[0];
                              e.target.value = "";
                              if (file) await s.replaceImagePage(page.id, file);
                            }}
                          />
                          <span>Skift</span>
                        </label>
                        <div className="sheet__order">
                          <button
                            title="Tidligere i avisen"
                            onClick={() => s.movePage(page.id, -1)}
                            disabled={index === 0}
                          >
                            ↑
                          </button>
                          <button
                            title="Senere i avisen"
                            onClick={() => s.movePage(page.id, 1)}
                            disabled={index === s.document!.pages.length - 1}
                          >
                            ↓
                          </button>
                        </div>
                        <button
                          className="sheet__drop"
                          title="Tag siden ud af avisen"
                          onClick={() => s.removePage(page.id)}
                        >
                          ×
                        </button>
                      </div>
                    </div>
                    <ImagePage
                      page={page}
                      brand={brand}
                      pageIndex={index}
                      pageNumber={index + 1}
                    />
                    <InsertImage at={index + 1} />
                  </div>
                );
              }
              // Resolved within this chain's own set — a template id from
              // another chain simply does not exist here.
              // The chain's own layouts, then any the document brought
              // with it — a page rebuilt from a reference sits on a grid
              // nobody drew for the chain. See `CatalogDocument.templates`.
              const template =
                resolveTemplate(brand, page.templateId) ??
                s.document!.templates.find((t) => t.id === page.templateId);
              if (!template) {
                return (
                  <div className="sheet" key={page.id}>
                    <div className="page page--error">
                      Ukendt skabelon: {page.templateId}
                    </div>
                  </div>
                );
              }
              // How this page was read, when it was rebuilt from one. A
              // page from the plain draft simply has none.
              const run = s.reproductions.find((r) => r.pageId === page.id);

              /*
               * The two pickers have to describe THIS page, not only the
               * chain's vocabulary.
               *
               * A page read off a published leaflet — or grown a cell by
               * hand — sits on a layout the chain does not have and at a
               * count the chain may not offer. Listing only the chain's
               * answers made both selects show something that was not
               * true of the page in front of you: nine offers displayed
               * as "2", and a layout name that belonged to a different
               * grid. The page's own count and its own layout are added
               * to the lists so the controls say what is actually there;
               * picking one of the chain's remains exactly as it was.
               */
              const counts = brandCapacities(brand).includes(
                page.placements.length,
              )
                ? brandCapacities(brand)
                : [...brandCapacities(brand), page.placements.length].sort(
                    (a, b) => a - b,
                  );
              const layouts = templatesForCount(
                brand,
                page.placements.length,
              ).some((option) => option.id === template.id)
                ? templatesForCount(brand, page.placements.length)
                : [
                    template,
                    ...templatesForCount(brand, page.placements.length),
                  ];
              return (
                /*
                 * A picture can simply be dropped on the sheet.
                 *
                 * The button in the bar is the discoverable route; this is
                 * the one a designer with a folder open actually uses.
                 * `preventDefault` on dragover is what makes a drop land
                 * at all — without it the browser navigates away from the
                 * editor and opens the JPEG.
                 */
                <div
                  /*
                   * The page under the pointer becomes the page products
                   * land on. The library's own picker still overrides it
                   * — this is the default, not the decision.
                   */
                  className={`sheet${s.activePageId === page.id ? " sheet--active" : ""}`}
                  key={page.id}
                  onPointerDownCapture={() => s.setActivePage(page.id)}
                  onDragOver={(event) => {
                    if (event.dataTransfer.types.includes("Files"))
                      event.preventDefault();
                  }}
                  onDrop={async (event) => {
                    const file = [...event.dataTransfer.files].find((f) =>
                      f.type.startsWith("image/"),
                    );
                    if (!file) return;
                    event.preventDefault();
                    await s.addPageImage(page.id, file);
                  }}
                >
                  {run && <Comparison run={run} />}
                  {/*
                   * The page's own bar, in two halves.
                   *
                   * Left is what the page SAYS and grows with the window;
                   * right is what it IS — how many offers, in what shape,
                   * where it sits in the book — and keeps its width, so
                   * the controls do not move sideways from sheet to
                   * sheet with the length of a heading.
                   *
                   * "Sæt i fokus" used to sit here and does not any more.
                   * It acts on the SELECTED offer, so it was disabled on
                   * every sheet but one and wrapped onto two lines while
                   * doing nothing; it lives in the inspector now, beside
                   * everything else that acts on the selection.
                   */}
                  <div className="sheet__bar">
                    <div className="sheet__said">
                      <input
                        className="sheet__title"
                        value={page.title}
                        placeholder="overskrift"
                        onChange={(e) =>
                          s.setPageTitle(page.id, e.target.value)
                        }
                      />

                      {/* The theme line, beside the heading because that is
                      where it prints. Placeholder rather than a label:
                      most pages carry none, and an empty labelled field
                      on every sheet reads as something missing. */}
                      <input
                        className="sheet__subtitle"
                        value={page.subtitle}
                        placeholder="stemningslinje"
                        onChange={(e) =>
                          s.setPageSubtitle(page.id, e.target.value)
                        }
                      />
                    </div>

                    <div className="sheet__does">
                      <div className="sheet__tools">
                        {/* How many offers this page carries. A count the
                        bench cannot fill is offered but disabled, so the
                        reason a page will not grow is visible rather
                        than being a click that does nothing. */}
                        <label className="sheet__pick">
                          <span>Varer</span>
                          <select
                            value={page.placements.length}
                            onChange={(e) =>
                              s.setPageCount(page.id, Number(e.target.value))
                            }
                          >
                            {counts.map((count) => (
                              <option
                                key={count}
                                value={count}
                                disabled={
                                  count > page.placements.length + bench.length
                                }
                              >
                                {count}
                              </option>
                            ))}
                          </select>
                        </label>

                        <label className="sheet__pick">
                          <span>Layout</span>
                          <select
                            value={page.templateId}
                            onChange={(e) =>
                              s.setPageTemplate(page.id, e.target.value)
                            }
                          >
                            {layouts.map((option) => (
                              <option key={option.id} value={option.id}>
                                {option.name}
                              </option>
                            ))}
                          </select>
                        </label>

                        <button
                          title="Næste layout med lige så mange varer"
                          onClick={() => s.shufflePage(page.id)}
                          disabled={
                            templatesForCount(brand, page.placements.length)
                              .length < 2
                          }
                        >
                          ⟳
                        </button>
                      </div>

                      {/* The chain's own artwork. A label rather than a
                      button because it opens a file picker, and the
                      same files can simply be dropped on the sheet. */}
                      <label
                        className="sheet__image"
                        title="Læg et af kædens egne billeder på siden"
                      >
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp,image/gif"
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            e.target.value = "";
                            if (file) await s.addPageImage(page.id, file);
                          }}
                        />
                        <span>Billede</span>
                      </label>

                      {/* The picture the page is printed ON, as opposed to
                      the one laid on top of it. A second control rather
                      than a mode on the first, because the two differ
                      in where the file lands — under the whole sheet,
                      or pinned in a corner at a quarter of its width —
                      and that is not a choice a dropdown beside a file
                      picker makes legible. */}
                      <label
                        className="sheet__image"
                        title="Læg et billede under hele siden"
                      >
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp,image/gif"
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            e.target.value = "";
                            if (file) await s.addPageBackground(page.id, file);
                          }}
                        />
                        <span>
                          {page.background ? "Baggrund ✓" : "Baggrund"}
                        </span>
                      </label>

                      {/*
                        * Every cluster on the sheet, in one errand.
                        *
                        * Here rather than in the tile panel because
                        * that is the whole point: standing six clusters
                        * up one at a time means picking a tile, waiting
                        * for its cutouts, going to Gemini and coming
                        * back — six times. Prepared together, an editor
                        * makes all the pictures in one sitting and
                        * drops the lot back at once.
                        */}
                      {page.placements.some((placement) => (
                        (s.document?.offers.find((o) => o.id === placement.offerId)
                          ?.members.length ?? 0) > 1
                      )) && (
                        <div className="sheet__group">
                          {/* The whole job, with no trip to Gemini's own
                              app: the model composes each cluster here,
                              the composition is read as a layout, and
                              the chain's own cutouts move to match. */}
                          <button
                            className="sheet__clusters"
                            title={s.decorReady
                              ? 'Lad billedmodellen stille alle sidens klynger op'
                              : 'Kræver GEMINI_API_KEY på serveren'}
                            disabled={Boolean(s.busy) || !s.decorReady}
                            onClick={() => void s.standUpClusters(page.id)}
                          >
                            Stil klynger op
                          </button>
                          {/* The way round a missing key, and the way to
                              compose by hand when the model's own
                              arrangement is not good enough. */}
                          <button
                            className="sheet__clusters"
                            title="Hent prompt og udklip til alle sammensatte fliser, til Gemini i hånden"
                            disabled={Boolean(s.busy)}
                            onClick={() => void s.prepareClusters(page.id)}
                          >
                            Til Gemini
                          </button>
                        </div>
                      )}

                      <div className="sheet__order">
                        <button
                          title="Tidligere i avisen"
                          onClick={() => s.movePage(page.id, -1)}
                          disabled={index === 0}
                        >
                          ↑
                        </button>
                        <button
                          title="Senere i avisen"
                          onClick={() => s.movePage(page.id, 1)}
                          disabled={index === s.document!.pages.length - 1}
                        >
                          ↓
                        </button>
                      </div>
                    </div>
                  </div>

                  {/*
                    * The whole sheet's clusters, prepared together.
                    *
                    * One list and ONE drop zone, because the matching
                    * is done by reading: every picture is read against
                    * the page's own products, and the ones it holds say
                    * which tile it belongs to. Nobody pairs a file with
                    * a tile by hand.
                    */}
                  {s.manualPage?.pageId === page.id && (
                    <div className="clusters">
                      <ol className="clusters__list">
                        {s.manualPage.tiles.map((tile) => (
                          <li key={tile.offerId}>
                            <div className="clusters__head">
                              <b>{tile.name}</b>
                              <button
                                className="inspector__link"
                                onClick={() => {
                                  void navigator.clipboard?.writeText(tile.prompt);
                                }}
                              >Kopiér prompt</button>
                            </div>
                            <ul className="clusters__files">
                              {tile.files.map((cut) => (
                                <li key={cut.url}>
                                  {/* Same-origin, so the filename
                                      survives the save — the number in
                                      it is what keeps the order. */}
                                  <a href={cut.url} download={cut.name} title={cut.name}>
                                    <img src={cut.url} alt="" />
                                  </a>
                                </li>
                              ))}
                            </ul>
                          </li>
                        ))}
                      </ol>

                      <label className="clusters__drop">
                        <input
                          type="file"
                          multiple
                          accept="image/png,image/jpeg,image/webp"
                          onChange={async (e) => {
                            const picked = [...(e.target.files ?? [])];
                            e.target.value = "";
                            if (picked.length > 0) {
                              await s.applyClusterLayouts(page.id, picked);
                            }
                          }}
                        />
                        <span>
                          Læg billederne ind — alle på én gang
                          <em>hvert billede finder selv sin flise</em>
                        </span>
                      </label>

                      <button className="inspector__link" onClick={s.closeClusters}>
                        Luk
                      </button>
                    </div>
                  )}

                  {/*
                   * The pictures on this page, only when there are any.
                   *
                   * Its own row rather than more controls in the bar
                   * above: a page usually has none, and a permanently
                   * empty strip on every sheet is exactly the clutter
                   * this bar was just cleared of.
                   */}
                  {page.decorations.length > 0 && (
                    <div className="sheet__images">
                      {page.decorations.map((decor) => (
                        <div
                          className={
                            s.selectedDecorId === decor.id
                              ? "pic is-held"
                              : "pic"
                          }
                          key={decor.id}
                        >
                          {/*
                           * Takes the picture in hand.
                           *
                           * A decoration is painted behind the grid, so on
                           * a full page the pointer lands on a tile every
                           * time and there is nothing to grab. Arming it
                           * here lifts it over the tiles and hands it the
                           * pointer — the same bargain a tile makes when
                           * you click it before dragging its parts.
                           */}
                          <button
                            className="pic__hold"
                            title={
                              s.selectedDecorId === decor.id
                                ? "Slip billedet — så lægger det sig bag varerne igen"
                                : "Tag billedet i hånden, så kan det trækkes på siden"
                            }
                            onClick={() =>
                              s.selectDecor(
                                s.selectedDecorId === decor.id
                                  ? null
                                  : decor.id,
                              )
                            }
                          >
                            <img src={decor.imageUrl} alt="" />
                          </button>
                          <select
                            value={decor.anchor}
                            title="Hvilket hjørne det hænger i"
                            onChange={(e) =>
                              s.updatePageImage(page.id, decor.id, {
                                anchor: e.target.value as typeof decor.anchor,
                              })
                            }
                          >
                            <option value="top-left">↖ øverst venstre</option>
                            <option value="top-right">↗ øverst højre</option>
                            <option value="bottom-left">
                              ↙ nederst venstre
                            </option>
                            <option value="bottom-right">
                              ↘ nederst højre
                            </option>
                          </select>
                          <input
                            type="range"
                            min={5}
                            max={60}
                            value={Math.round(decor.scale * 100)}
                            title="Størrelse, i procent af sidens bredde"
                            onChange={(e) =>
                              s.updatePageImage(page.id, decor.id, {
                                scale: Number(e.target.value) / 100,
                              })
                            }
                            onPointerUp={() => s.endGesture()}
                          />
                          <input
                            type="range"
                            min={-30}
                            max={30}
                            value={decor.rotate}
                            title="Drejning"
                            onChange={(e) =>
                              s.updatePageImage(page.id, decor.id, {
                                rotate: Number(e.target.value),
                              })
                            }
                            onPointerUp={() => s.endGesture()}
                          />
                          <button
                            className="pic__drop"
                            title="Tag billedet af siden"
                            onClick={() => s.removePageImage(page.id, decor.id)}
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  {page.rationale && (
                    <p className="sheet__why">{page.rationale}</p>
                  )}
                  <PageView
                    page={page}
                    template={template}
                    brand={brand}
                    offers={offers}
                    pageIndex={index}
                    pageNumber={index + 1}
                    selectedOfferId={s.selectedOfferId}
                    selectedPart={s.selectedPart}
                    onSelectOffer={s.select}
                    /* The composed pictures the page's clusters were
                     stood up from, each laid over its own tile — see
                     `Ghost`. The answer to "did it use my picture?",
                     drawn rather than described. */
                    ghosts={s.ghosts.filter((entry) => entry.shown)}
                    /* The chain's own pictures are dragged like anything
                     else on the page; the sliders beside them stay for
                     the two things a drag cannot say. */
                    onMoveDecor={(decorId, offset, gesture) =>
                      s.updatePageImage(
                        page.id,
                        decorId,
                        { offsetX: offset.x, offsetY: offset.y },
                        gesture,
                      )
                    }
                    onDecorMoveEnd={s.endGesture}
                    selectedDecorId={s.selectedDecorId}
                    /* The heading and the theme line are moved on the
                     page like everything else; the fields in the bar
                     above stay for typing the words. */
                    textDecorator={(part) => (
                      <PageTextEditor pageId={page.id} part={part} />
                    )}
                    slotDecorator={(slotId) => {
                      const placement = page.placements.find(
                        (p) => p.slotId === slotId,
                      );
                      return (
                        <TileEditor
                          pageId={page.id}
                          slotId={slotId}
                          {...(placement ? { offerId: placement.offerId } : {})}
                        />
                      );
                    }}
                  />
                  <InsertImage at={index + 1} />
                </div>
              );
            })}
        </main>
        <Inspector />
      </div>
    </div>
  );
}
