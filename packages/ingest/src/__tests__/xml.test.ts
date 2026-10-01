import { describe, expect, it } from 'vitest';
import { parseXml, sniffFormat } from '../index.js';

const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<products>
  <product><ProductSku>1</ProductSku><ProductName><![CDATA[Øl & vand]]></ProductName><Price>12,95</Price><Empty/></product>
  <product><ProductSku>2</ProductSku><ProductName>Mælk &amp; fløde</ProductName><Price>9.95</Price></product>
</products>`;

describe('parseXml', () => {
  it('reads flat records under their own tag names, entities and CDATA decoded', () => {
    expect(parseXml(FEED)).toEqual([
      { ProductSku: '1', ProductName: 'Øl & vand', Price: '12,95', Empty: '' },
      { ProductSku: '2', ProductName: 'Mælk & fløde', Price: '9.95' },
    ]);
  });

  it('refuses nested records rather than flattening them', () => {
    expect(() => parseXml('<items><item><a><b>1</b></a></item></items>')).toThrow(/nested XML in <a>/);
  });

  it('is told apart from JSON and CSV', () => {
    expect(sniffFormat(FEED)).toBe('xml');
    expect(sniffFormat('[{"a":1}]')).toBe('json');
    expect(sniffFormat('a;b\n1;2')).toBe('csv');
    expect(sniffFormat('', 'feed.xml')).toBe('xml');
  });
});
