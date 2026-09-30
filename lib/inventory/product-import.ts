/*
 * lib/inventory/product-import.ts
 *
 * Reading a product spreadsheet (ROADMAP 14.2): parse the CSV, map its
 * columns, group rows into products and their variants, and say what's wrong
 * with each row. Pure and client-safe; features/inventory/product-import.ts
 * adds what only the database knows (SKUs already in use, categories, brands,
 * stores) and does the importing.
 *
 * THE FORMAT — one row per thing you sell:
 *   - a product without options is one row;
 *   - a product with options (Size, Colour…) is one row per variant, sharing
 *     the same Name — or the same "Product SKU" when two products share a
 *     name. Product-wide columns (Description, Category…) are read from the
 *     first row that fills them in;
 *   - "Stock: <store name>" columns give the opening stock at each store,
 *     recorded as stock received, through the ledger.
 * Imported products are drafts: they need photos before they can be
 * published, and the spreadsheet can't carry those.
 */
import { guessOptionKind, optionsProblem, MAX_OPTIONS, MAX_VARIANTS, type VariantOption } from '@/features/inventory/product-rules';

export const IMPORT_MAX_ROWS = 500;
export const IMPORT_MAX_BYTES = 1_000_000;

/* ─── CSV ───────────────────────────────────────────────────────────────── */

/** Guesses the separator from the header line: comma, semicolon (Excel in some locales) or tab. */
function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const counts = [',', ';', '\t'].map((d) => ({ d, n: firstLine.split(d).length - 1 }));
  counts.sort((a, b) => b.n - a.n);
  return counts[0].n > 0 ? counts[0].d : ',';
}

/** RFC 4180-ish: quoted fields, doubled quotes, newlines inside quotes, CRLF, a leading BOM. */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, '');
  const delimiter = detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"' && field === '') quoted = true;
    else if (c === delimiter) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  // Drop blank lines (a trailing newline, or rows of empty cells).
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

/* ─── Columns ───────────────────────────────────────────────────────────── */

export type ImportField =
  | 'name'
  | 'sku'
  | 'productSku'
  | 'price'
  | 'compareAtPrice'
  | 'costPrice'
  | 'barcode'
  | 'unit'
  | 'description'
  | 'category'
  | 'brand'
  | 'reorderPoint'
  | `option${1 | 2 | 3}Name`
  | `option${1 | 2 | 3}Value`;

/** Every column the importer knows, with what the guide says about it. */
export const IMPORT_COLUMNS: { field: ImportField; header: string; required?: boolean; help: string; aliases?: string[] }[] = [
  { field: 'name', header: 'Name', required: true, help: 'The product’s name. Variants of one product share it.', aliases: ['product name', 'title'] },
  { field: 'sku', header: 'SKU', required: true, help: 'Your code for this item — or for this variant. Must be new to your workspace.', aliases: ['variant sku', 'code'] },
  { field: 'productSku', header: 'Product SKU', help: 'Optional. A code for the product as a whole, when it has variants. Also groups variants when two products share a name.', aliases: ['parent sku'] },
  { field: 'option1Name', header: 'Option 1 name', help: 'e.g. Size', aliases: ['option1 name'] },
  { field: 'option1Value', header: 'Option 1 value', help: 'e.g. M', aliases: ['option1 value'] },
  { field: 'option2Name', header: 'Option 2 name', help: 'e.g. Colour', aliases: ['option2 name'] },
  { field: 'option2Value', header: 'Option 2 value', help: 'e.g. Red', aliases: ['option2 value'] },
  { field: 'option3Name', header: 'Option 3 name', help: 'Optional third option', aliases: ['option3 name'] },
  { field: 'option3Value', header: 'Option 3 value', help: 'Optional third option value', aliases: ['option3 value'] },
  { field: 'price', header: 'Price', help: 'Selling price in naira, e.g. 15000.', aliases: ['selling price', 'price (ngn)'] },
  { field: 'compareAtPrice', header: 'Compare-at price', help: 'Optional “was” price, higher than Price.', aliases: ['compare at price', 'was price', 'old price'] },
  { field: 'costPrice', header: 'Cost price', help: 'Optional. What you paid per item — used for the opening stock’s value and your profit reports.', aliases: ['cost', 'unit cost'] },
  { field: 'barcode', header: 'Barcode', help: 'Optional.', aliases: ['ean', 'upc'] },
  { field: 'unit', header: 'Unit', help: 'Optional. How it’s counted, e.g. pcs, kg, pack. Defaults to pcs.' },
  { field: 'description', header: 'Description', help: 'Optional.' },
  { field: 'category', header: 'Category', help: 'Optional. A category you already have, e.g. Women or Women > Dresses.' },
  { field: 'brand', header: 'Brand', help: 'Optional. A brand you already have.' },
  { field: 'reorderPoint', header: 'Reorder point', help: 'Optional. When stock falls to this number, you’re alerted.', aliases: ['reorder level'] },
];

export const STOCK_COLUMN_PREFIX = 'Stock:';

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[‐-―]/g, '-');

export interface ColumnMap {
  fields: Partial<Record<ImportField, number>>;
  /** "Stock: Main shop" → { store: 'Main shop', index } */
  stock: { store: string; index: number }[];
  unknown: string[];
  duplicate: string[];
}

export function mapColumns(header: string[]): ColumnMap {
  const map: ColumnMap = { fields: {}, stock: [], unknown: [], duplicate: [] };
  const lookup = new Map<string, ImportField>();
  for (const c of IMPORT_COLUMNS) {
    lookup.set(norm(c.header), c.field);
    for (const a of c.aliases ?? []) lookup.set(norm(a), c.field);
  }
  header.forEach((raw, index) => {
    const h = norm(raw);
    if (!h) return;
    const stock = raw.trim().match(/^stock\s*[:\-–]\s*(.+)$/i);
    if (stock) {
      map.stock.push({ store: stock[1].trim(), index });
      return;
    }
    const field = lookup.get(h);
    if (!field) map.unknown.push(raw.trim());
    else if (map.fields[field] !== undefined) map.duplicate.push(raw.trim());
    else map.fields[field] = index;
  });
  return map;
}

/* ─── Rows → products ───────────────────────────────────────────────────── */

export interface ImportUnit {
  /** 1-based, counting the header as row 1 — as a spreadsheet shows it */
  row: number;
  sku: string;
  attributes: Record<string, string>;
  price: number | null;
  compareAtPrice: number | null;
  costPrice: number | null;
  barcode: string | null;
  /** store name as written → quantity */
  stock: { store: string; quantity: number }[];
}

export interface ImportProduct {
  key: string;
  rows: number[];
  name: string;
  /** the product's own SKU: "Product SKU", or the only row's SKU; null = to be generated */
  sku: string | null;
  description: string | null;
  unit: string;
  category: string | null;
  brand: string | null;
  reorderPoint: number | null;
  options: VariantOption[];
  units: ImportUnit[];
  errors: string[];
  warnings: string[];
}

export interface ParsedImport {
  products: ImportProduct[];
  /** problems with the file as a whole — nothing is imported until they're fixed */
  fileErrors: string[];
  fileWarnings: string[];
  stockStores: string[];
  rowCount: number;
}

/** "15,000", "₦15,000.50", " 15000 " → 15000.5; blank → null; junk → NaN. */
export function parseAmount(raw: string | undefined): number | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  const cleaned = s.replace(/[₦,\s]/g, '').replace(/^ngn/i, '');
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return NaN;
  return Number(cleaned);
}

export function parseProductImport(text: string): ParsedImport {
  const result: ParsedImport = { products: [], fileErrors: [], fileWarnings: [], stockStores: [], rowCount: 0 };
  if (text.length > IMPORT_MAX_BYTES) {
    result.fileErrors.push('The file is larger than 1 MB. Split it into smaller files.');
    return result;
  }
  const rows = parseCsv(text);
  if (rows.length === 0) {
    result.fileErrors.push('The file is empty.');
    return result;
  }
  const [header, ...body] = rows;
  result.rowCount = body.length;
  const cols = mapColumns(header);

  if (cols.fields.name === undefined || cols.fields.sku === undefined) {
    result.fileErrors.push('The first row must be the column headings, including “Name” and “SKU”. Download the template to see the layout.');
    return result;
  }
  if (body.length === 0) result.fileErrors.push('There are headings but no products under them.');
  if (body.length > IMPORT_MAX_ROWS) {
    result.fileErrors.push(`The file has ${body.length} rows; import up to ${IMPORT_MAX_ROWS} at a time by splitting it into smaller files.`);
    return result;
  }
  if (cols.duplicate.length) result.fileErrors.push(`These columns appear twice: ${cols.duplicate.join(', ')}.`);
  if (cols.unknown.length) result.fileWarnings.push(`These columns aren’t recognised and were ignored: ${cols.unknown.join(', ')}.`);
  const storeNames = new Map<string, string>();
  for (const s of cols.stock) {
    if (storeNames.has(norm(s.store))) result.fileErrors.push(`The stock column for “${s.store}” appears twice.`);
    storeNames.set(norm(s.store), s.store);
  }
  result.stockStores = [...storeNames.values()];

  const cell = (r: string[], f: ImportField) => {
    const i = cols.fields[f];
    return i === undefined ? '' : (r[i] ?? '').trim();
  };

  const groups = new Map<string, ImportProduct>();
  const skuRows = new Map<string, number>();

  body.forEach((r, i) => {
    const rowNo = i + 2;
    const name = cell(r, 'name');
    const productSku = cell(r, 'productSku');
    const key = productSku ? `sku:${productSku.toLowerCase()}` : `name:${norm(name)}`;
    let product = groups.get(key);
    if (!product) {
      product = {
        key,
        rows: [],
        name,
        sku: productSku || null,
        description: null,
        unit: 'pcs',
        category: null,
        brand: null,
        reorderPoint: null,
        options: [],
        units: [],
        errors: [],
        warnings: [],
      };
      groups.set(key, product);
    }
    product.rows.push(rowNo);
    const rowError = (message: string) => product!.errors.push(`Row ${rowNo}: ${message}`);

    if (!name) rowError('Name is empty.');
    else if (name.length > 150) rowError('Name is longer than 150 characters.');
    if (!product.name && name) product.name = name;

    const sku = cell(r, 'sku');
    if (!sku) rowError('SKU is empty.');
    else if (sku.length > 60) rowError('SKU is longer than 60 characters.');
    else if (skuRows.has(sku.toLowerCase())) rowError(`SKU “${sku}” is also on row ${skuRows.get(sku.toLowerCase())}.`);
    else skuRows.set(sku.toLowerCase(), rowNo);

    // Product-wide fields: the first row that fills each in.
    product.description ??= cell(r, 'description') || null;
    product.category ??= cell(r, 'category') || null;
    product.brand ??= cell(r, 'brand') || null;
    const unit = cell(r, 'unit');
    if (unit && product.rows.length === 1) product.unit = unit.slice(0, 20);
    const reorder = parseAmount(cell(r, 'reorderPoint'));
    if (reorder !== null) {
      if (Number.isNaN(reorder) || reorder < 0) rowError('Reorder point must be a number of 0 or more.');
      else product.reorderPoint ??= reorder;
    }
    if (product.description && product.description.length > 5000) rowError('Description is longer than 5,000 characters.');

    const money = (f: ImportField, label: string) => {
      const v = parseAmount(cell(r, f));
      if (v !== null && (Number.isNaN(v) || v < 0)) {
        rowError(`${label} “${cell(r, f)}” isn’t an amount.`);
        return null;
      }
      return v;
    };
    const price = money('price', 'Price');
    const compareAtPrice = money('compareAtPrice', 'Compare-at price');
    const costPrice = money('costPrice', 'Cost price');
    if (price !== null && compareAtPrice !== null && compareAtPrice <= price) {
      rowError('Compare-at price must be higher than Price.');
    }

    const attributes: Record<string, string> = {};
    for (const n of [1, 2, 3] as const) {
      const optName = cell(r, `option${n}Name`);
      const optValue = cell(r, `option${n}Value`);
      if (!optName && !optValue) continue;
      if (!optName || !optValue) {
        rowError(`Option ${n} needs both a name and a value.`);
        continue;
      }
      attributes[optName] = optValue;
    }

    const stock: ImportUnit['stock'] = [];
    for (const s of cols.stock) {
      const raw = (r[s.index] ?? '').trim();
      const q = parseAmount(raw);
      if (q === null || q === 0) continue;
      if (Number.isNaN(q) || q < 0) rowError(`Stock at ${s.store} “${raw}” must be a number of 0 or more.`);
      else stock.push({ store: s.store, quantity: q });
    }

    product.units.push({
      row: rowNo,
      sku,
      attributes,
      price,
      compareAtPrice,
      costPrice,
      barcode: cell(r, 'barcode').slice(0, 60) || null,
      stock,
    });
  });

  for (const product of groups.values()) {
    const withOptions = product.units.filter((u) => Object.keys(u.attributes).length > 0);
    if (withOptions.length === 0) {
      if (product.units.length > 1) {
        product.errors.push(
          `Rows ${product.rows.join(', ')} share the name “${product.name}” but have no options. Give each its own name, or add Option columns to make them variants.`,
        );
      } else {
        product.sku ??= product.units[0].sku || null;
      }
    } else {
      if (withOptions.length !== product.units.length) {
        product.errors.push(`Some rows of “${product.name}” have options and some don’t. Every variant needs its options.`);
      }
      // One option list for the product, in the order values first appear.
      const names = Object.keys(withOptions[0].attributes);
      const sameNames = withOptions.every(
        (u) => Object.keys(u.attributes).length === names.length && names.every((n) => n in u.attributes),
      );
      if (!sameNames) {
        product.errors.push(`The variants of “${product.name}” don’t all use the same option names (${names.join(', ')}).`);
      } else if (names.length > MAX_OPTIONS) {
        product.errors.push(`Use at most ${MAX_OPTIONS} options.`);
      } else {
        product.options = names.map((name) => ({
          name,
          kind: guessOptionKind(name),
          values: [...new Set(withOptions.map((u) => u.attributes[name]))].map((label) => ({ label })),
        }));
        const problem = optionsProblem(product.options);
        if (problem) product.errors.push(problem);
        const combos = new Map<string, number>();
        for (const u of withOptions) {
          const combo = names.map((n) => u.attributes[n].toLowerCase()).join(' / ');
          if (combos.has(combo)) product.errors.push(`Rows ${combos.get(combo)} and ${u.row} are the same variant (${combo}).`);
          else combos.set(combo, u.row);
        }
      }
      if (product.units.length > MAX_VARIANTS) product.errors.push(`A product can have at most ${MAX_VARIANTS} variants.`);
    }
    if (product.units.every((u) => u.price === null)) {
      product.warnings.push('No price — it can’t be sold until you add one.');
    }
    result.products.push(product);
  }
  return result;
}

/* ─── Template ──────────────────────────────────────────────────────────── */

const csvCell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/**
 * A spreadsheet to fill in: every column heading, with a stock column for
 * each of the merchant's stores. No example rows — an example imported by
 * mistake would become a product nobody sells. The import page shows the
 * pattern instead.
 */
export function productImportTemplate(storeNames: string[]): string {
  const header = [...IMPORT_COLUMNS.map((c) => c.header), ...storeNames.map((s) => `${STOCK_COLUMN_PREFIX} ${s}`)];
  return header.map(csvCell).join(',') + '\r\n';
}
