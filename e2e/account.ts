import { readFileSync } from 'node:fs';

/** What `seed.ts` made this run: the account, and the avis to work on. */
export function seeded(): { email: string; password: string; name: string; catalogId: string; pages: string[] } {
  return JSON.parse(readFileSync(new URL('../.data/e2e/account.json', import.meta.url), 'utf8'));
}
