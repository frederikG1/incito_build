import type { Offer } from '@incitio/schema';

/**
 * Which part of the shop an offer belongs to.
 *
 * A feed's own `category` cannot answer this across weeks: Coop's
 * export says "Kolonial og Dybfrost", Tjek's says "Snacks og slik", and
 * a publication read off a link says "Side 12". Carrying last week's
 * frozen spread into this week needs one vocabulary all three can be
 * read into — so it is read off the words the shopper reads, the name
 * and the underline, with the feed's category as the last witness.
 *
 * Deterministic and dumb on purpose. A department is a tag an employee
 * has to be able to predict ("dybfrost" → Frost, every time), and a
 * wrong guess costs one drag in the studio, not a reprint.
 */
export const DEPARTMENTS = [
  'frost', 'koed', 'paalaeg', 'mejeri', 'broed', 'frugt',
  'slik', 'vin', 'drikke', 'kolonial', 'pleje', 'husholdning', 'dyr', 'nonfood',
] as const;
export type Department = (typeof DEPARTMENTS)[number];

export const DEPARTMENT_NAMES: Record<Department, string> = {
  frost: 'Frost',
  koed: 'Kød & fisk',
  paalaeg: 'Pålæg & færdigretter',
  mejeri: 'Mejeri & ost',
  broed: 'Brød & bagværk',
  frugt: 'Frugt & grønt',
  slik: 'Slik & snacks',
  vin: 'Øl, vin & spiritus',
  drikke: 'Drikkevarer',
  kolonial: 'Kolonial',
  pleje: 'Personlig pleje',
  husholdning: 'Husholdning',
  dyr: 'Dyr',
  nonfood: 'Nonfood',
};

/**
 * Departments that may stand in for each other when a page runs short.
 *
 * A juice on the meat page is worse than an empty cell somebody fills
 * by hand; a leverpostej on the meat page is what the chain would have
 * printed anyway.
 */
const FAMILIES: Department[][] = [
  ['koed', 'paalaeg', 'mejeri', 'broed', 'frugt'],
  ['frost', 'kolonial'],
  ['slik', 'drikke', 'vin'],
  ['pleje', 'husholdning', 'dyr', 'nonfood'],
];

export function familyOf(department: Department): Department[] {
  return FAMILIES.find((family) => family.includes(department)) ?? [department];
}

/** Word-bounded, for the short words that live inside longer ones ("øl" in "pølse"). */
const L = 'a-zæøåäöü0-9';
function w(word: string): RegExp {
  return new RegExp(`(?<![${L}])${word}(?![${L}])`, 'u');
}
function any(...parts: (string | RegExp)[]): RegExp[] {
  return parts.map((part) => (typeof part === 'string' ? new RegExp(part, 'u') : part));
}

/*
 * First match wins, so the ORDER is the rule set: "dybfrost" is read
 * before "kylling", which is why frozen chicken lands in Frost; "vingummi"
 * before "vin"; "pålæg" before "kylling", because "kyllingepålæg" is
 * pålæg.
 */
const RULES: [Department, RegExp[]][] = [
  ['frost', any('dybfrost', 'frost', w('is'), 'isvaffel', 'flødeis', 'sorbet', 'pommes frites', 'mini frikadeller', 'minifrikadeller')],
  ['dyr', any('gourmet gold', 'beef stick', 'hundefoder', 'kattefoder', 'kattegrus', 'kattesnack', 'hundesnack', w('whiskas'), w('pedigree'), w('felix'))],
  ['pleje', any('sensodyne', 'parodontax', 'shampoo', 'balsam', 'deodorant', w('deo'), 'tandpasta', 'tandbørste', 'shower', 'bodylotion', 'hudpleje', 'håndsæbe', 'barber', 'bleer', 'vådserviet', 'hårspray', 'roll-on', 'dagcreme', 'natcreme', 'vitamin')],
  ['husholdning', any('opbevaring', 'ovnfast', 'vaskemiddel', 'opvask', 'toiletpapir', 'køkkenrulle', 'rengøring', 'skyllemiddel', 'affaldspose', 'fryseposer', 'stearinlys', 'fyrfad', 'batteri', 'sølvpapir', 'husholdningsfilm', 'wc-', 'klorin', 'servietter')],
  ['slik', any('flødebolle', 'slik', 'chokolade', 'chips', 'nødder', 'snacks', w('kiks'), 'småkager', 'lakrids', 'vingummi', 'skumfidus', 'popcorn', 'm&m', 'maltesers', 'marabou', 'haribo', 'toms', 'pringles', 'pastiller', 'tyggegummi', 'mandler', 'peanuts', 'cashew')],
  ['vin', any('rødvin', 'hvidvin', w('rosé'), 'mousserende', 'champagne', w('cava'), 'prosecco', 'spiritus', w('gin'), 'whisky', 'vodka', w('rom'), 'likør', 'snaps', 'akvavit', w('øl'), 'pilsner', w('ale'), w('ipa'), 'carlsberg', 'tuborg', 'heineken', w('cider'), w('vin'), 'vine', 'bobler', 'porter', 'chardonnay', 'riesling', 'merlot', 'cabernet', 'sauvignon', 'pinot', 'shiraz', 'primitivo', 'zinfandel', 'rioja', 'amarone', 'brunello', 'ripasso', 'barbera', 'chianti', 'côtes', 'chateau', 'château', 'cognac', w('vsop'), 'tawny', w('port'), 'frizzante', 'sparkling', 'smirnoff', 'breezer', w('1664'), 'bavaria', 'grimbergen', 'jacobsen', 'aperol', 'campari', 'baileys', 'i boks')],
  ['paalaeg', any('smørrebrød', 'k-salat', 'kartoffelsalat', 'remoulade', 'pålæg', 'leverpostej', 'postej', 'salami', 'rullepølse', 'spegepølse', 'hamburgerryg', w('skinke'), 'kogt skinke', 'smørepålæg', 'sandwich', 'færdigret', 'maxiret', 'sushi', 'salat med', 'hønsesalat', 'tapas', 'tærte')],
  ['koed', any('oksekød', 'okse', 'hakket', w('gris'), 'svinekød', 'kylling', 'kalkun', 'mørbrad', 'flæsk', 'bøf', 'fars', 'pølse', 'bacon', 'medister', 'kotelet', 'koteletter', 'steg', 'schnitzel', 'frikadelle', w('lam'), 'lammekød', 'entrecote', 'culotte', 'filet', 'laks', w('fisk'), 'fiske', 'rejer', 'torsk', 'sild', 'tun', 'rødspætte', 'muslinger', 'kød')],
  ['mejeri', any('mælk', 'yoghurt', w('skyr'), 'smør', 'fløde', 'burrata', 'mozzarella', w('æg'), 'hytteost', 'kærnemælk', 'actimel', 'danonino', 'creme fraiche', 'cremefraiche', 'ymer', 'koldskål', 'margarine', 'kvark', /ost(?![a-zæøå])/u, 'brie', 'feta', 'parmesan', 'cheddar')],
  ['broed', any('snegl', 'wienerstang', 'kringle', 'lagkage', 'brød', 'rundstykke', 'bolle', 'boller', 'croissant', w('toast'), 'wienerbrød', 'knækbrød', 'kage', 'bagel', 'pitabrød', 'flûtes', 'flute', 'baguette', 'kanelsnegl', 'kernestykke')],
  ['frugt', any('banan', 'æble', 'pære', 'appelsin', 'mandarin', 'clementin', 'citron', 'lime', 'tomat', 'agurk', w('salat'), 'kartof', w('løg'), 'gulerod', 'gulerødder', 'avocado', 'druer', 'jordbær', 'hindbær', 'blåbær', 'brombær', 'melon', 'ananas', 'mango', 'kiwi', 'blomst', 'buket', 'tulipan', 'svampe', 'champignon', 'peberfrugt', 'squash', 'broccoli', w('kål'), 'porre', 'spinat', 'frugt', 'grønt', 'krydderurt', 'krysantemum', 'potteplante', 'dahlia', 'ingefær')],
  ['drikke', any('ingefærshot', w('shot'), 'rynkeby', 'squash', 'sodavand', 'juice', w('cola'), 'pepsi', 'faxe', 'kondi', 'booster', 'kildevand', 'danskvand', w('vand'), 'kaffe', 'espresso', 'kapsler', w('te'), 'saft', 'kakao', 'energidrik', 'red bull', 'monster', 'smoothie', 'iste', 'pellegrino')],
  ['kolonial', any('pasta', w('ris'), w('mel'), 'sukker', 'sauce', 'bouillon', 'fond', 'dressing', 'ketchup', 'mayo', 'sennep', 'remoulade', 'konserves', 'müsli', 'musli', 'granola', 'havregryn', 'cornflakes', 'morgenmad', 'olie', 'krydderi', 'spice', 'tortilla', 'taco', 'nudler', 'suppe', 'syltetøj', 'marmelade', 'honning', 'pesto', 'eddike', 'bønner', 'kikærter', 'dåse', 'snackpot', 'buns')],
  ['nonfood', any('bolig', 'elektronik', 'tøj', 'sengetøj', 'dyne', 'pude', 'gryde', 'pande', 'lampe', 'legetøj', 'strømper', 'håndklæde', 'køkken', 'kniv', 'termo', 'højtaler', 'hovedtelefon', 'oplader', 'kabel', 'værktøj', 'plæne', 'grill', 'havemøbel', 'blad', 'magasin')],
];

/** The feeds' own words for a department, when the product's words said nothing. */
const CATEGORY_RULES: [Department, RegExp][] = [
  ['vin', /vin|spiritus|øl/u],
  ['slik', /slik|snack|nydelses|kiosk/u],
  ['drikke', /drikke/u],
  ['frugt', /frugt|grønt|blomst/u],
  ['mejeri', /mejeri/u],
  ['broed', /brød|bager/u],
  ['koed', /kød|fisk/u],
  ['paalaeg', /viktualier|pålæg/u],
  ['frost', /frost/u],
  ['pleje', /pleje|helse/u],
  ['husholdning', /hushold/u],
  ['nonfood', /bolig|elektronik|nonfood|tekstil/u],
  ['kolonial', /kolonial/u],
];

function readOf(text: string): Department | null {
  for (const [department, patterns] of RULES) {
    if (patterns.some((pattern) => pattern.test(text))) return department;
  }
  return null;
}

/**
 * The department, from the product's own words first.
 *
 * The NAME is read alone before the name and the underline together:
 * "Coop kartofler — Dybfrost" is frost because the underline says so,
 * but "Thise burrata — frisk mozzarella til salaten" is dairy, not
 * greens, because the name already answered.
 */
export function departmentOf(offer: Pick<Offer, 'name' | 'description' | 'category'>): Department {
  const name = offer.name.toLowerCase();
  const description = offer.description.toLowerCase();
  const category = offer.category.toLowerCase();
  // Frozen is only ever said in the underline, and overrides the name.
  if (/dybfrost|frost/u.test(description)) return 'frost';
  const named = readOf(name);
  if (named) return named;
  /*
   * A category that names ONE department beats the underline, because
   * underlines wander: a wine's says "passer til fisk og kød", a sweet's
   * says "kan indeholde spor af nødder". Combined ones ("Kolonial og
   * Dybfrost") are read after it.
   */
  if (!/ og |,/u.test(category)) {
    for (const [department, pattern] of CATEGORY_RULES) {
      if (pattern.test(category)) return department;
    }
  }
  const described = readOf(description);
  if (described) return described;
  for (const [department, pattern] of CATEGORY_RULES) {
    if (pattern.test(category)) return department;
  }
  return 'kolonial';
}

/**
 * What a page is ABOUT, from what it carries.
 *
 * `null` for a mixed page — the front page, a "Ugens bedste" spread —
 * which is what tells `carryForward` to deal it the strongest offers of
 * the week regardless of where they come from.
 */
export function pageDepartment(offers: Pick<Offer, 'name' | 'description' | 'category'>[]): Department | null {
  if (offers.length === 0) return null;
  const counts = new Map<Department, number>();
  for (const offer of offers) {
    const department = departmentOf(offer);
    counts.set(department, (counts.get(department) ?? 0) + 1);
  }
  const [top, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]!;
  // A department that holds at least half the page names it.
  return n / offers.length >= 0.5 ? top : null;
}
