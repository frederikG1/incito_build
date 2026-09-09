import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  matchLabel,
  matchLabels,
  parseLabelDictionary,
  resolveLabels,
  type LabelDictionary,
} from '../labels.js';

const rows = [
  {
    id: 'organic',
    title: 'Økologi',
    link: 'http://www.coopokologi.dk',
    pattern: '(^økologi$)|(^økologi logo$)|(^økologisk$)',
    positive_image: 'https://example.test/oko.svg',
    negative_image: '',
  },
  {
    id: 'fairtrade',
    title: 'Fairtrade',
    link: '',
    pattern: '(^fairtrade$)|(^fairtrade logo$)',
    positive_image: 'https://example.test/fairtrade.svg',
    negative_image: 'https://example.test/fairtrade-neg.svg',
  },
  // Capitalised pattern: the case the source export gets wrong 85 times.
  {
    id: 'birkenstock',
    title: 'Birkenstock',
    link: '',
    pattern: '^Birkenstock$',
    positive_image: 'https://example.test/birkenstock.png',
    negative_image: '',
  },
];

function build(input: unknown = rows): LabelDictionary {
  return parseLabelDictionary(input).dictionary;
}

describe('parseLabelDictionary', () => {
  it('reads the snake_case spelling', () => {
    const { dictionary, issues } = parseLabelDictionary(rows);
    expect(issues).toEqual([]);
    expect(dictionary.entries).toHaveLength(3);
    expect(dictionary.byId.get('organic')?.title).toBe('Økologi');
  });

  it('reads the human-header spelling the CSV export also ships', () => {
    const dictionary = build([
      {
        ID: 'noglehul',
        'Title (optional)': 'Nøglehul',
        'Link (optional)': '',
        Pattern: '^nøglehul$',
        'Positive Image URL': 'https://example.test/noglehul.svg',
        'Negative Image URL': '',
      },
    ]);
    expect(dictionary.byId.get('noglehul')?.image).toBe('https://example.test/noglehul.svg');
  });

  it('accepts raw JSON text', () => {
    const dictionary = build(JSON.stringify(rows));
    expect(dictionary.entries).toHaveLength(3);
  });

  it('reports unparseable JSON instead of throwing', () => {
    const { dictionary, issues } = parseLabelDictionary('{not json');
    expect(dictionary.entries).toEqual([]);
    expect(issues[0]?.reason).toContain('unparseable JSON');
  });

  it('drops rows with no pattern and says why', () => {
    const { dictionary, issues } = parseLabelDictionary([
      ...rows,
      { id: '', title: '', link: '', pattern: '', positive_image: '', negative_image: '' },
    ]);
    expect(dictionary.entries).toHaveLength(3);
    expect(issues).toEqual([
      { rowIndex: 3, labelId: null, reason: 'empty pattern, row unusable' },
    ]);
  });

  it('drops rows whose regex will not compile', () => {
    const { dictionary, issues } = parseLabelDictionary([
      { id: 'broken', title: '', link: '', pattern: '^(unclosed$', positive_image: '', negative_image: '' },
    ]);
    expect(dictionary.entries).toEqual([]);
    expect(issues[0]?.reason).toContain('invalid regex');
  });

  it('keeps both definitions of a duplicated id but resolves lookup to the first', () => {
    const { dictionary, issues } = parseLabelDictionary([
      { id: 'stolt', title: 'Stolt', link: '', pattern: '^stolt$', positive_image: 'https://example.test/a.svg', negative_image: '' },
      { id: 'stolt', title: 'Stolt', link: '', pattern: '(^stolt$)|(^stolt - kød$)', positive_image: 'https://example.test/b.svg', negative_image: '' },
    ]);
    expect(dictionary.entries).toHaveLength(2);
    expect(dictionary.byId.get('stolt')?.image).toBe('https://example.test/a.svg');
    expect(issues[0]?.reason).toContain('duplicate id');
    // The variant pattern is still real coverage and must stay matchable.
    expect(matchLabel(dictionary, 'stolt - kød')?.id).toBe('stolt');
  });

  // The label image is written straight into an <img src>, so it goes
  // through the same scheme guard as an offer image.
  it('rejects an active-scheme image URL but keeps the mark', () => {
    const { dictionary, issues } = parseLabelDictionary([
      { id: 'x', title: 'X', link: '', pattern: '^x$', positive_image: 'javascript:alert(1)', negative_image: '' },
    ]);
    expect(dictionary.byId.get('x')?.image).toBeNull();
    expect(issues[0]?.reason).toContain('unusable image URL');
  });

  it('classifies certification marks it knows and leaves the rest custom', () => {
    const dictionary = build();
    expect(dictionary.byId.get('organic')?.kind).toBe('organic');
    expect(dictionary.byId.get('fairtrade')?.kind).toBe('custom');
    expect(dictionary.byId.get('birkenstock')?.kind).toBe('custom');
  });
});

describe('matchLabel', () => {
  it('matches an alternation branch', () => {
    expect(matchLabel(build(), 'økologisk')?.id).toBe('organic');
  });

  // Without the `i` flag a quarter of the shipped dictionary is dead.
  it('matches regardless of the case the pattern was filed in', () => {
    expect(matchLabel(build(), 'birkenstock')?.id).toBe('birkenstock');
    expect(matchLabel(build(), 'ØKOLOGI')?.id).toBe('organic');
  });

  it('tolerates whitespace padding from feed markup', () => {
    expect(matchLabel(build(), '  fairtrade\n')?.id).toBe('fairtrade');
  });

  // Patterns are anchored by construction; unanchoring them would tag
  // every "Rocky Road" as the Rocky brand.
  it('does not match a label word buried in prose', () => {
    expect(matchLabel(build(), 'Økologisk gulerødder 1 kg')).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(matchLabel(build(), '   ')).toBeNull();
  });
});

describe('matchLabels', () => {
  it('resolves several candidates and de-duplicates by mark', () => {
    const found = matchLabels(build(), ['fairtrade', 'økologi', 'økologi logo']);
    expect(found.map((f) => f.id)).toEqual(['fairtrade', 'organic']);
  });

  it('skips candidates with no registered mark', () => {
    expect(matchLabels(build(), ['nyhed']).length).toBe(0);
  });
});

describe('resolveLabels', () => {
  it('attaches artwork to a recognised mark', () => {
    expect(resolveLabels(build(), ['økologi'])).toEqual([
      { kind: 'organic', text: 'Økologi', image: 'https://example.test/oko.svg', imageOnDark: null },
    ]);
  });

  it('carries the light-background variant when the dictionary has one', () => {
    expect(resolveLabels(build(), ['fairtrade'])[0]?.imageOnDark).toBe(
      'https://example.test/fairtrade-neg.svg',
    );
  });

  // Dropping unrecognised badges is invisible in the finished catalog,
  // which makes it the worst available failure mode.
  it('keeps an unrecognised badge as a plain text label', () => {
    expect(resolveLabels(build(), ['Nyhed'])).toEqual([
      { kind: 'custom', text: 'Nyhed', image: null, imageOnDark: null },
    ]);
  });

  it('de-duplicates unrecognised badges case-insensitively', () => {
    expect(resolveLabels(build(), ['Nyhed', 'nyhed'])).toHaveLength(1);
  });

  it('preserves candidate order', () => {
    const labels = resolveLabels(build(), ['Nyhed', 'økologi', 'fairtrade']);
    expect(labels.map((l) => l.text)).toEqual(['Nyhed', 'Økologi', 'Fairtrade']);
  });
});

// Guards the shipped dictionary itself, not just the parser: a re-export
// from Tjek that halves the mark count should fail here, loudly.
describe('the shipped Tjek dictionary', () => {
  const text = readFileSync(
    fileURLToPath(new URL('../../../../data/labels/tjek-labels.json', import.meta.url)),
    'utf8',
  );
  const { dictionary, issues } = parseLabelDictionary(text);

  it('loads with only the known-bad rows reported', () => {
    expect(dictionary.entries.length).toBeGreaterThan(340);
    // Two blank placeholder rows, eight duplicate ids.
    expect(issues.filter((i) => i.reason.includes('unusable')).length).toBe(2);
    expect(issues.every((i) => i.reason.includes('unusable') || i.reason.includes('duplicate'))).toBe(true);
  });

  it('resolves the marks retailers actually ask for', () => {
    for (const [candidate, id] of [
      ['økologi', 'organic'],
      ['fairtrade', 'fairtrade'],
      ['nøglehul', 'noglehul'],
      ['svanemærket', 'svanemarke'],
      ['änglamark', 'anglamark'],
      ['fuldkorn', 'fuldkorn'],
    ] as const) {
      expect(matchLabel(dictionary, candidate)?.id, candidate).toBe(id);
    }
  });

  it('gives every mark it resolves a usable image', () => {
    const oko = matchLabel(dictionary, 'økologi');
    expect(oko?.image).toBe('/labels/marks/organic.svg');
    expect(oko?.kind).toBe('organic');
  });

  // Google Drive serves a download interstitial, not an image: an <img>
  // pointed at one hangs rather than failing, so the tile shows nothing
  // and never falls back. The seven marks that shipped that way — the
  // Ø-mark and Nøglehul among them — are mirrored under data/labels/marks.
  it('hosts no mark on Google Drive', () => {
    const drive = dictionary.entries.filter((e) => e.image?.includes('drive.google.com'));
    expect(drive.map((e) => e.id)).toEqual([]);
  });

  it('mirrors the marks Danish retailers ask for most locally', () => {
    for (const id of ['organic', 'noglehul', 'svanemarke', 'msc']) {
      expect(dictionary.byId.get(id)?.image, id).toMatch(/^\/labels\/marks\//);
    }
  });
});
