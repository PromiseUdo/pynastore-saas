import { describe, expect, it } from 'vitest';
import { csvFilename, toCsv } from './csv';

describe('csv', () => {
  it('writes a header row and the values under it', () => {
    const csv = toCsv([{ name: 'Tee', qty: 3 }], [
      { header: 'Item', value: (r) => r.name },
      { header: 'Qty', value: (r) => r.qty },
    ]);
    expect(csv).toBe('Item,Qty\r\nTee,3');
  });

  it('quotes commas, quotes and newlines', () => {
    const csv = toCsv([{ name: 'Tee, "large"\nblue' }], [{ header: 'Item', value: (r) => r.name }]);
    expect(csv).toBe('Item\r\n"Tee, ""large""\nblue"');
  });

  it('defuses values a spreadsheet would run as a formula', () => {
    expect(toCsv([{ n: '=SUM(A1:A9)' }], [{ header: 'N', value: (r) => r.n }])).toBe("N\r\n'=SUM(A1:A9)");
  });

  it('leaves blanks for missing values and dates the filename', () => {
    expect(toCsv([{ n: null }], [{ header: 'N', value: (r) => r.n }])).toBe('N\r\n');
    expect(csvFilename('Stock levels', new Date('2026-09-16T10:00:00Z'))).toBe('stock-levels-2026-09-16.csv');
  });
});
