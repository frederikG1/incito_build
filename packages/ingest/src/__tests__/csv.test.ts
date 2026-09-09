import { describe, expect, it } from 'vitest';
import { parseCsv, sniffDelimiter } from '../csv.js';

describe('parseCsv', () => {
  it('sniffs semicolon-separated exports', () => {
    expect(sniffDelimiter('a;b;c\n1;2;3')).toBe(';');
  });

  it('keeps delimiters that appear inside quoted fields', () => {
    const rows = parseCsv('id;navn\n1;"Mælk, sødmælk"');
    expect(rows[0]).toEqual({ id: '1', navn: 'Mælk, sødmælk' });
  });

  it('keeps newlines inside quoted fields', () => {
    const rows = parseCsv('id;beskrivelse\n1;"linje 1\nlinje 2"');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.beskrivelse).toBe('linje 1\nlinje 2');
  });

  it('unescapes doubled quotes', () => {
    const rows = parseCsv('id;navn\n1;"12"" tallerken"');
    expect(rows[0]?.navn).toBe('12" tallerken');
  });

  it('strips a UTF-8 BOM from the first header', () => {
    const rows = parseCsv('﻿id;navn\n1;Mælk');
    expect(rows[0]?.id).toBe('1');
  });

  it('drops blank lines', () => {
    expect(parseCsv('id;navn\n1;Mælk\n\n2;Ost')).toHaveLength(2);
  });
});
