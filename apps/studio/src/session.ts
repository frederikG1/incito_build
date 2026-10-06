import { useSyncExternalStore } from 'react';
import { SIGNED_OUT_EVENT, fetchMe, signIn, signOut, type SignedInUser } from './api.js';
import { signedInAs } from './who.js';
import { useStudio } from './state.js';

/**
 * Whether the studio may be shown, and to whom.
 *
 * Asked once at start (`/api/auth/me`). A server with sign-in off — the
 * laptop — answers "off" and the studio opens as it always has; with it
 * on, nothing but the sign-in screen draws until there is a session.
 * Kept out of the studio's own store on purpose: signed out, that store
 * has nothing to load.
 */
export type Session =
  | { state: 'asking' }
  | { state: 'open' }
  | { state: 'signed-out'; said: string }
  | { state: 'signed-in'; user: SignedInUser }
  | { state: 'unreachable'; said: string };

let session: Session = { state: 'asking' };
const listeners = new Set<() => void>();

function set(next: Session) {
  session = next;
  if (next.state === 'signed-in') signedInAs(next.user.name);
  for (const listener of listeners) listener();
}

export function useSession(): Session {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => session,
  );
}

export async function startSession(): Promise<void> {
  try {
    const me = await fetchMe();
    if (me.auth === 'off') set({ state: 'open' });
    else set(me.user ? { state: 'signed-in', user: me.user } : { state: 'signed-out', said: '' });
  } catch (error) {
    set({ state: 'unreachable', said: error instanceof Error ? error.message : String(error) });
  }
}

export async function signInWith(email: string, password: string): Promise<void> {
  try {
    set({ state: 'signed-in', user: await signIn(email, password) });
  } catch (error) {
    set({ state: 'signed-out', said: error instanceof Error ? error.message : String(error) });
  }
}

export async function signOutNow(): Promise<void> {
  await signOut().catch(() => undefined);
  // A fresh page: nothing of the last person's avis stays in memory.
  window.location.reload();
}

// Any 401 later — the session ran out mid-week — asks for a sign-in again.
if (typeof window !== 'undefined') {
  window.addEventListener(SIGNED_OUT_EVENT, () => {
    if (session.state === 'signed-in') set({ state: 'signed-out', said: 'Du er blevet logget ud — log ind igen.' });
  });
}

/**
 * Whether the person at the screen may sign this sign-off for the open
 * chain — the same rule the server enforces (`maySign`): the role on
 * their membership, or admin. With sign-in off, anyone may, as before.
 */
export function useMaySign(role: string): boolean {
  const current = useSession();
  const brandId = useStudio((s) => s.brandId);
  if (current.state !== 'signed-in') return true;
  const membership = current.user.brands.find((m) => m.brandId === brandId);
  const roles = (membership?.role ?? '').split(',').map((r) => r.trim());
  return roles.includes('admin') || roles.includes(role);
}
