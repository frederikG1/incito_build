import { describe, expect, it } from 'vitest';
import { ingestJson } from '@incitio/ingest';
import { getBrand, resolveSource } from '../index.js';

const row = (over: Record<string, unknown> = {}) => ({
  id: 'a', name: 'Lavazza kaffe\n', description: 'Flere varianter. 340-500 g. Frit valg.',
  price: 59, preprice: null, savings: null, membership_price: 59, membership_savings: 25.95,
  unit_symbol: 'gram', unit_size_from: 340, unit_size_to: 500, piece_count_from: 1, piece_count_to: 1,
  image: { signed: 'https://img/a' }, products: [{ image: { signed: 'https://img/b' } }, { image: { signed: 'https://img/c' } }], logos: [],
  valid_from: '2026-09-17T22:00:00.000Z', valid_until: '2026-09-24T22:00:00.000Z',
  comment_label_1: 'Medlemspris', comment_label_2: 'Bjælke: Under halv pris',
  ...over,
});

describe('Tjek transformed offers', () => {
  const text = JSON.stringify([row(), row({ id: 'b', valid_until: null, comment_label_1: '1 pose', membership_price: null })]);
  const match = resolveSource(getBrand('superbrugsen'), text, 'w38.json');

  it('is recognised for SuperBrugsen', () => {
    expect(match.source?.id).toBe('tjek-transformed');
  });

  it('reads price, member price, pack, variants and a missing end date', () => {
    const { feed } = ingestJson(text, match.source!.mapping);
    const [a, b] = feed.offers;
    expect(a).toMatchObject({ name: 'Lavazza kaffe', price: 59, savings: 25.95, pack: '' });
    expect(a!.quantity).toMatchObject({ size: 340, unit: 'g' });
    expect(a!.imagePack).toEqual(['https://img/b', 'https://img/c']);
    expect(a!.labels.map((l) => l.text)).toEqual(['Medlemspris 59', 'Under halv pris']);
    expect(b).toMatchObject({ pack: '1 pose', validTo: a!.validTo });
  });
});
