/**
 * Download published catalogue pages for a chain, as design reference.
 *
 *   npm run refs -- --chain Netto --pages 12
 *   npm run refs -- --chain SuperBrugsen --pages 8
 *   npm run refs -- --catalog t9iPzKfN          # one specific edition
 *
 * The `--catalog` form takes the id a viewer puts in its URL — madpris
 * calls it `publication_id`, Tjek calls it the catalogue id, and they
 * are the same string — so a back issue someone linked can be pulled
 * without hunting for it.
 *
 * These are NOT training data and nothing in the pipeline reads them —
 * the CNN is gone. They exist so a human (or Claude) can look at what the
 * chain actually prints while authoring that brand's templates and CSS.
 * Read-only, rate-limited, resumable: a page already on disk is skipped.
 */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BASE = 'https://squid-api.tjek.com/v2';
const UA = 'incitio-reference/0.1';
const ROOT = new URL('..', import.meta.url);

const args = process.argv.slice(2);
const flag = (name: string, fallback = '') => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1]!.startsWith('--') ? args[i + 1]! : fallback;
};

const chainName = flag('chain', 'Netto');
const catalogId = flag('catalog');
const wanted = Number(flag('pages', '10'));
const size = flag('size', 'view') as 'thumb' | 'view' | 'zoom';

async function api<T>(path: string): Promise<T> {
  const response = await fetch(`${BASE}${path}`, { headers: { 'user-agent': UA } });
  if (!response.ok) throw new Error(`${path} → ${response.status} ${response.statusText}`);
  return (await response.json()) as T;
}

interface Dealer { id: string; name: string }
interface Catalog { id: string; label: string; run_from: string; dealer_id: string }
interface Page { [key: string]: string }

/** Chains share words ("Brugsen"), so an exact name wins over a prefix. */
async function findDealer(name: string): Promise<Dealer> {
  const dealers = await api<Dealer[]>(`/dealers?limit=100&query=${encodeURIComponent(name)}`);
  const exact = dealers.find((d) => d.name.toLowerCase() === name.toLowerCase());
  const dealer = exact ?? dealers[0];
  if (!dealer) throw new Error(`no dealer matches "${name}"`);
  return dealer;
}

let catalog: Catalog;
let label: string;

if (catalogId) {
  catalog = await api<Catalog>(`/catalogs/${catalogId}`);
  label = catalogId;
  console.log(`catalogue  ${catalog.label || catalog.id} (${catalogId})`);
} else {
  const dealer = await findDealer(chainName);
  console.log(`dealer     ${dealer.name} (${dealer.id})`);

  const catalogs = await api<Catalog[]>(`/catalogs?dealer_ids=${dealer.id}&limit=5`);
  const current = catalogs[0];
  if (!current) {
    console.error(`no published catalogue for ${dealer.name} right now`);
    process.exit(1);
  }
  catalog = current;
  label = chainName;
  console.log(`catalogue  ${catalog.label || catalog.id} from ${catalog.run_from.slice(0, 10)}`);
}

const pages = await api<Page[]>(`/catalogs/${catalog.id}/pages`);
const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-');
const outDir = fileURLToPath(new URL(`.data/reference/${slug}`, ROOT));
mkdirSync(outDir, { recursive: true });

let saved = 0;
let skipped = 0;

for (const [index, page] of pages.slice(0, wanted).entries()) {
  const url = page[size] ?? page['view'];
  if (!url) continue;

  const file = `${outDir}/p${String(index + 1).padStart(2, '0')}.jpg`;
  if (existsSync(file)) { skipped += 1; continue; }

  const response = await fetch(url, { headers: { 'user-agent': UA } });
  if (!response.ok) {
    console.warn(`  page ${index + 1}: ${response.status}`);
    continue;
  }
  writeFileSync(file, Buffer.from(await response.arrayBuffer()));
  saved += 1;
  // Courtesy pause — this is someone else's origin serving real traffic.
  await new Promise((resolve) => setTimeout(resolve, 120));
}

console.log(`saved      ${saved} pages (${skipped} already on disk) → ${outDir}`);
