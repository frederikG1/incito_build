/**
 * A database of its own for the browser tests, made fresh every run.
 *
 * Never the studio's real one: a test that saves, signs or deletes must
 * not be able to touch a chain's avis (it happened — see the memory on
 * browser tests and real chain data). One account, member of SuperBrugsen
 * only, with a password made up here and written next to the database
 * for the sign-in step to read; and one avis built from the shipped W36
 * feed without a model call, so every run starts from the same pages.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { buildCatalogue } from '@incitio/pipeline';
import { readDefaultDesigns, Store } from '@incitio/server';

const ROOT = new URL('..', import.meta.url);
export const E2E_DIR = fileURLToPath(new URL('.data/e2e/', ROOT));

rmSync(E2E_DIR, { recursive: true, force: true });
mkdirSync(E2E_DIR, { recursive: true });

const store = new Store(`${E2E_DIR}incitio.db`);
const account = { email: 'e2e@incitio.test', password: randomBytes(18).toString('base64url'), name: 'E2E Tester' };
store.accounts.addUser(account.email, account.name, account.password);
store.accounts.grant(account.email, 'superbrugsen', 'redaktør');

const designs = readDefaultDesigns(fileURLToPath(new URL('data/designs/', ROOT)))['superbrugsen'];
const { document } = await buildCatalogue('superbrugsen', readFileSync(new URL('data/feeds/SuperBrugsenW36.json', ROOT), 'utf8'), {
  catalogId: 'e2e-uge36',
  seed: 'e2e',
  maxPages: 2,
  skipCuration: true,
  ...(designs ? { designs: { designs: designs.designs, tag: designs.tag } } : {}),
});
store.save('superbrugsen', { ...document, name: 'E2E · uge 36' });
store.close();

writeFileSync(`${E2E_DIR}account.json`, JSON.stringify({ ...account, catalogId: 'e2e-uge36', pages: document.pages.map((p) => p.id) }));
console.log(`e2e: database og konto klar (${document.pages.length} sider)`);
