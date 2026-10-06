/** Signing in and out. */
import { BASE, headers, fail, type SignedInUser } from './http.js';

/** Whether this server wants a sign-in, and who is signed in. Same-origin, so the session cookie rides along. */
export async function fetchMe(): Promise<{ auth: 'on' | 'off'; user: SignedInUser | null }> {
  const response = await fetch(`${BASE}/auth/me`);
  if (!response.ok) await fail(response);
  return (await response.json()) as { auth: 'on' | 'off'; user: SignedInUser | null };
}

export async function signIn(email: string, password: string): Promise<SignedInUser> {
  const response = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  // A wrong password is an answer for the form, not a signed-out event.
  if (response.status === 401) throw new Error('Forkert e-mail eller adgangskode');
  if (!response.ok) await fail(response);
  return ((await response.json()) as { user: SignedInUser }).user;
}

export async function signOut(): Promise<void> {
  await fetch(`${BASE}/auth/logout`, { method: 'POST' });
}
