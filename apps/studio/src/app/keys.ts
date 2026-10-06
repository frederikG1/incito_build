import { useEffect } from "react";
import { packLimits, pageTextLimits, partLimits } from "@incitio/schema";
import { useStudio } from "../state.js";

/**
 * The studio's keyboard, bound once for the whole app.
 */
export function useStudioKeys() {
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
}
