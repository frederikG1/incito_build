import { useCallback, useSyncExternalStore } from 'react';

/**
 * Who is working — the name a signature, a sold-out and a price change carry.
 *
 * It was a text field in the Godkend header, read back out of
 * localStorage by hand in two places on Live. One store now: typed once,
 * shown as a name after that, and the same on every board.
 */

const KEY = 'incitio.who';
const listeners = new Set<() => void>();
let memory = '';

export function readWho(): string {
  try { return window.localStorage.getItem(KEY) ?? memory; } catch { return memory; }
}

function writeWho(value: string) {
  memory = value;
  try { window.localStorage.setItem(KEY, value); } catch { /* memory still holds it */ }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useWho(): [string, (value: string) => void] {
  const who = useSyncExternalStore(subscribe, readWho, () => '');
  return [who, useCallback(writeWho, [])];
}

/**
 * Names to pick from instead of typing: whoever signed, sold or changed
 * something on this avis, and whoever has worked in this browser before.
 * The same person spelled two ways is two people on a signature.
 */
const KNOWN_KEY = 'incitio.who.known';

export function knownNames(document: {
  approvals?: { who: string }[];
  live?: { who: string }[];
} | null): string[] {
  let local: string[] = [];
  try { local = JSON.parse(window.localStorage.getItem(KNOWN_KEY) ?? '[]') as string[]; } catch { /* none */ }
  const said = [
    ...(document?.approvals ?? []).map((a) => a.who),
    ...(document?.live ?? []).map((e) => e.who),
    ...(Array.isArray(local) ? local : []),
  ].map((name) => (typeof name === 'string' ? name.trim() : '')).filter(Boolean);
  const seen = new Map<string, string>();
  for (const name of said) if (!seen.has(name.toLowerCase())) seen.set(name.toLowerCase(), name);
  return [...seen.values()].sort((a, b) => a.localeCompare(b, 'da'));
}

/** Keep a name for the list above, once it has been settled on. */
export function rememberName(name: string) {
  const trimmed = name.trim();
  if (!trimmed) return;
  try {
    const known = JSON.parse(window.localStorage.getItem(KNOWN_KEY) ?? '[]') as unknown;
    const list = Array.isArray(known) ? known.filter((n): n is string => typeof n === 'string') : [];
    if (list.some((n) => n.toLowerCase() === trimmed.toLowerCase())) return;
    window.localStorage.setItem(KNOWN_KEY, JSON.stringify([...list, trimmed].slice(-30)));
  } catch { /* the document's names still show */ }
}
