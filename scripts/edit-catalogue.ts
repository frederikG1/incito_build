/**
 * Edit a catalogue document from the terminal, in the studio's own ops.
 *
 *   npm run edit -- .data/out/sb.json --outline
 *   npm run edit -- .data/out/sb.json --op '{"op":"lead","offerId":"1073777"}'
 *   npm run edit -- .data/out/sb.json --ops my-ops.json --out .data/out/sb-v2.json
 *   npm run edit -- .data/out/sb.json --say "byt de to øl på side 2"          # proposal only
 *   npm run edit -- .data/out/sb.json --say "gør osten større" --apply
 *
 * Without `--out` the file is edited in place. `--say` is one model call
 * (ANTHROPIC_API_KEY) and prints the ops it proposes; only `--apply`
 * writes them. The vocabulary is `docs/schema/edit-ops.schema.json`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CatalogDocument } from '@incitio/schema';
import { getBrand } from '@incitio/brands';
import { applyOps, EditError, instruct, outline, outlineText, type EditOp } from '@incitio/edit';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const has = (name: string) => args.includes(`--${name}`);
const path = args[0];
if (!path || path.startsWith('--')) {
  console.error('usage: npm run edit -- <catalogue.json> --outline | --op <json> | --ops <file> | --say "<text>" [--apply] [--out file]');
  process.exit(2);
}

const file = resolve(process.cwd(), path);
const document = CatalogDocument.parse(JSON.parse(readFileSync(file, 'utf8')));
const { brand } = getBrand(document.brandId);

if (has('outline')) {
  console.log(outlineText(outline(document, brand)));
  process.exit(0);
}

let ops: unknown[] = [];
if (flag('op')) ops = [JSON.parse(flag('op')!)];
if (flag('ops')) ops = JSON.parse(readFileSync(resolve(process.cwd(), flag('ops')!), 'utf8')) as unknown[];
if (flag('say')) {
  const proposal = await instruct(document, brand, flag('say')!);
  console.log(proposal.explanation);
  if (proposal.unclear) console.log(`uklart: ${proposal.unclear}`);
  for (const r of proposal.rejected) console.log(`afvist: ${r.reason}`);
  console.log(JSON.stringify(proposal.ops, null, 2));
  if (!has('apply')) process.exit(0);
  ops = proposal.ops satisfies EditOp[];
}
if (ops.length === 0) {
  console.error('no ops — pass --op, --ops or --say');
  process.exit(2);
}

try {
  const result = applyOps(document, ops, brand);
  for (const line of result.applied) console.log(`  ${line}`);
  const out = resolve(process.cwd(), flag('out') ?? path);
  writeFileSync(out, `${JSON.stringify({ ...result.document, updatedAt: new Date().toISOString() }, null, 2)}\n`);
  console.log(`wrote ${out}`);
} catch (error) {
  if (error instanceof EditError) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}
