/**
 * Generates a stand-in retailer feed plus matching product cutouts.
 *
 * Exists so the pipeline can be built and visually judged before real
 * feeds and real photography arrive. The CSV is deliberately messy —
 * Danish decimal commas, semicolon delimiter, quoted descriptions with
 * embedded separators, a duplicate row and a broken row — because the
 * ingest layer's whole job is surviving that.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(join(root, 'data/images'), { recursive: true });
mkdirSync(join(root, 'data/feeds'), { recursive: true });

const PALETTES = [
  ['#c62828', '#ef9a9a'], ['#1565c0', '#90caf9'], ['#2e7d32', '#a5d6a7'],
  ['#ef6c00', '#ffcc80'], ['#6a1b9a', '#ce93d8'], ['#00838f', '#80deea'],
  ['#4e342e', '#bcaaa4'], ['#f9a825', '#fff59d'], ['#ad1457', '#f48fb1'],
];

/** Deterministic hash so a given offer id always gets the same artwork. */
function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

const SHAPES = {
  bottle: (a, b) => `
    <path d="M86 40h28v26c0 8 22 20 22 44v104c0 12-8 20-20 20H76c-12 0-20-8-20-20V110c0-24 22-36 22-44V40z" fill="${a}"/>
    <rect x="82" y="24" width="36" height="20" rx="4" fill="${b}"/>
    <rect x="56" y="128" width="88" height="46" fill="#fff" opacity="0.92"/>
    <rect x="64" y="140" width="72" height="8" rx="4" fill="${a}"/>
    <rect x="64" y="154" width="48" height="6" rx="3" fill="${b}"/>`,
  carton: (a, b) => `
    <path d="M56 74l44-26 44 26v134c0 6-4 10-10 10H66c-6 0-10-4-10-10V74z" fill="${a}"/>
    <path d="M56 74l44-26 44 26-44 22z" fill="${b}"/>
    <rect x="68" y="128" width="64" height="52" fill="#fff" opacity="0.92"/>
    <circle cx="100" cy="150" r="14" fill="${a}"/>
    <rect x="76" y="170" width="48" height="6" rx="3" fill="${b}"/>`,
  can: (a, b) => `
    <rect x="62" y="52" width="76" height="164" rx="12" fill="${a}"/>
    <ellipse cx="100" cy="56" rx="38" ry="10" fill="${b}"/>
    <rect x="62" y="112" width="76" height="48" fill="#fff" opacity="0.92"/>
    <rect x="72" y="126" width="56" height="9" rx="4" fill="${a}"/>
    <rect x="72" y="142" width="36" height="6" rx="3" fill="${b}"/>`,
  bag: (a, b) => `
    <path d="M60 78c0-10 8-16 18-16h44c10 0 18 6 18 16l10 128c1 10-6 18-16 18H66c-10 0-17-8-16-18z" fill="${a}"/>
    <path d="M78 62c0-14 10-24 22-24s22 10 22 24" fill="none" stroke="${b}" stroke-width="9"/>
    <rect x="70" y="130" width="60" height="46" fill="#fff" opacity="0.9"/>
    <rect x="80" y="144" width="40" height="8" rx="4" fill="${a}"/>`,
  jar: (a, b) => `
    <rect x="66" y="70" width="68" height="146" rx="16" fill="${a}"/>
    <rect x="72" y="46" width="56" height="28" rx="6" fill="${b}"/>
    <rect x="66" y="118" width="68" height="52" fill="#fff" opacity="0.92"/>
    <circle cx="100" cy="140" r="13" fill="${b}"/>
    <rect x="78" y="158" width="44" height="6" rx="3" fill="${a}"/>`,
  produce: (a, b) => `
    <circle cx="100" cy="140" r="66" fill="${a}"/>
    <ellipse cx="78" cy="116" rx="20" ry="26" fill="${b}" opacity="0.5"/>
    <path d="M100 74c4-18 16-28 32-30-2 18-14 28-32 30z" fill="#2e7d32"/>
    <rect x="96" y="60" width="8" height="22" rx="4" fill="#5d4037"/>`,
  box: (a, b) => `
    <rect x="52" y="76" width="96" height="140" rx="6" fill="${a}"/>
    <rect x="52" y="76" width="96" height="30" fill="${b}"/>
    <rect x="66" y="124" width="68" height="60" fill="#fff" opacity="0.92"/>
    <rect x="76" y="140" width="48" height="9" rx="4" fill="${a}"/>
    <rect x="76" y="156" width="32" height="7" rx="3" fill="${b}"/>`,
};

const SHAPE_NAMES = Object.keys(SHAPES);

function makeImage(id) {
  const h = hash(id);
  const shape = SHAPE_NAMES[h % SHAPE_NAMES.length];
  const [a, b] = PALETTES[(h >> 3) % PALETTES.length];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 240" width="200" height="240">
  <g>${SHAPES[shape](a, b)}</g>
</svg>`;
}

const CATALOG = [
  ['mejeri', [
    ['Arla', 'Letmælk', 'carton', 'Frisk letmælk fra danske gårde, 1,5% fedt', '1 l', 9.95, 12.95],
    ['Cheasy', 'Skyr Vanilje', 'jar', 'Fedtfattig skyr med vanilje', '450 g', 16.00, 22.50],
    ['Lurpak', 'Smør', 'box', 'Saltet smør, klassisk', '200 g', 24.95, 32.00],
    ['Arla', 'Cheddar Revet', 'bag', 'Revet cheddar, moden', '150 g', 18.95, null],
    ['Thise', 'Økologisk Yoghurt', 'jar', 'Økologisk naturel yoghurt', '1 l', 21.00, 26.00],
    ['Karolines', 'Fløde 38%', 'carton', 'Piskefløde til madlavning og dessert', '250 ml', 12.50, null],
  ]],
  ['frugt-og-groent', [
    ['', 'Danske Æbler', 'produce', 'Sprøde danske æbler, klasse 1', '1 kg', 14.95, 24.95],
    ['', 'Bananer', 'produce', 'Fairtrade bananer', '1 kg', 12.00, 16.00],
    ['', 'Avocado', 'produce', 'Spiseklar avocado', '2 stk.', 20.00, 30.00],
    ['', 'Cherrytomater', 'box', 'Søde cherrytomater på stilk', '250 g', 11.95, 15.95],
    ['', 'Agurk', 'produce', 'Dansk drivhusagurk', '1 stk.', 7.95, null],
    ['', 'Blåbær', 'box', 'Friske blåbær', '125 g', 15.00, 22.00],
  ]],
  ['drikkevarer', [
    ['Coca-Cola', 'Coca-Cola Zero', 'bottle', 'Sukkerfri sodavand', '1,5 l', 15.95, 24.95],
    ['Carlsberg', 'Pilsner', 'can', 'Dansk pilsner, 4,6%', '6 x 33 cl', 49.00, 69.00],
    ['Rynkeby', 'Appelsinjuice', 'carton', 'Juice af presset appelsin', '1 l', 17.95, 22.95],
    ['San Pellegrino', 'Mineralvand', 'bottle', 'Kulsyreholdigt mineralvand', '75 cl', 14.00, null],
    ['Nescafé', 'Instant Kaffe', 'jar', 'Frysetørret instant kaffe', '200 g', 55.00, 79.00],
  ]],
  ['koed-og-fisk', [
    ['', 'Hakket Oksekød 8-12%', 'box', 'Dansk hakket oksekød', '500 g', 32.00, 45.00],
    ['', 'Kyllingebryst', 'box', 'Fersk kyllingebryst uden skind', '600 g', 55.00, 75.00],
    ['', 'Laksefilet', 'box', 'Norsk laksefilet uden skind', '250 g', 45.00, 60.00],
    ['Tulip', 'Bacon i Skiver', 'bag', 'Røget bacon i skiver', '140 g', 15.95, 21.95],
  ]],
  ['kolonial', [
    ['Barilla', 'Spaghetti', 'box', 'Italiensk spaghetti nr. 5', '500 g', 12.95, 17.95],
    ['Urtekram', 'Økologisk Havregryn', 'bag', 'Økologiske havregryn', '1 kg', 18.00, 24.00],
    ['Heinz', 'Ketchup', 'bottle', 'Tomatketchup, klassisk', '570 g', 22.95, 29.95],
    ['Castello', 'Olivenolie Ekstra Jomfru', 'bottle', 'Koldpresset olivenolie', '500 ml', 42.00, 58.00],
    ['Toms', 'Guldbarre', 'box', 'Mørk chokolade med nougat', '160 g', 25.00, 34.00],
    ['Kims', 'Chips Salt', 'bag', 'Klassiske saltede chips', '170 g', 16.95, 22.95],
  ]],
];

const rows = [];
let counter = 1;
const validFrom = '2026-09-14';
const validTo = '2026-09-20';

for (const [category, items] of CATALOG) {
  for (const [brand, name, , description, quantity, price, prePrice] of items) {
    const id = `SKU-${String(counter).padStart(4, '0')}`;
    counter += 1;
    writeFileSync(join(root, 'data/images', `${id}.svg`), makeImage(id));

    const labels = [];
    if (prePrice && (prePrice - price) / prePrice > 0.3) labels.push('Spar stort');
    if (name.toLowerCase().includes('øko')) labels.push('Økologisk');
    if (counter % 7 === 0) labels.push('Medlemspris');
    if (counter % 11 === 0) labels.push('2 for 1');

    rows.push({
      artikelnr: id,
      varenavn: name,
      maerke: brand,
      kategori: category,
      // Danish decimal comma, and a thousands separator on the big numbers.
      pris: price.toFixed(2).replace('.', ','),
      foerpris: prePrice === null ? '' : prePrice.toFixed(2).replace('.', ','),
      maengde: quantity,
      beskrivelse: description,
      billede: `/images/${id}.svg`,
      gyldig_fra: '14-09-2026',
      gyldig_til: '20-09-2026',
      etiketter: labels.join('|'),
    });
  }
}

const header = Object.keys(rows[0]);
const escape = (value) => (/[";\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
const lines = [header.join(';')];
for (const row of rows) lines.push(header.map((k) => escape(String(row[k]))).join(';'));

// Deliberate defects for the ingest tests to trip over.
lines.push(lines[1]);                                     // duplicate id
lines.push(`SKU-9999;;;kolonial;19,95;;500 g;;;14-09-2026;20-09-2026;`); // missing name
lines.push(`SKU-9998;Mystisk Vare;;kolonial;ikke-et-tal;;1 stk.;;;14-09-2026;20-09-2026;`); // bad price

writeFileSync(join(root, 'data/feeds/sample-offers.csv'), lines.join('\n') + '\n', 'utf8');
console.log(`wrote ${rows.length} offers + ${rows.length} images (validity ${validFrom}..${validTo})`);
