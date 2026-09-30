'use client';

/*
 * The import screen (ROADMAP 14.2): choose a file → see, per product, what
 * will be imported and what's wrong → import the ready ones. The file is
 * read in the browser and sent as text; the server checks everything again.
 */
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Loader2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import { StatCard, StatGrid } from '@/components/dashboard/stat-card';
import { Table, TableBody, TableCell, TableColumnHeader, TableHead, TableRow, TableWrapper } from '@/components/ui/table';
import { formatMoneyRange, formatNumber } from '@/lib/format';
import { csvFilename } from '@/lib/csv';
import { IMPORT_COLUMNS, IMPORT_MAX_BYTES, IMPORT_MAX_ROWS, STOCK_COLUMN_PREFIX, productImportTemplate } from '@/lib/inventory/product-import';
import { importProducts, previewProductImport, type ImportPreview, type ImportResult } from '@/features/inventory/product-import';

type Stage =
  | { kind: 'choose' }
  | { kind: 'checking'; fileName: string }
  | { kind: 'preview'; fileName: string; text: string; preview: ImportPreview }
  | { kind: 'importing'; fileName: string; count: number }
  | { kind: 'done'; result: ImportResult };

export function ImportClient({ storeNames, canRecordStock }: { storeNames: string[]; canRecordStock: boolean }) {
  const router = useRouter();
  const [stage, setStage] = React.useState<Stage>({ kind: 'choose' });
  const [error, setError] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  function downloadTemplate() {
    const blob = new Blob([productImportTemplate(storeNames)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = csvFilename('product-import-template');
    a.click();
    URL.revokeObjectURL(url);
  }

  async function onFile(file: File | undefined) {
    setError(null);
    if (!file) return;
    if (file.size > IMPORT_MAX_BYTES) {
      setError('That file is larger than 1 MB. Split it into smaller files.');
      return;
    }
    if (!/\.(csv|txt)$/i.test(file.name)) {
      setError('Choose a .csv file. In Excel or Google Sheets, use “Download / Save as → CSV”.');
      return;
    }
    setStage({ kind: 'checking', fileName: file.name });
    const text = await file.text();
    const result = await previewProductImport(text);
    if (!result.success) {
      setStage({ kind: 'choose' });
      setError(result.error);
      return;
    }
    setStage({ kind: 'preview', fileName: file.name, text, preview: result.data });
  }

  async function runImport(text: string, fileName: string, count: number) {
    setError(null);
    setStage({ kind: 'importing', fileName, count });
    const result = await importProducts(text);
    if (!result.success) {
      setError(result.error);
      const again = await previewProductImport(text);
      setStage(again.success ? { kind: 'preview', fileName, text, preview: again.data } : { kind: 'choose' });
      return;
    }
    toast.success(`${result.data.created} product${result.data.created === 1 ? '' : 's'} imported`);
    setStage({ kind: 'done', result: result.data });
    router.refresh();
  }

  function reset() {
    setStage({ kind: 'choose' });
    setError(null);
    if (inputRef.current) inputRef.current.value = '';
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {error && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {stage.kind === 'choose' && (
        <>
          <section className="rounded-lg border bg-card p-6 shadow-xs">
            <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-10 text-center">
              <FileSpreadsheet className="size-8 text-muted-foreground" aria-hidden />
              <div>
                <p className="text-sm font-medium text-foreground">Choose a CSV file</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Up to {IMPORT_MAX_ROWS} rows. You’ll see what will be imported before anything is saved.
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                <Button size="sm" onClick={() => inputRef.current?.click()}>
                  <Upload className="size-3.5" aria-hidden />
                  Choose file
                </Button>
                <Button variant="outline" size="sm" onClick={downloadTemplate}>
                  <Download className="size-3.5" aria-hidden />
                  Download the template
                </Button>
              </div>
              <input
                ref={inputRef}
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                aria-label="CSV file"
                onChange={(e) => onFile(e.target.files?.[0])}
              />
            </div>
          </section>
          <FormatGuide storeNames={storeNames} canRecordStock={canRecordStock} />
        </>
      )}

      {(stage.kind === 'checking' || stage.kind === 'importing') && (
        <div role="status" className="flex flex-col items-center gap-3 rounded-lg border bg-card px-6 py-14 text-center shadow-xs">
          <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden />
          <p className="text-sm text-foreground">
            {stage.kind === 'checking'
              ? `Checking ${stage.fileName}…`
              : `Importing ${formatNumber(stage.count)} product${stage.count === 1 ? '' : 's'} — this can take a minute. Keep this page open.`}
          </p>
        </div>
      )}

      {stage.kind === 'preview' && (
        <PreviewView
          preview={stage.preview}
          fileName={stage.fileName}
          onImport={() => runImport(stage.text, stage.fileName, stage.preview.summary.ready)}
          onReset={reset}
        />
      )}

      {stage.kind === 'done' && (
        <section className="space-y-4 rounded-lg border bg-card p-6 shadow-xs">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                {formatNumber(stage.result.created)} product{stage.result.created === 1 ? '' : 's'} imported
              </h2>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {stage.result.stockLines > 0 ? `Opening stock recorded on ${formatNumber(stage.result.stockLines)} line${stage.result.stockLines === 1 ? '' : 's'}. ` : ''}
                {stage.result.skipped > 0 ? `${formatNumber(stage.result.skipped)} skipped because of problems in the file. ` : ''}
                They’re drafts: add photos, then publish them to show them in your online shop.
              </p>
            </div>
          </div>
          {stage.result.failures.length > 0 && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-900/60 dark:bg-amber-950/40">
              <p className="font-medium text-amber-900 dark:text-amber-200">Some didn’t go through:</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-amber-900 dark:text-amber-200">
                {stage.result.failures.map((f, i) => (
                  <li key={i}>
                    {f.name} (row {f.rows.join(', ')}): {f.error}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Link href="/inventory/products?online=draft" className={buttonVariants({ size: 'sm' })}>
              See the imported products
            </Link>
            <Button variant="outline" size="sm" onClick={reset}>
              Import another file
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}

function PreviewView({
  preview,
  fileName,
  onImport,
  onReset,
}: {
  preview: ImportPreview;
  fileName: string;
  onImport: () => void;
  onReset: () => void;
}) {
  const { summary } = preview;
  const blocked = preview.fileErrors.length > 0;
  const [show, setShow] = React.useState<'all' | 'problems'>(summary.skipped > 0 ? 'problems' : 'all');
  const rows = show === 'all' ? preview.products : preview.products.filter((p) => !p.ready || p.warnings.length);

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        <span className="font-medium text-foreground">{fileName}</span> — {formatNumber(summary.rows)} row{summary.rows === 1 ? '' : 's'}. Nothing has
        been saved yet.
      </p>

      {preview.fileErrors.length > 0 && (
        <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <p className="font-medium text-foreground">Fix these in the file, then choose it again:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-foreground">
            {preview.fileErrors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}
      {preview.fileWarnings.map((w) => (
        <p key={w} className="flex items-start gap-2 text-xs text-muted-foreground">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {w}
        </p>
      ))}

      <StatGrid className="lg:grid-cols-4">
        <StatCard title="Ready to import" value={formatNumber(summary.ready)} description="products" />
        <StatCard title="Variants" value={formatNumber(summary.variants)} description="across those products" />
        <StatCard title="Opening stock" value={formatNumber(summary.stockLines)} description="store lines to record" />
        <StatCard title="Will be skipped" value={formatNumber(summary.skipped)} description="fix and import them again" />
      </StatGrid>

      {preview.products.length > 0 && (
        <div className="space-y-2">
          <div className="flex gap-1 text-sm" role="group" aria-label="Show">
            {(['problems', 'all'] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setShow(k)}
                aria-pressed={show === k}
                className={
                  show === k
                    ? 'rounded-md bg-muted px-2.5 py-1 font-medium text-foreground'
                    : 'rounded-md px-2.5 py-1 text-muted-foreground hover:text-foreground'
                }
              >
                {k === 'problems' ? 'With problems or notes' : 'All products'}
              </button>
            ))}
          </div>
          {rows.length === 0 ? (
            <p className="rounded-md border px-4 py-6 text-center text-sm text-muted-foreground">No problems — every product is ready.</p>
          ) : (
            <TableWrapper>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableColumnHeader>Rows</TableColumnHeader>
                    <TableColumnHeader>Product</TableColumnHeader>
                    <TableColumnHeader align="right">Variants</TableColumnHeader>
                    <TableColumnHeader align="right">Price</TableColumnHeader>
                    <TableColumnHeader align="right">Opening stock</TableColumnHeader>
                    <TableColumnHeader>Status</TableColumnHeader>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((p) => (
                    <TableRow key={p.rows.join('-')}>
                      <TableCell className="whitespace-nowrap text-muted-foreground tabular-nums">{p.rows.length > 1 ? `${p.rows[0]}–${p.rows[p.rows.length - 1]}` : p.rows[0]}</TableCell>
                      <TableCell>
                        <span className="font-medium text-foreground">{p.name || '—'}</span>
                        <span className="block text-xs text-muted-foreground">
                          {p.sku}
                          {p.category ? ` · ${p.category}` : ''}
                        </span>
                        {[...p.errors, ...p.warnings].length > 0 && (
                          <ul className="mt-1 space-y-0.5 text-xs">
                            {p.errors.map((e) => (
                              <li key={e} className="text-destructive">
                                {e}
                              </li>
                            ))}
                            {p.warnings.map((w) => (
                              <li key={w} className="text-amber-700 dark:text-amber-400">
                                {w}
                              </li>
                            ))}
                          </ul>
                        )}
                      </TableCell>
                      <TableCell align="right" className="tabular-nums">
                        {p.variantCount ? formatNumber(p.variantCount) : '—'}
                      </TableCell>
                      <TableCell align="right" className="tabular-nums">
                        {formatMoneyRange(p.priceMin, p.priceMax)}
                      </TableCell>
                      <TableCell align="right" className="tabular-nums">
                        {p.stockTotal ? formatNumber(p.stockTotal) : '—'}
                      </TableCell>
                      <TableCell>
                        <Badge variant={p.ready ? 'success' : 'destructive'}>{p.ready ? 'Ready' : 'Will be skipped'}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableWrapper>
          )}
        </div>
      )}

      <div className="sticky bottom-0 -mx-4 flex flex-col gap-2 border-t bg-background/95 px-4 py-3 backdrop-blur-sm sm:-mx-6 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p className="text-sm text-muted-foreground">
          {blocked
            ? 'Nothing can be imported until the file problems above are fixed.'
            : summary.ready === 0
              ? 'Nothing is ready to import yet.'
              : `Imports ${formatNumber(summary.ready)} product${summary.ready === 1 ? '' : 's'} as drafts${summary.skipped ? `; ${formatNumber(summary.skipped)} will be skipped` : ''}.`}
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onReset}>
            Choose another file
          </Button>
          <Button size="sm" disabled={blocked || summary.ready === 0} onClick={onImport}>
            Import {formatNumber(summary.ready)} product{summary.ready === 1 ? '' : 's'}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** How to lay the spreadsheet out — shown instead of example rows in the template. */
function FormatGuide({ storeNames, canRecordStock }: { storeNames: string[]; canRecordStock: boolean }) {
  return (
    <section aria-labelledby="format-title" className="rounded-lg border bg-card shadow-xs">
      <div className="border-b px-5 py-3.5">
        <h2 id="format-title" className="text-sm font-semibold text-foreground">
          How to fill in the spreadsheet
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          One row per thing you sell. The first row is the column headings — the template has them all. Only Name and SKU are
          required.
        </p>
      </div>
      <div className="space-y-5 px-5 py-4 text-sm">
        <div>
          <p className="font-medium text-foreground">Products with sizes, colours or other options</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Give each variant its own row, with the same Name (or the same Product SKU) and its option values. For example:
          </p>
          <TableWrapper className="mt-2">
            <Table dense>
              <TableHead>
                <TableRow>
                  <TableColumnHeader>Name</TableColumnHeader>
                  <TableColumnHeader>SKU</TableColumnHeader>
                  <TableColumnHeader>Option 1 name</TableColumnHeader>
                  <TableColumnHeader>Option 1 value</TableColumnHeader>
                  <TableColumnHeader align="right">Price</TableColumnHeader>
                  {canRecordStock && <TableColumnHeader align="right">{STOCK_COLUMN_PREFIX} {storeNames[0] ?? 'Main shop'}</TableColumnHeader>}
                </TableRow>
              </TableHead>
              <TableBody>
                {[
                  ['Linen shirt', 'LSHIRT-M', 'Size', 'M', '12000', '4'],
                  ['Linen shirt', 'LSHIRT-L', 'Size', 'L', '12000', '6'],
                ].map((r) => (
                  <TableRow key={r[1]}>
                    <TableCell>{r[0]}</TableCell>
                    <TableCell className="font-mono text-xs">{r[1]}</TableCell>
                    <TableCell>{r[2]}</TableCell>
                    <TableCell>{r[3]}</TableCell>
                    <TableCell align="right" className="tabular-nums">
                      {r[4]}
                    </TableCell>
                    {canRecordStock && (
                      <TableCell align="right" className="tabular-nums">
                        {r[5]}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableWrapper>
        </div>
        {canRecordStock && (
          <div>
            <p className="font-medium text-foreground">Opening stock</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              A column headed “{STOCK_COLUMN_PREFIX} <em>store name</em>” for each store, spelled as in Stores
              {storeNames.length ? ` (${storeNames.join(', ')})` : ''}. Each amount is recorded as stock received, so it shows in
              your stock history. Add a Cost price to value it.
            </p>
          </div>
        )}
        <div>
          <p className="font-medium text-foreground">Every column</p>
          <dl className="mt-2 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
            {IMPORT_COLUMNS.map((c) => (
              <div key={c.field} className="text-xs">
                <dt className="inline font-medium text-foreground">
                  {c.header}
                  {c.required ? ' (required)' : ''}
                </dt>{' '}
                <dd className="inline text-muted-foreground">— {c.help}</dd>
              </div>
            ))}
          </dl>
        </div>
        <p className="text-xs text-muted-foreground">
          Imported products are saved as drafts, because photos can’t go in a spreadsheet. Add photos, then publish them.
          Categories and brands must already exist; anything that doesn’t match is left blank and noted. Products whose SKU you
          already use are skipped — updating products by import isn’t available yet.
        </p>
      </div>
    </section>
  );
}
