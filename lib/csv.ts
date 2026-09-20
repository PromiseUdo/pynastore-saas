// lib/csv.ts
// Turning report rows into a spreadsheet the merchant can open. Pure, so it
// is testable and runs on either side.

export type CsvColumn<T> = { header: string; value: (row: T) => string | number | null | undefined };

/** RFC-4180 quoting: wrap when the value could otherwise break the row. */
function cell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  // A leading =, +, - or @ is treated as a formula by spreadsheet apps; prefix
  // it so a product name can never execute in someone's Excel.
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const lines = [columns.map((c) => cell(c.header)).join(',')];
  for (const row of rows) lines.push(columns.map((c) => cell(c.value(row))).join(','));
  return lines.join('\r\n');
}

/** "Stock levels" + today → "stock-levels-2026-09-16.csv" */
export function csvFilename(name: string, date = new Date()): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${slug || 'report'}-${date.toISOString().slice(0, 10)}.csv`;
}
