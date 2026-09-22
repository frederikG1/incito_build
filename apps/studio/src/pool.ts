/**
 * A few at a time, in order, without waiting for each other.
 *
 * Standing a sheet's clusters up used to be a `for` loop with an await
 * in it, and the arithmetic of that is brutal: one cluster is a
 * download, an image model, a vision call — the better part of a
 * minute — and six of them one after the other is five or six minutes
 * with a person watching a spinner. None of the six needs anything
 * from the other five.
 *
 * So they run together, a few at a time. Not all at once: every one of
 * them is a paid model call, and firing a whole book at an image API
 * in one breath is how a rate limit is met. The limit is the knob.
 *
 * Results come back in the ORDER THEY WENT IN, never in the order they
 * finished — a page whose tiles rearranged themselves by who answered
 * first would be a different page every run.
 *
 * Nothing throws. A task that fails hands back its error in place, so
 * one cluster the model refused does not take the other five with it —
 * the same bargain `decorate` makes on the server.
 */
export type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };

export async function pool<In, Out>(
  items: In[],
  limit: number,
  run: (item: In, index: number) => Promise<Out>,
  /** Called as each one lands, with how many are done. For the spinner. */
  onDone?: (done: number, total: number) => void,
): Promise<Settled<Out>[]> {
  const out: Settled<Out>[] = new Array(items.length);
  let next = 0;
  let done = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      try {
        // eslint-disable-next-line no-await-in-loop
        out[index] = { ok: true, value: await run(items[index]!, index) };
      } catch (error) {
        out[index] = { ok: false, error };
      }
      done += 1;
      onDone?.(done, items.length);
    }
  };

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker),
  );
  return out;
}
