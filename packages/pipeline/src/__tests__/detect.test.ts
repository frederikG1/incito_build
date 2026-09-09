import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { detectFeed } from '../detect.js';

const feed = (name: string) =>
  fileURLToPath(new URL(`../../../../data/feeds/${name}`, import.meta.url));

describe('detectFeed', () => {
  it.runIf(existsSync(feed('nemlig.json')))('recognises the nemlig export', () => {
    const result = detectFeed(readFileSync(feed('nemlig.json'), 'utf8'), 'nemlig.json');
    expect(result.retailer?.id).toBe('nemlig');
    expect(result.format).toBe('json');
  });

  // Records sit two levels down, so a reader that only looks at the top
  // level of the JSON finds nothing to match on.
  it.runIf(existsSync(feed('SuperBrugsenW36.json')))('reaches nested Coop records', () => {
    const result = detectFeed(readFileSync(feed('SuperBrugsenW36.json'), 'utf8'), 'sb.json');
    expect(result.retailer?.id).toBe('superbrugsen');
  });

  it.runIf(existsSync(feed('sample-offers.csv')))('recognises a semicolon CSV', () => {
    const result = detectFeed(readFileSync(feed('sample-offers.csv'), 'utf8'), 'x.csv');
    expect(result.retailer?.id).toBe('sample');
    expect(result.format).toBe('csv');
  });

  it('reports unknown shapes rather than guessing', () => {
    const result = detectFeed(JSON.stringify([{ foo: 1, bar: 2 }]), 'x.json');
    expect(result.retailer).toBeNull();
    expect(result.fields).toEqual(['foo', 'bar']);
    expect(result.reason).toContain('no known profile');
  });

  it('says so when the JSON is malformed', () => {
    const result = detectFeed('{ not json', 'x.json');
    expect(result.retailer).toBeNull();
    expect(result.reason).toContain('not valid JSON');
  });

  it('handles a Coop file whose first page carries no offers', () => {
    const payload = JSON.stringify({
      Pages: [
        { PageNumber: 1, Entries: [] },
        { PageNumber: 2, Entries: [{ Header: 'x', Motivid: '1', Priority: 2 }] },
      ],
    });
    expect(detectFeed(payload, 'x.json').retailer?.id).toBe('superbrugsen');
  });
});
