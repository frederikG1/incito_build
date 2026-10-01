/**
 * The internal formats as JSON Schema, with every field's JSDoc as its
 * description.
 *
 *   npm run schema                 # writes docs/schema/*.schema.json
 *   npm run schema -- --check      # exits 1 when the files are stale
 *
 * The zod schemas in @incitio/schema are the source of truth; these files
 * are what to hand a reader that is not TypeScript — another team's
 * importer, or a model asked to write a mapping or edit a document.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import type { ZodTypeAny } from 'zod';
import * as schema from '@incitio/schema';
import { toJsonSchema } from '@incitio/schema';
import { EditOps } from '@incitio/edit/core';

const ROOT = new URL('..', import.meta.url);
const SRC = new URL('packages/schema/src/', ROOT);
const OUT = new URL('docs/schema/', ROOT);

/** Schema name → property → JSDoc, read from `export const X = z.object({ ... })`. */
function readDocs(): Record<string, Record<string, string>> {
  const docs: Record<string, Record<string, string>> = {};
  const clean = (comment: string) => comment
    .replace(/^\/\*\*|\*\/$/g, '')
    .split('\n')
    .map((line) => line.replace(/^\s*\* ?/, '').trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  for (const file of readdirSync(SRC).filter((f) => f.endsWith('.ts'))) {
    const text = readFileSync(new URL(file, SRC), 'utf8');
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const jsdoc = (node: ts.Node) => (ts.getLeadingCommentRanges(text, node.getFullStart()) ?? [])
      .map((range) => text.slice(range.pos, range.end))
      .filter((comment) => comment.startsWith('/**'))
      .map(clean)
      .join('\n\n');

    const isObjectCall = (node: ts.Node): node is ts.CallExpression => ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'object'
      && node.arguments[0] !== undefined && ts.isObjectLiteralExpression(node.arguments[0]);

    const walk = (node: ts.Node, path: string) => {
      if (isObjectCall(node)) {
        const literal = node.arguments[0] as ts.ObjectLiteralExpression;
        for (const property of literal.properties) {
          if (!ts.isPropertyAssignment(property)) continue;
          const key = property.name.getText(source).replace(/^['"]|['"]$/g, '');
          const doc = jsdoc(property);
          if (doc) (docs[path] ??= {})[key] = doc;
          walk(property.initializer, `${path}.${key}`);
        }
        // `.superRefine(...)`, `.default(...)` and friends wrap the call.
        ts.forEachChild(node.expression, (child) => walk(child, path));
        return;
      }
      ts.forEachChild(node, (child) => walk(child, path));
    };

    for (const statement of source.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.initializer) {
          walk(declaration.initializer, declaration.name.text);
        }
      }
    }
  }
  return docs;
}

const names = new Map<ZodTypeAny, string>();
for (const [name, value] of Object.entries(schema)) {
  if (value && typeof value === 'object' && '_def' in value && /^[A-Z]/.test(name)) {
    names.set(value as ZodTypeAny, name);
  }
}

const docs = readDocs();
const outputs: Record<string, object> = {
  'offer-feed.schema.json': toJsonSchema(schema.OfferFeed, 'OfferFeed', { names, docs }),
  'catalog-document.schema.json': toJsonSchema(schema.CatalogDocument, 'CatalogDocument', { names, docs }),
  // The ops carry their docs as zod `.describe()`, so they need no source reading.
  'edit-ops.schema.json': toJsonSchema(EditOps, 'EditOps'),
};

const check = process.argv.includes('--check');
let stale = false;
mkdirSync(fileURLToPath(OUT), { recursive: true });
for (const [file, json] of Object.entries(outputs)) {
  const text = `${JSON.stringify(json, null, 2)}\n`;
  const path = fileURLToPath(new URL(file, OUT));
  if (check) {
    let current = '';
    try { current = readFileSync(path, 'utf8'); } catch { /* missing is stale */ }
    if (current !== text) { stale = true; console.error(`stale: docs/schema/${file} — run npm run schema`); }
  } else {
    writeFileSync(path, text);
    console.log(`wrote docs/schema/${file} (${Math.round(text.length / 1024)} KB)`);
  }
}
process.exit(stale ? 1 : 0);
