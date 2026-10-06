import { useEffect } from "react";
import { useStudio } from "../state.js";

/** The checklist, kept current as the avis and its pictures change. */
export function useLiveFindings() {
  const document = useStudio((s) => s.document);
  const week = useStudio((s) => s.week);
  const brand = useStudio((s) => s.brand);
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
  }, [document, week, brand]);

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
}
