/**
 * Who may sign in to the studio, and to which chains.
 *
 *   npm run accounts -- list
 *   npm run accounts -- add <email> "<navn>" [--brand superbrugsen[:rolle]]...
 *   npm run accounts -- grant <email> <brand>[:rolle]
 *   npm run accounts -- revoke <email> <brand>
 *   npm run accounts -- passwd <email>
 *   npm run accounts -- disable <email>
 *
 * The only way an account is made: there is no sign-up route, so making
 * one takes a shell on the machine that holds the database. A password is
 * read from INCITIO_PASSWORD, else asked for on the terminal — never from
 * an argument, where it would land in the shell's history.
 *
 * Works on the same database the API opens (INCITIO_DB, else .data/incitio.db).
 */
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { findBrand, listBrands } from '@incitio/brands';
import { Store } from '@incitio/server';

const dbPath = process.env['INCITIO_DB'] ?? fileURLToPath(new URL('../.data/incitio.db', import.meta.url));
const [command, ...rest] = process.argv.slice(2);

async function password(): Promise<string> {
  if (process.env['INCITIO_PASSWORD']) return process.env['INCITIO_PASSWORD'];
  const prompt = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const typed = await prompt.question('Adgangskode (mindst 10 tegn): ');
  prompt.close();
  return typed;
}

function brandAndRole(text: string): [string, string] {
  const [brandId = '', role = 'redaktør'] = text.split(':');
  if (!findBrand(brandId)) {
    throw new Error(`ukendt kæde "${brandId}" — en af: ${listBrands().map((b) => b.id).join(', ')}`);
  }
  return [brandId, role];
}

function say(user: { email: string; name: string; brands: { brandId: string; role: string }[]; disabled?: boolean }) {
  const brands = user.brands.map((m) => `${m.brandId}:${m.role}`).join(', ') || 'ingen kæder';
  console.log(`${user.email}  ${user.name}  [${brands}]${user.disabled ? '  (lukket)' : ''}`);
}

const store = new Store(dbPath);
try {
  const accounts = store.accounts;
  switch (command) {
    case 'list':
      for (const user of accounts.list()) say(user);
      break;
    case 'add': {
      const [email, name, ...flags] = rest;
      if (!email || !name) throw new Error('add <email> "<navn>" [--brand kæde[:rolle]]');
      const grants: [string, string][] = [];
      for (let at = 0; at < flags.length; at += 1) {
        if (flags[at] === '--brand' && flags[at + 1]) grants.push(brandAndRole(flags[++at]!));
      }
      accounts.addUser(email, name, await password());
      for (const [brandId, role] of grants) accounts.grant(email, brandId, role);
      say(accounts.list().find((user) => user.email.toLowerCase() === email.toLowerCase())!);
      break;
    }
    case 'grant': {
      const [email, brand] = rest;
      if (!email || !brand) throw new Error('grant <email> <kæde>[:rolle]');
      accounts.grant(email, ...brandAndRole(brand));
      break;
    }
    case 'revoke': {
      const [email, brandId] = rest;
      if (!email || !brandId) throw new Error('revoke <email> <kæde>');
      if (!accounts.revoke(email, brandId)) console.log('intet at fjerne');
      break;
    }
    case 'passwd': {
      if (!rest[0]) throw new Error('passwd <email>');
      accounts.setPassword(rest[0], await password());
      console.log('ny adgangskode sat — alle sessioner er logget ud');
      break;
    }
    case 'disable': {
      if (!rest[0]) throw new Error('disable <email>');
      accounts.disable(rest[0]);
      console.log('kontoen er lukket, og dens sessioner er slut');
      break;
    }
    default:
      console.log('list | add | grant | revoke | passwd | disable — se scripts/accounts.ts');
      process.exitCode = command ? 1 : 0;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  store.close();
}
