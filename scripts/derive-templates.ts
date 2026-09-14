/**
 * Read a chain's published pages and write its layout vocabulary.
 *
 *   npm run derive:templates -- --brand superbrugsen --pages 10
 *   npm run derive:templates -- --brand superbrugsen --pages 26 --out data/templates
 *
 * This is the answer to "the templates are hand-drawn, so the model is
 * only ever recombining what someone already decided". It is — and this
 * moves that decision to where the evidence is.
 *
 * The model is NOT asked to lay out a page. It is asked to read the
 * pages the chain actually printed and state the grid underneath each
 * one, as the same `areas` drawing a person would author by hand. What
 * comes back is data of a shape the repo already validates, so every
 * downstream stage — assignment, rendering, the editor, the PDF — is
 * untouched and stays reproducible.
 *
 * Nothing here trusts the model's output. `PageTemplate.parse` and
 * `validateTemplate` run on every candidate, and a template whose grid
 * does not close is reported and dropped rather than written.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { jsonSchemaOutputFormat } from '@anthropic-ai/sdk/helpers/json-schema';
import { PageTemplate, validateTemplate } from '@incitio/schema';
import { getBrand, listBrands } from '@incitio/brands';

const ROOT = new URL('..', import.meta.url);
const args = process.argv.slice(2);
const flag = (name: string, fallback = '') => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1]!.startsWith('--') ? args[i + 1]! : fallback;
};

const brandId = flag('brand', 'superbrugsen');
const wanted = Number(flag('pages', '10'));
const outDir = flag('out', 'data/templates');

let definition;
try {
  definition = getBrand(brandId);
} catch {
  console.error(`ukendt kæde "${brandId}". Kendte: ${listBrands().map((b) => b.id).join(', ')}`);
  process.exit(1);
}
const { brand } = definition;

if (!process.env['ANTHROPIC_API_KEY']) {
  console.error('ANTHROPIC_API_KEY er ikke sat — læg den i .env');
  process.exit(1);
}

const refDir = fileURLToPath(new URL(`.data/reference/${brandId}`, ROOT));
let files: string[];
try {
  files = readdirSync(refDir).filter((f) => /\.jpe?g$/i.test(f)).sort();
} catch {
  console.error(
    `ingen referencesider i .data/reference/${brandId}\n`
    + `  hent dem med:  npm run refs -- --chain ${brand.name}`,
  );
  process.exit(1);
}
if (files.length === 0) {
  console.error(`ingen referencesider i .data/reference/${brandId}`);
  process.exit(1);
}

const pages = files.slice(0, Math.max(1, wanted));
console.log(`kæde       ${brand.name} (${brandId})`);
console.log(`sider      ${pages.length} af ${files.length} (${pages.join(', ')})`);
console.log(`i forvejen ${brand.templates.length} håndtegnede layouts`);

/*
 * The shape a template already has in this repo — not a new one.
 *
 * `bleed` is declared as a percentage so the schema can carry an
 * integer: JSON Schema has no clean way to say "1.0 to 1.6", and a
 * model asked for a float in that range returns 1 or 2 about as often
 * as it returns 1.15.
 */
const SCHEMA = {
  type: 'object',
  properties: {
    templates: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          sourcePage: {
            type: 'string',
            description: 'Which supplied page this grid was read off, e.g. "p05.jpg".',
          },
          name: { type: 'string', description: 'Short Danish name for the shape.' },
          areas: {
            type: 'array',
            items: { type: 'string' },
            description:
              'The grid drawing. One string per row, cell names separated by single spaces. '
              + 'Every row must have the SAME number of cells. A cell name is a slot id; '
              + 'a slot spanning two columns appears twice in a row, a slot spanning two '
              + 'rows appears in both rows.',
          },
          slots: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: {
                  type: 'string',
                  description: 'Lowercase letters and digits, starting with a letter.',
                },
                role: { type: 'string', enum: ['hero', 'feature', 'standard', 'compact'] },
                bleedPercent: {
                  type: 'integer',
                  description:
                    'How far this slot\'s artwork visibly overruns its cell on the printed '
                    + 'page, as a percentage. 100 = stays inside. 115 = prints 15% larger and '
                    + 'over its neighbours. Only for a slot where the overrun is actually '
                    + 'visible in the image.',
                },
              },
              required: ['id', 'role', 'bleedPercent'],
              additionalProperties: false,
            },
          },
          note: {
            type: 'string',
            description: 'One sentence on what this page does that the others do not.',
          },
        },
        required: ['sourcePage', 'name', 'areas', 'slots', 'note'],
        additionalProperties: false,
      },
    },
  },
  required: ['templates'],
  additionalProperties: false,
} as const;

const SYSTEM = `You read published retail leaflet pages and state the grid underneath them.

You are not designing. Each image is a page a chain actually printed, and
your job is to report the structure it already has, the way a designer
would redraw it to hand to a developer.

How to read a page:
- Count the offers. Each offer is one slot. A section heading, a page
  number and a chain logo are not offers and get no slot.
- Work out the column grid the offers align to. Most grocery pages sit on
  4 or 6 columns. Pick the smallest number of columns that every offer
  edge lines up with, then express each offer as the cells it occupies.
- Give each offer a role by how the page treats it:
  hero — the page's lead, printed much larger than the rest
  feature — a band or panel across the page, usually on a coloured field
  standard — an ordinary offer
  compact — a filler, noticeably smaller than the standard offers
  A page where every offer is the same size has NO hero. Do not invent
  one; a flat page is a real and common page.
- bleedPercent is 100 unless the product artwork visibly prints past its
  own cell and over a neighbouring offer. That happens on leads, and it
  is the one thing a grid alone cannot express, so report it where you
  genuinely see it.

Hard rules for the drawing:
- Every row in areas has the same number of cells.
- Every slot id in slots appears in areas, and every name in areas is a
  declared slot. No "." placeholders, no empty cells.
- A slot's cells must form a solid rectangle.
- Report one template per page you are given. If two pages share the
  identical grid, report only the first and say so in its note.`;

const client = new Anthropic();
const started = Date.now();

const images = pages.map((file) => ({
  type: 'image' as const,
  source: {
    type: 'base64' as const,
    media_type: 'image/jpeg' as const,
    data: readFileSync(`${refDir}/${file}`).toString('base64'),
  },
}));

// Labelled, so `sourcePage` can be checked against the image it claims.
const labelled = pages.flatMap((file, i) => [
  { type: 'text' as const, text: `--- ${file} ---` },
  images[i]!,
]);

process.stdout.write('læser      …');
const stream = client.messages.stream({
  model: flag('model', 'claude-sonnet-5'),
  max_tokens: 28000,
  system: SYSTEM,
  thinking: { type: 'adaptive' },
  output_config: { format: jsonSchemaOutputFormat(SCHEMA), effort: 'high' },
  messages: [{
    role: 'user',
    content: [
      {
        type: 'text',
        text: `These are ${pages.length} pages from a published ${brand.name} leaflet.`
          + ' Report the grid underneath each one.',
      },
      ...labelled,
    ],
  }],
});

const response = await stream.finalMessage();
const elapsed = ((Date.now() - started) / 1000).toFixed(1);
if (!response.parsed_output) {
  console.error('\nmodellen returnerede intet læsbart');
  process.exit(1);
}

const proposed = response.parsed_output.templates as {
  sourcePage: string; name: string; areas: string[];
  slots: { id: string; role: string; bleedPercent: number }[];
  note: string;
}[];

console.log(`\rlæste      ${proposed.length} layouts fra ${pages.length} sider  ·  ${elapsed}s`);
console.log(
  `tokens     ${response.usage.input_tokens} ind, ${response.usage.output_tokens} ud`
  + `  ≈ $${((response.usage.input_tokens * 5 + response.usage.output_tokens * 25) / 1e6).toFixed(3)}`,
);

/*
 * Every candidate goes through the same gate a hand-authored template
 * does. A drawing that does not close is a template that renders a
 * short page, and it is silent at runtime — so it is caught here.
 */
/**
 * Rename slots to `a`, `b`, `c`… in reading order.
 *
 * The model names them after what it saw — `lotus`, `marmelade`,
 * `nuggets` — which is a faithful description of one printed page and
 * wrong for a template. A template is a SHAPE, reused next week by
 * whatever offers the feed carries, and a slot called `lotus` holding a
 * pork tenderloin is a lie that also makes the JSON unreadable.
 *
 * Deterministic, so it is done here rather than asked for: a rule the
 * model has to remember is a rule that fails on the tenth page.
 */
function normaliseSlotIds(areas: string[], slots: { id: string }[]) {
  const order: string[] = [];
  for (const row of areas) {
    for (const cell of row.split(' ')) {
      if (cell !== '.' && !order.includes(cell)) order.push(cell);
    }
  }
  // Beyond 26 slots this would collide; no leaflet page comes close,
  // and `PageTemplate` would reject the duplicate if one ever did.
  const renamed = new Map(order.map((id, i) => [id, String.fromCharCode(97 + i)]));
  return {
    areas: areas.map((row) => row.split(' ').map((c) => renamed.get(c) ?? c).join(' ')),
    rename: (id: string) => renamed.get(id) ?? id,
    // A slot the model declared but never drew keeps its name and is
    // caught by `validateTemplate` below, where the message is useful.
    slots,
  };
}

const accepted: PageTemplate[] = [];
const rejected: { name: string; why: string }[] = [];

for (const candidate of proposed) {
  const id = `${brandId}/ref-${candidate.sourcePage.replace(/\.jpe?g$/i, '')}`;
  const tidied = candidate.areas.map((row) => row.trim().replace(/\s+/g, ' '));
  const normalised = normaliseSlotIds(tidied, candidate.slots);
  const parsed = PageTemplate.safeParse({
    id,
    name: candidate.name,
    areas: normalised.areas,
    slots: candidate.slots.map((s) => ({
      id: normalised.rename(s.id),
      role: s.role,
      // Clamped to what the schema allows rather than rejected: a model
      // that says 200% has seen a real overrun and misjudged its size,
      // which is worth keeping at the largest size the renderer permits.
      bleed: Math.min(1.6, Math.max(1, (s.bleedPercent ?? 100) / 100)),
    })),
  });

  if (!parsed.success) {
    rejected.push({
      name: `${candidate.sourcePage} ${candidate.name}`,
      why: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    });
    continue;
  }

  const problems = validateTemplate(parsed.data);
  if (problems.length > 0) {
    rejected.push({ name: `${candidate.sourcePage} ${candidate.name}`, why: problems.join('; ') });
    continue;
  }
  accepted.push(parsed.data);
}

console.log(`\ngodkendt   ${accepted.length} af ${proposed.length}`);
for (const t of accepted) {
  const roles = t.slots.map((s) => s.role[0]).join('');
  const bleed = t.slots.some((s) => s.bleed > 1) ? '  bleed' : '';
  console.log(
    `  ${t.id.padEnd(26)} ${String(t.slots.length).padStart(2)} pladser  `
    + `${t.areas[0]!.split(' ').length} kolonner  ${roles.padEnd(9)}${bleed}  ${t.name}`,
  );
}
if (rejected.length > 0) {
  console.log(`\nafvist     ${rejected.length}`);
  for (const r of rejected) console.log(`  ${r.name}\n    ↳ ${r.why}`);
}

const dir = fileURLToPath(new URL(outDir, ROOT));
mkdirSync(dir, { recursive: true });
const path = `${dir}/${brandId}.json`;
writeFileSync(path, `${JSON.stringify({
  brandId,
  derivedFrom: pages,
  derivedAt: new Date().toISOString(),
  templates: accepted,
  notes: Object.fromEntries(proposed.map((p) => [p.sourcePage, p.note])),
}, null, 2)}\n`);
console.log(`\nskrev      ${path}`);
