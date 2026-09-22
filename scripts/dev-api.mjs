/**
 * The API server, restarted when anything it imports changes.
 *
 *   npm run dev:api
 *
 * `vite-node --watch` watches the server's own files and not the
 * workspace packages it imports: those resolve through the
 * node_modules symlink, and the watcher treats them as dependencies.
 * In practice that means a change to the schema, the curator or the
 * publication reader is invisible until somebody notices the server
 * is answering with yesterday's code — which, measured in one
 * afternoon, cost eight manual restarts and two wrong conclusions
 * (a field "stripped on save" that was only stripped by a stale
 * process).
 *
 * So the watching is done here instead, and deliberately dumbly:
 * `packages/*&#47;src` and the server's own `src`, a restart on any
 * change, debounced. What it does NOT watch is `dist` — `tsc -b`
 * writes there on every typecheck, and a server that restarts
 * because somebody ran the typechecker is a worse tool than one that
 * needs a manual restart.
 */
import { spawn } from 'node:child_process';
import { watch } from 'node:fs';
import { readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SERVER = join(ROOT, 'packages/server');

/** How long after the last change the server is restarted. */
const SETTLE_MS = 250;

/** Every workspace source tree the server could be importing. */
function watched() {
  const trees = [join(SERVER, 'src')];
  for (const name of readdirSync(join(ROOT, 'packages'))) {
    const src = join(ROOT, 'packages', name, 'src');
    if (name !== 'server' && existsSync(src)) trees.push(src);
  }
  return trees;
}

let child = null;
let timer;

function start() {
  child = spawn(
    process.execPath,
    [
      '--env-file-if-exists=../../.env',
      resolve(ROOT, 'node_modules/.bin/vite-node'),
      'src/main.ts',
    ],
    { cwd: SERVER, stdio: 'inherit' },
  );
  child.on('exit', (code, signal) => {
    // A crash is worth saying out loud; a restart is not.
    if (child && code !== null && code !== 0 && !signal) {
      console.error(`api stoppede med kode ${code} — venter på en ændring`);
    }
  });
}

function restart(why) {
  clearTimeout(timer);
  timer = setTimeout(() => {
    console.log(`\n↻ ${why} ændret — genstarter api`);
    const old = child;
    child = null;
    if (old) old.kill('SIGTERM');
    start();
  }, SETTLE_MS);
}

for (const tree of watched()) {
  watch(tree, { recursive: true }, (_event, file) => {
    // Editors write swap files and typecheckers write build info; a
    // restart for either is noise.
    if (!file || !/\.(ts|tsx|json|css)$/.test(file)) return;
    if (/tsbuildinfo|~$/.test(file)) return;
    restart(file);
  });
}

start();

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    const old = child;
    child = null;
    old?.kill(signal);
    process.exit(0);
  });
}
