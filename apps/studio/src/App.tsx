import { useEffect } from "react";
import { useStudio, useStudioPick } from "./state.js";
import { startRouting } from "./route.js";
import { Reproduce } from "./Reproduce.js";
import { OfferRulesPanel } from "./OfferRules.js";
import { DesignsPanel } from "./Designs.js";
import { Book } from "./Book.js";
import { Top } from "./Shell.js";
import { Checklist } from "./Checklist.js";
import { AskWeek } from "./Week.js";
import { EditionsBoard } from "./Editions.js";
import { GoodsBoard } from "./Goods.js";
import { SlotsBoard } from "./Slots.js";
import { LiveBoard } from "./Live.js";
import { SignoffBoard } from "./Signoff.js";
import { Home } from "./Home.js";
import { ThemesPanel } from "./Themes.js";
import { Keys, Palette } from "./Palette.js";
import { useStudioKeys } from "./app/keys.js";
import { useLiveFindings } from "./app/findings.js";
import { Panel } from "./app/Panel.js";
import { Toast } from "./app/Toast.js";
import { Canvas } from "./app/Canvas.js";

export function App() {
  const s = useStudioPick('brand', 'busy', 'curationReady', 'decorReady', 'error', 'note', 'view');

  // Start from the address bar, and keep it up to date — see `route.ts`.
  useEffect(() => startRouting(), []);
  useStudioKeys();
  useLiveFindings();

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
      <Panel />

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
      <OfferRulesPanel />
      <ThemesPanel />

      {/*
       * Two screens. The book is the whole avis as printed spreads —
       * where you land, and what the editor never had. A page is one
       * sheet, large, with the tray still docked so filling an empty
       * cell is the same gesture it was on the overview.
       */}
      {s.view === "bog" && s.brand && <Book />}
      {s.view === "hjem" && s.brand && <Home />}
      {s.view === "udgaver" && s.brand && <EditionsBoard />}
      {s.view === "varer" && s.brand && <GoodsBoard />}
      {s.view === "pladser" && s.brand && <SlotsBoard />}
      {s.view === "live" && s.brand && <LiveBoard />}
      {s.view === "godkend" && s.brand && <SignoffBoard />}
      {/* The chain's, like the front page: there whether or not an avis is open. */}
      {s.view === "varedesigns" && s.brand && <DesignsPanel />}
      {s.view === "side" && <Canvas />}

      {/* Asked once, over everything, and only when something is about
          to be built that has to be called something. */}
      <AskWeek />
    </div>
  );
}
