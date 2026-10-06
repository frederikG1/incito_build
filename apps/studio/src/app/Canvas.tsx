import { useEffect, useRef } from "react";
import { ImageSize } from "@incitio/renderer";
import { EDITOR_PX, useStudio, useStudioPick } from "../state.js";
import { Inspector } from "../Inspector.js";
import { Tray } from "../Tray.js";
import { Sheet } from "./Sheet.js";
import { InsertImage, PageTools } from "./PageTools.js";

/**
 * The page view: the tray, every page in one scrolling column, and the
 * inspector for whatever is in hand.
 */
export function Canvas() {
  const s = useStudioPick(
    'brand', 'clearScrollTo', 'document', 'feed', 'scrollToPageId', 'seePage', 'select', 'selectDecor',
    'selectNote', 'view'
  );
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

  const offers = new Map(
    (s.document?.offers ?? []).map((offer) => [offer.id, offer]),
  );

  return (
    <ImageSize.Provider value={EDITOR_PX}>
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
        {s.document && <PageTools />}
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
              <Sheet page={page} offers={offers} />
              <InsertImage at={at + 1} />
            </div>
          ))}
      </main>
      <Inspector />
    </div>
    </ImageSize.Provider>
  );
}
