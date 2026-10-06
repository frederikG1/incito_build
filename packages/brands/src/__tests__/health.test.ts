import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { brandIds, feedHealth, feedHealthAnyBrand, getBrand } from '../index.js';

const feed = (name: string) => readFileSync(new URL(`../../../../data/feeds/${name}`, import.meta.url), 'utf8');

describe('feed health', () => {
  it('passes a chain feed its own reader knows', () => {
    const health = feedHealth(getBrand('superbrugsen'), feed('SuperBrugsenW36.json'), 'SuperBrugsenW36.json');
    expect(health).toMatchObject({ verdict: 'ok', sourceId: 'coop-export', offers: 160, noImage: { count: 0 } });
    expect(health.validity.from! <= health.validity.to!).toBe(true);
  });

  it('warns when rows are dropped', () => {
    const health = feedHealthAnyBrand(brandIds().map(getBrand), feed('sample-offers.csv'), 'sample-offers.csv');
    expect(health.verdict).toBe('advarsel');
    expect(health.warnings.join(' ')).toMatch(/rækker tabt/);
  });

  it('calls a file no reader recognises unreadable, and says what was closest', () => {
    const health = feedHealth(getBrand('superbrugsen'), JSON.stringify([{ foo: 1, bar: 2 }]), 'x.json');
    expect(health.verdict).toBe('ulæselig');
    expect(health.sourceId).toBeNull();
    expect(health.reason).toMatch(/nærmest|ingen læser/);
  });

  it('counts the offers that will print without a picture', () => {
    const rows = JSON.parse(feed('nemlig.json')) as Record<string, unknown>[];
    const stripped = rows.slice(0, 20).map((row, i) => (i < 3 ? { ...row, RawImage: '', DestinationImageUrlDepend: '' } : row));
    const health = feedHealth(getBrand('nemlig'), JSON.stringify(stripped), 'nemlig.json');
    expect(health.sourceId).not.toBeNull();
    expect(health.noImage.count).toBeGreaterThanOrEqual(1);
  });
});
