import { useEffect, useRef, useState } from "react";
import { ImagePage, PageView, incitoSlotOf } from "@incitio/renderer";
import { resolveTemplate } from "@incitio/brands";
import { packLimits, pageTextLimits, partLimits } from "@incitio/schema";
import { useStudio } from "./state.js";

import { Inspector } from "./Inspector.js";
import { TileEditor } from "./TileEditor.js";
import { EmptyCells } from "./EmptyCells.js";
import { LayoutEditor } from "./LayoutEditor.js";
import { LayoutGallery } from "./LayoutGallery.js";
import { PageTextEditor } from "./PageTextEditor.js";
import { Comparison, Reproduce } from "./Reproduce.js";
import { DecorBar } from "./DecorBar.js";
import { Ways } from "./Ways.js";
import { Book } from "./Book.js";
import { Pictures } from "./Pictures.js";
import { OFFER_MIME, Tray, droppedOffers } from "./Tray.js";
import { Top } from "./Shell.js";
import { Checklist } from "./Checklist.js";
import { AskWeek } from "./Week.js";
import { SaveSection } from "./Weekly.js";
import { Keys, Palette } from "./Palette.js";

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

/**
 * The page's rarer errands, behind ⋯.
 *
 * Order, a picture page after this one, and taking the page out. They
 * used to be arrows and a cross on every sheet; inside a page they are
 * a menu, because none of them is what you came to the page to do.
 */
function PageMore({ pageId, index }: { pageId: string; index: number }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const count = useStudio((s) => s.document?.pages.length ?? 0);
  const movePage = useStudio((s) => s.movePage);
  const removePage = useStudio((s) => s.removePage);
  const setSectionsOpen = useStudio((s) => s.setSectionsOpen);
  const clearPage = useStudio((s) => s.clearPage);

  return (
    <div className="more">
      <button onClick={() => { setOpen(!open); setSaving(false); }} aria-expanded={open} title="Mere">
        ⋯
      </button>
      {open && (
        <>
          <div className="more__away" onPointerDown={() => setOpen(false)} />
          <div className="more__menu" onClick={() => setOpen(false)}>
            {saving ? (
              <SaveSection pageId={pageId} onDone={() => { setSaving(false); setOpen(false); }} />
            ) : (
              <button onClick={(event) => { event.stopPropagation(); setSaving(true); }}>
                ☆ Gem som sektion…
              </button>
            )}
            <button onClick={() => setSectionsOpen(true, index + 1)}>
              ＋ Indsæt sektion efter denne side…
            </button>
            <button disabled={index === 0} onClick={() => movePage(pageId, -1)}>
              ↑ Tidligere i avisen
            </button>
            <button disabled={index === count - 1} onClick={() => movePage(pageId, 1)}>
              ↓ Senere i avisen
            </button>
            <button onClick={() => clearPage(pageId)}>
              ⌫ Tøm siden — behold designet
            </button>
            <button className="more__drop" onClick={() => removePage(pageId)}>
              × Slet siden
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * What just happened, said once and then gone.
 *
 * It was a bar across the top that stayed until the next message, and
 * pushed the whole studio down by its height for a sentence nobody
 * needed a second time. A note floats over the corner of the canvas
 * instead and clears itself; errors and work in progress keep their
 * bars, because those are still true until they are dealt with.
 */
function Toast({ note }: { note: string }) {
  const clear = useStudio((s) => s.clearNote);
  useEffect(() => {
    const at = window.setTimeout(clear, 4500);
    return () => window.clearTimeout(at);
  }, [note, clear]);
  return (
    <div className="toast" role="status" onClick={clear}>
      {note}
    </div>
  );
}

export function App() {
  const s = useStudio();
  const canvasRef = useRef<HTMLElement>(null);

  /*
   * The page asked for — opened from the book, or stepped to — is
   * scrolled into view. Instant the first time the canvas appears (a
   * glide from page 1 to page 30 is a wait), smooth for a step.
   */
  const wasScrolled = useRef(false);
  useEffect(() => {
    const target = s.scrollToPageId;
    const canvas = canvasRef.current;
    if (!target || !canvas || s.view !== "side") {
      if (s.view !== "side") wasScrolled.current = false;
      return;
    }
    const element = canvas.querySelector<HTMLElement>(`[data-page-id="${CSS.escape(target)}"]`);
    if (!element) return;
    canvas.scrollTo({
      top: element.offsetTop - canvas.offsetTop - 12,
      behavior: wasScrolled.current ? "smooth" : "auto",
    });
    wasScrolled.current = true;
    // Held until the glide has landed, so the scroll it causes is not
    // read back as the person scrolling somewhere else.
    const done = window.setTimeout(() => s.clearScrollTo(), 600);
    return () => window.clearTimeout(done);
  }, [s.scrollToPageId, s.view]);

  /* The header's page follows the page that fills the top of the canvas. */
  const followScroll = () => {
    const canvas = canvasRef.current;
    if (!canvas || useStudio.getState().scrollToPageId) return;
    const line = canvas.getBoundingClientRect().top + canvas.clientHeight * 0.35;
    for (const element of canvas.querySelectorAll<HTMLElement>("[data-page-id]")) {
      const box = element.getBoundingClientRect();
      if (box.top <= line && box.bottom > line) {
        s.seePage(element.dataset.pageId!);
        return;
      }
    }
  };

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

      /*
       * Escape shuts whatever the toolbar folded out.
       *
       * Read before anything else that answers Escape, because a panel
       * lies OVER the page: the thing on top is the thing the key is
       * about.
       */
      if (event.key === "Escape" && useStudio.getState().panel) {
        event.preventDefault();
        useStudio.getState().closePanel();
        return;
      }

      if (event.key === "Escape" && useStudio.getState().layoutEditPageId) {
        event.preventDefault();
        useStudio.getState().setLayoutEdit(null);
        return;
      }

      // ⌘S saves — promised on the save button and in the menu, and never wired.
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (s.document && !s.busy) void s.save();
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) s.redo();
        else s.undo();
        return;
      }

      if (typing || event.metaKey || event.ctrlKey) return;

      /* An element of a published page: ⌫ deletes it, Esc lets go. */
      const element = s.selectedIncito;
      if (element) {
        if (event.key === "Escape") { event.preventDefault(); s.selectIncito(element.pageId, null); return; }
        if (event.key === "Backspace" || event.key === "Delete") {
          event.preventDefault();
          s.hideIncito(element.pageId, element.path, true);
          return;
        }
        // Arrows move it a point at a time, shift ten; + / − resize; 0 puts it back.
        const far = event.shiftKey ? 10 : 1;
        const step = ({ ArrowLeft: [-far, 0], ArrowRight: [far, 0], ArrowUp: [0, -far], ArrowDown: [0, far] } as Record<string, [number, number]>)[event.key];
        if (step) {
          event.preventDefault();
          s.moveIncito(element.pageId, element.path, { dx: step[0], dy: step[1] }, `incito-key-${element.path}`);
          return;
        }
        if (event.key === "+" || event.key === "=") { event.preventDefault(); s.moveIncito(element.pageId, element.path, { scaleBy: 0.05 }); return; }
        if (event.key === "-") { event.preventDefault(); s.moveIncito(element.pageId, element.path, { scaleBy: -0.05 }); return; }
        if (event.key === "0") { event.preventDefault(); s.moveIncito(element.pageId, element.path, { reset: true }); return; }
      }

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

      /*
       * A picture in hand answers the same keys as everything else:
       * arrows move it (shift further), + / − resize, [ ] turn, 0 puts
       * it square again, ⌫ takes it off the page, Esc lets go.
       */
      const decorId = s.selectedDecorId;
      if (decorId) {
        const page = s.document?.pages.find((entry) => entry.decorations.some((d) => d.id === decorId));
        const decor = page?.decorations.find((d) => d.id === decorId);
        if (!page || !decor) return;
        const gesture = `decor-key:${decorId}`;
        const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
        if (event.key === "Escape") { event.preventDefault(); s.selectDecor(null); return; }
        if (event.key === "Backspace" || event.key === "Delete") {
          event.preventDefault();
          s.removePageImage(page.id, decorId);
          s.selectDecor(null);
          return;
        }
        const far = event.shiftKey ? 3 : 0.5;
        const moves: Record<string, [number, number]> = {
          ArrowLeft: [-far, 0], ArrowRight: [far, 0], ArrowUp: [0, -far], ArrowDown: [0, far],
        };
        const move = moves[event.key];
        if (move) {
          event.preventDefault();
          s.updatePageImage(page.id, decorId, {
            offsetX: clamp(decor.offsetX + move[0], -75, 75),
            offsetY: clamp(decor.offsetY + move[1], -75, 75),
          }, gesture);
          return;
        }
        if (event.key === "+" || event.key === "=" || event.key === "-") {
          event.preventDefault();
          const by = event.key === "-" ? -0.02 : 0.02;
          s.updatePageImage(page.id, decorId, { scale: clamp(decor.scale + by, 0.05, 0.6) }, gesture);
          return;
        }
        if (event.key === "[" || event.key === "]") {
          event.preventDefault();
          s.updatePageImage(page.id, decorId, {
            rotate: clamp(decor.rotate + (event.key === "]" ? 2 : -2), -30, 30),
          }, gesture);
          return;
        }
        if (event.key === "0") {
          event.preventDefault();
          s.updatePageImage(page.id, decorId, { rotate: 0 }, gesture);
        }
        return;
      }

      /* A note in hand: Esc puts it down, ⌫ takes it off, arrows nudge. */
      const noteId = s.selectedNoteId;
      if (noteId) {
        const page = s.document?.pages.find((entry) => (entry.notes ?? []).some((n) => n.id === noteId));
        const note = page?.notes.find((n) => n.id === noteId);
        if (!page || !note) return;
        if (event.key === "Escape") { event.preventDefault(); s.selectNote(null); return; }
        if (event.key === "Backspace" || event.key === "Delete") {
          event.preventDefault();
          s.removeNote(page.id, noteId);
          return;
        }
        const far = event.shiftKey ? 0.02 : 0.004;
        const moves: Record<string, [number, number]> = {
          ArrowLeft: [-far, 0], ArrowRight: [far, 0], ArrowUp: [0, -far], ArrowDown: [0, far],
        };
        const move = moves[event.key];
        if (move) {
          event.preventDefault();
          s.updateNote(page.id, noteId, { x: note.x + move[0], y: note.y + move[1] }, `note-key:${noteId}`);
        }
        return;
      }

      const offerId = s.selectedOfferId;
      if (!offerId) {
        // Nothing left in hand: Escape gives back the page itself.
        if (event.key === "Escape" && s.view === "side" && !s.selectedDecorId) {
          event.preventDefault();
          s.openPage(null);
        }
        return;
      }

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

      /*
       * G for Gemini: run the arrangement again on the tile in hand.
       *
       * The loop this feature is improved in is press, look, change a
       * word in the prompt, press again — and the button for it sits
       * in a panel that is two scrolls away once a page is full. The
       * plain letter, no modifier, because the editor's hands are on
       * the page and nothing else in this studio types.
       */
      if ((event.key === "g" || event.key === "G") && !event.metaKey && !event.ctrlKey) {
        const offer = s.document?.offers.find((entry) => entry.id === offerId);
        if (offer && offer.members.length > 1 && !s.busy) {
          event.preventDefault();
          void s.standUpOneCluster(offerId);
        } else if (offer && (offer.imageUrl || offer.imagePack.length > 1) && !s.busy) {
          // One picture of several variants: cut it up first.
          event.preventDefault();
          void s.splitAndStandUp(offerId);
        }
        return;
      }

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

  /*
   * Re-read the checklist whenever the avis changes.
   *
   * Debounced, because half of it is a real measurement of the real
   * pages — see `measureFindings` — and a drag fires a hundred
   * document changes a second. A third of a second after the last one
   * is fast enough to feel live and slow enough to cost nothing.
   *
   * Deliberately NOT listing `findings` as a dependency: this effect
   * writes them, and a list that re-measures because it measured is a
   * loop.
   */
  useEffect(() => {
    const at = window.setTimeout(() => useStudio.getState().refreshFindings(), 350);
    return () => window.clearTimeout(at);
  }, [s.document, s.week, s.brand]);

  /*
   * And again once the artwork has landed.
   *
   * An image with no intrinsic size cannot be measured — the checker
   * in `scripts/check-render.ts` learned this the hard way, where a
   * partly loaded book came back with FEWER findings and read as the
   * cleaner result. Here the pictures arrive over a chain's image
   * service, seconds after the page. Captured rather than bubbled,
   * because an `img`'s load event does not bubble.
   */
  useEffect(() => {
    let at: number | undefined;
    const again = () => {
      window.clearTimeout(at);
      at = window.setTimeout(() => useStudio.getState().refreshFindings(), 300);
    };
    window.addEventListener("load", again, true);
    window.addEventListener("resize", again);
    return () => {
      window.clearTimeout(at);
      window.removeEventListener("load", again, true);
      window.removeEventListener("resize", again);
    };
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


  return (
    <div className="shell">
      {/*
       * Everything the sixteen-control toolbar carried, rearranged
       * rather than reduced: the chain, the week and the open-another
       * picker are one document menu; save is a line that says when;
       * the four ways into a page live on the card that makes pages;
       * the step strip and the checklist are the next-step bar.
       */}
      <Top />

      {/*
       * One panel at a time, lying OVER the canvas.
       *
       * Three permanent strips used to stand here — a hundred pixels
       * of chrome between the toolbar and the first sheet, in every
       * session, including the ones that never opened any of them. The
       * backdrop is not dimmed: this is a fold-out, not a dialogue,
       * and the page it is about has to stay readable behind it.
       */}
      {s.panel && (
        <div className="panel">
          {/* A click anywhere else shuts it. Its own layer rather than
              the card's backdrop, because the card is anchored under
              the button and this has to cover the whole screen. */}
          <div className="panel__away" onPointerDown={s.closePanel} />
          <div className="panel__card">
            <button
              className="panel__close"
              onClick={s.closePanel}
              title="Luk (Esc)"
            >
              ×
            </button>
            {s.panel === "sider" && <Ways />}
            {s.panel === "stemning" && (
              <>
                {/* Your own pictures first — uploading one is the common
                    errand; having a model draw one is the rarer. */}
                <section className="decor">
                  <h3 className="inspector__group">Billeder</h3>
                  <Pictures />
                </section>
                <DecorBar />
              </>
            )}
          </div>
        </div>
      )}

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
      {s.note && !s.error && !s.busy && <Toast note={s.note} />}
      {/* One quiet line, not a set-up guide: everything but the AI help works without keys. */}
      {s.brand && (!s.curationReady || !s.decorReady) && (
        <div className="banner banner--hint">
          AI-hjælpen er slået fra på denne maskine — alt andet virker som normalt.
        </div>
      )}

      <Checklist />
      <Palette />
      <Keys />

      <Reproduce />

      {/*
       * Two screens. The book is the whole avis as printed spreads —
       * where you land, and what the editor never had. A page is one
       * sheet, large, with the tray still docked so filling an empty
       * cell is the same gesture it was on the overview.
       */}
      {s.view === "bog" && s.brand && <Book />}

      {s.view === "side" && (
      <div className="page2">
        {/* The products without a page, beside the page they go on. */}
        <Tray />
        <main
          className="page2__canvas"
          ref={canvasRef}
          onScroll={followScroll}
          // Clicking the paper around the pages drops the selection, the
          // way clicking the canvas does in a drawing tool.
          onPointerDown={(event) => {
            if (event.target !== event.currentTarget) return;
            s.select(null);
            s.selectDecor(null);
            s.selectNote(null);
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
            s.document.pages
              /*
               * Every page, one scrolling column — the page you opened
               * is scrolled to, and the header follows whichever page
               * is in view. Between each pair, the way to put a picture
               * page in, in plain sight.
               */
              .map((page, at) => (
              <div className="stack" key={page.id} data-page-id={page.id}>
              {(() => {
              const index = s.document!.pages.findIndex((entry) => entry.id === page.id);
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
                   * The page's shape, in one pill above the sheet.
                   *
                   * What the page is called and where it sits moved up
                   * into the header — see `PageHead`. What is left here
                   * is what it IS: how many offers, in which layout,
                   * what it is printed on. Order, image pages and
                   * removal are rarer and sit behind ⋯; nothing the
                   * old bar held is gone.
                   */}
                  {/*
                    * What the page SAYS, right above it: its number, the
                    * heading and the theme line. They sat in the header,
                    * far from the sheet they are printed on.
                    */}
                  <div className="pagehead">
                    <span className="pagehead__no">Side {index + 1}</span>
                    <input
                      className="pagehead__title"
                      value={page.title}
                      placeholder="Overskrift"
                      onChange={(event) => s.setPageTitle(page.id, event.target.value)}
                    />
                    <input
                      className="pagehead__theme"
                      value={page.subtitle}
                      placeholder="Underoverskrift (valgfri)"
                      onChange={(event) => s.setPageSubtitle(page.id, event.target.value)}
                    />
                  </div>
                  <div className="pagebar">
                    {/* How many products, in which shape — drawn, one
                        click; see `LayoutGallery`. */}
                    <LayoutGallery page={page} template={template} spare={bench.length} />
                    <div className="pagebar__rule" />

                    {/*
                      * Everything that is a picture rather than a
                      * product — the chain's library, a picture on the
                      * page, a picture under it, the mood artwork — in
                      * one panel addressed to this page. It was two
                      * file pickers here plus a third button up in the
                      * header; one clearly named door is easier.
                      */}
                    <button
                      className={`pagebar__pics${page.background ? " is-on" : ""}`}
                      title="Billeder på siden, baggrund og kædens billedbibliotek"
                      onClick={() => {
                        s.setActivePage(page.id);
                        s.togglePanel("stemning");
                      }}
                    >
                      Billeder og baggrund
                    </button>

                    {/*
                      * The page's shape by hand: every cell a box to drag
                      * and resize. Off again with Færdig or Esc.
                      */}
                    <button
                      className={`pagebar__pics${s.layoutEditPageId === page.id ? " is-editing" : ""}`}
                      title="Træk i felterne for at gøre dem større, mindre eller flytte dem"
                      onClick={() => s.setLayoutEdit(s.layoutEditPageId === page.id ? null : page.id)}
                    >
                      {s.layoutEditPageId === page.id ? "Færdig" : "Rediger layout"}
                    </button>
                    {s.layoutEditPageId === page.id && (
                      <button
                        className="pagebar__pics"
                        title="Et nyt, tomt felt midt på siden"
                        onClick={() => s.addCell(page.id, { x: 0.3, y: 0.4, w: 0.4, h: 0.25 })}
                      >
                        + Felt
                      </button>
                    )}

                    {/* Words anywhere on the page — a headline of your
                        own, "Kun i weekenden", a price note. */}
                    <button
                      className="pagebar__pics"
                      title="Læg en tekst på siden — flyt den med musen, skriv den i panelet til højre"
                      onClick={() => s.addNote(page.id)}
                    >
                      + Tekst
                    </button>

                    {/* Every cluster on the sheet in one errand — the
                        model composes each, the chain's cutouts move to
                        match. Violet, as everything a model does. */}
                    {page.placements.some(
                      (placement) => (offers.get(placement.offerId)?.members.length ?? 0) > 1,
                    ) && (
                      <button
                        className="pagebar__model"
                        title={
                          s.decorReady
                            ? "Lad AI stille alle sidens samlede tilbud pænt op"
                            : "AI-hjælpen er slået fra på denne maskine"
                        }
                        disabled={Boolean(s.busy) || !s.decorReady}
                        onClick={() => void s.standUpClusters(page.id)}
                      >
                        Stil samlede tilbud op
                      </button>
                    )}
                    <button
                      className="pagebar__btn pagebar__drop"
                      onClick={() => s.removePage(page.id)}
                      title="Slet siden (⌘Z fortryder)"
                    >
                      Slet side
                    </button>
                    <PageMore pageId={page.id} index={index} />
                  </div>

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
                          {/* The rest — corner, size, turn, layer, mirror —
                              is in the panel on the right once it is in
                              hand. */}
                          <span className="pic__name">
                            {decor.subject || (decor.id.startsWith("decor-") ? "AI-billede" : "Eget billede")}
                          </span>
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
                  <div className="sheet__paper">
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
                    selectedIncitoBlock={s.selectedIncito?.pageId === page.id ? s.selectedIncito.path : null}
                    onSelectIncitoBlock={(path) => s.selectIncito(page.id, path)}
                    onMoveIncitoBlock={(path, at, gesture) => s.moveIncito(page.id, path, { ...at, absolute: true }, gesture)}
                    onScaleIncitoBlock={(path, by) => s.moveIncito(page.id, path, { scaleBy: by })}
                    onIncitoMoveEnd={s.endGesture}
                    incitoDropType={OFFER_MIME}
                    onDropOnIncitoOffer={(viewId, event) => {
                      const dragged = event.dataTransfer?.getData(OFFER_MIME);
                      if (!dragged || !page.incito) return;
                      // The cell that offer stands in — by the publication's record, or by its own id.
                      const slotId = incitoSlotOf(page, viewId);
                      if (slotId) void s.fillSlot(page.id, slotId, droppedOffers(dragged, s.librarySelection));
                    }}
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
                    selectedNoteId={s.selectedNoteId}
                    onSelectNote={s.selectNote}
                    onMoveNote={(noteId, at, gesture) => s.updateNote(page.id, noteId, at, gesture)}
                    onNoteMoveEnd={s.endGesture}
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
                  {s.layoutEditPageId === page.id
                    ? <LayoutEditor page={page} template={template} />
                    : <EmptyCells page={page} template={template} />}
                  </div>
                </div>
              );
            })()}
              <InsertImage at={at + 1} />
              </div>
            ))}
        </main>
        <Inspector />
      </div>
      )}



      {/* Asked once, over everything, and only when something is about
          to be built that has to be called something. */}
      <AskWeek />
    </div>
  );
}
