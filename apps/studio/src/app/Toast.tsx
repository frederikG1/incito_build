import { useEffect } from "react";
import { useStudio } from "../state.js";

/**
 * What just happened, said once and then gone.
 *
 * It was a bar across the top that stayed until the next message, and
 * pushed the whole studio down by its height for a sentence nobody
 * needed a second time. A note floats over the corner of the canvas
 * instead and clears itself; errors and work in progress keep their
 * bars, because those are still true until they are dealt with.
 */
export function Toast({ note }: { note: string }) {
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
