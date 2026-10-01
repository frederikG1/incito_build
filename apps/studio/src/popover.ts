import { useEffect, useId, useRef } from 'react';

/**
 * One open menu at a time, and Esc closes it.
 *
 * Every panel that drops down from a button — the checks, the history,
 * the PDF choices, the editions, the page's ⋯ — used to keep its own
 * open state and nothing else, so two could stand open over each other
 * and Esc closed none of them. Each now says so when it opens, and the
 * others close.
 */
export function usePopover(open: boolean, close: () => void): void {
  const id = useId();
  const closing = useRef(close);
  closing.current = close;
  useEffect(() => {
    if (!open) return;
    window.dispatchEvent(new CustomEvent('incitio:popover', { detail: id }));
    const onOther = (event: Event) => { if ((event as CustomEvent<string>).detail !== id) closing.current(); };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') closing.current(); };
    window.addEventListener('incitio:popover', onOther);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('incitio:popover', onOther);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, id]);
}
