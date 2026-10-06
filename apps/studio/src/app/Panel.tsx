import { useStudio, useStudioPick } from "../state.js";
import { DecorBar } from "../DecorBar.js";
import { Ways } from "../Ways.js";
import { Pictures } from "../Pictures.js";

/*
 * One panel at a time, lying OVER the canvas.
 *
 * Three permanent strips used to stand here — a hundred pixels
 * of chrome between the toolbar and the first sheet, in every
 * session, including the ones that never opened any of them. The
 * backdrop is not dimmed: this is a fold-out, not a dialogue,
 * and the page it is about has to stay readable behind it.
 */
export function Panel() {
  const s = useStudioPick('closePanel', 'panel');
  if (!s.panel) return null;
  return (
    <div className={s.panel === "stemning" ? "panel panel--side" : "panel"}>
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
            <div className="pp">
              <Pictures />
              <DecorBar />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
