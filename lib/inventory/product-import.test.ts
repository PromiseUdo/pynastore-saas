/* Reading a product spreadsheet (ROADMAP 14.2) — pure. */
import { describe, expect, it } from 'vitest';
import { IMPORT_MAX_ROWS, mapColumns, parseAmount, parseCsv, parseProductImport, productImportTemplate } from './product-import';

const csv = (...lines: string[]) => lines.join('\r\n') + '\r\n';

describe('parseCsv', () => {
  it('reads quotes, doubled quotes, newlines in quotes, CRLF and a BOM', () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n"two\nlines",z\n')).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"'],
      ['two\nlines', 'z'],
    ]);
  });

  it('reads semicolon files (Excel in some locales) and skips blank lines', () => {
    expect(parseCsv('Name;SKU\n\nTee;T1\n;\n')).toEqual([
      ['Name', 'SKU'],
      ['Tee', 'T1'],
    ]);
  });
});

describe('columns', () => {
  it('maps headings and aliases in any case, stock columns per store, and flags the rest', () => {
    const m = mapColumns(['product name', 'SKU', 'Selling Price', 'Stock: Main shop', 'stock - Ikeja', 'Colourway', 'Price']);
    expect(m.fields).toMatchObject({ name: 0, sku: 1, price: 2 });
    expect(m.stock).toEqual([
      { store: 'Main shop', index: 3 },
      { store: 'Ikeja', index: 4 },
    ]);
    expect(m.unknown).toEqual(['Colourway']);
    expect(m.duplicate).toEqual(['Price']);
  });

  it('reads amounts as people write them', () => {
    expect(parseAmount('₦15,000.50')).toBe(15000.5);
    expect(parseAmount(' 200 ')).toBe(200);
    expect(parseAmount('')).toBeNull();
    expect(Number.isNaN(parseAmount('ten')!)).toBe(true);
  });
});

describe('parseProductImport', () => {
  it('makes one product of a plain row, and one product with variants of rows sharing a name', () => {
    const r = parseProductImport(
      csv(
        'Name,SKU,Option 1 name,Option 1 value,Price,Stock: Main shop',
        'Mug,MUG-1,,,2500,10',
        'Linen shirt,LS-M,Size,M,12000,4',
        'Linen shirt,LS-L,Size,L,12500,',
      ),
    );
    expect(r.fileErrors).toEqual([]);
    expect(r.products).toHaveLength(2);
    const [mug, shirt] = r.products;
    expect(mug).toMatchObject({ name: 'Mug', sku: 'MUG-1', options: [], errors: [] });
    expect(mug.units[0].stock).toEqual([{ store: 'Main shop', quantity: 10 }]);
    expect(shirt).toMatchObject({ name: 'Linen shirt', sku: null, rows: [3, 4], errors: [] });
    expect(shirt.options).toEqual([{ name: 'Size', kind: 'size', values: [{ label: 'M' }, { label: 'L' }] }]);
    expect(shirt.units.map((u) => [u.sku, u.price, u.stock.length])).toEqual([
      ['LS-M', 12000, 1],
      ['LS-L', 12500, 0],
    ]);
  });

  it('groups by Product SKU when two products share a name', () => {
    const r = parseProductImport(
      csv('Name,SKU,Product SKU,Option 1 name,Option 1 value', 'Tee,A-S,A,Size,S', 'Tee,B-S,B,Size,S'),
    );
    expect(r.products.map((p) => [p.sku, p.errors])).toEqual([
      ['A', []],
      ['B', []],
    ]);
  });

  it('says what is wrong, row by row', () => {
    const r = parseProductImport(
      csv(
        'Name,SKU,Option 1 name,Option 1 value,Price,Compare-at price,Stock: Main shop',
        ',X1,,,100,,',
        'Cap,,,,abc,,',
        'Bag,B1,,,5000,4000,-2',
        'Bag,B1,,,5000,,',
        'Hat,H1,,,1000,,',
        'Hat,H2,,,1000,,',
        'Shoe,S-40,Size,40,,,',
        'Shoe,S-40b,Size,40,,,',
        'Sock,K1,Size,,1,,',
      ),
    );
    const errs = r.products.flatMap((p) => p.errors).join('\n');
    expect(errs).toContain('Row 2: Name is empty.');
    expect(errs).toContain('Row 3: SKU is empty.');
    expect(errs).toContain('Row 3: Price “abc” isn’t an amount.');
    expect(errs).toContain('Row 4: Compare-at price must be higher than Price.');
    expect(errs).toContain('Row 4: Stock at Main shop “-2” must be a number of 0 or more.');
    expect(errs).toContain('Row 5: SKU “B1” is also on row 4.');
    expect(errs).toContain('share the name “Hat” but have no options');
    expect(errs).toContain('Rows 8 and 9 are the same variant');
    expect(errs).toContain('Row 10: Option 1 needs both a name and a value.');
    expect(r.products.find((p) => p.name === 'Shoe')!.warnings).toContain('No price — it can’t be sold until you add one.');
  });

  it('refuses a file without the headings, or with too many rows', () => {
    expect(parseProductImport('Tee,T1\n').fileErrors[0]).toMatch(/column headings/);
    const big = ['Name,SKU', ...Array.from({ length: IMPORT_MAX_ROWS + 1 }, (_, i) => `P${i},S${i}`)].join('\n');
    expect(parseProductImport(big).fileErrors[0]).toMatch(/import up to/);
    expect(parseProductImport('').fileErrors).toEqual(['The file is empty.']);
  });

  it('warns about unknown columns and ignores them', () => {
    expect(parseProductImport(csv('Name,SKU,Colourway', 'Tee,T1,Red')).fileWarnings[0]).toMatch(/Colourway/);
  });
});

describe('the template', () => {
  it('has every heading, a stock column per store, and no example rows', () => {
    const t = productImportTemplate(['Main shop', 'Ikeja']);
    const rows = parseCsv(t);
    expect(rows).toHaveLength(1);
    expect(rows[0].slice(0, 2)).toEqual(['Name', 'SKU']);
    expect(rows[0].slice(-2)).toEqual(['Stock: Main shop', 'Stock: Ikeja']);
    expect(parseProductImport(t).fileErrors).toEqual(['There are headings but no products under them.']);
  });
});
