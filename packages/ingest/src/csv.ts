/**
 * Minimal RFC 4180 CSV reader. Retailer exports routinely contain commas
 * and newlines inside quoted product descriptions, so a split(',') reader
 * corrupts real data — the quote state machine is the whole point.
 * Delimiter is sniffed because Danish exports are frequently semicolon-
 * separated (Excel's locale default).
 */
export function sniffDelimiter(text: string): string {
  const firstLine = text.slice(0, text.indexOf('\n') === -1 ? text.length : text.indexOf('\n'));
  const counts = [',', ';', '\t', '|'].map((d) => ({
    d,
    n: firstLine.split(d).length - 1,
  }));
  counts.sort((a, b) => b.n - a.n);
  return counts[0] && counts[0].n > 0 ? counts[0].d : ',';
}

export function parseCsv(text: string, delimiter?: string): Record<string, string>[] {
  const source = text.replace(/^﻿/, '');
  const delim = delimiter ?? sniffDelimiter(source);

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];

    if (inQuotes) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === delim) {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const header = rows.shift();
  if (!header) return [];

  return rows
    .filter((r) => r.some((cell) => cell.trim() !== ''))
    .map((r) => {
      const record: Record<string, string> = {};
      header.forEach((key, idx) => {
        record[key.trim()] = (r[idx] ?? '').trim();
      });
      return record;
    });
}
