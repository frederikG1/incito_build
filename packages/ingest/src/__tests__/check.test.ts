import { describe, expect, it } from 'vitest';
import { checkMapping, formatReport, type FieldMapping } from '../index.js';

const base = { id: '1', navn: 'Mælk', pris: '9,95', fra: '2026-09-14', til: '2026-09-20', link: 'https://x', billede: '' };
const rows = [base, { ...base, id: '2' }, { ...base, id: '3', pris: 'gratis' }];

const mapping = (over: Partial<FieldMapping> = {}): FieldMapping => ({
  retailerId: 't',
  fields: { id: 'id', name: 'navn', price: 'pris', validFrom: 'fra', validTo: 'til', imageUrl: 'billede' },
  ...over,
});

describe('checkMapping', () => {
  it('counts dropped rows by reason', () => {
    const report = checkMapping(rows, mapping());
    expect(report).toMatchObject({ rows: 3, offers: 2 });
    expect(report.dropped).toEqual([{ reason: 'unparseable price', count: 1, offerIds: ['3'] }]);
    expect(report.warnings).toContain('1 of 3 rows dropped (33%)');
  });

  it('reports fill per Offer field and warns on a thin one', () => {
    const report = checkMapping(rows, mapping());
    expect(report.fields.find((f) => f.field === 'name')).toMatchObject({ filled: 2, sample: 'Mælk' });
    expect(report.warnings).toContain('imageUrl is filled on only 0 of 2 offers');
  });

  it('finds a well-filled column nothing reads — including through a function', () => {
    const report = checkMapping(rows, mapping());
    expect(report.warnings).toContain('column "link" is filled on 3 rows and never read');
    const viaFunction = checkMapping(rows, mapping({
      fields: { ...mapping().fields, description: (row) => String(row['link']) },
    }));
    expect(viaFunction.columns.find((c) => c.key === 'link')?.read).toBe(true);
  });

  it('stays quiet about what the mapping declares, and prints why', () => {
    const report = checkMapping(rows.slice(0, 2), mapping({
      unread: { link: 'web only' },
      sparse: { imageUrl: 'the demo has no pictures', description: 'none', quantity: 'none' },
    }));
    expect(report.warnings).toEqual([]);
    const text = formatReport(report);
    expect(text).toContain('(unread: web only)');
    expect(text).toContain('(sparse: the demo has no pictures)');
  });
});
