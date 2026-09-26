'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Boxes, MoreHorizontal, Plus, Search, Settings2, Trash2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { PageToolbar } from '@/components/layout/page-header';
import { EmptyState } from '@/components/layout/empty-state';
import { SelectRoot, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Table, TableWrapper, TableHead, TableBody, TableRow, TableColumnHeader, TableCell } from '@/components/ui/table';
import { TablePagination } from '@/components/ui/table-pagination';
import {
  DropdownMenuRoot,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { ExportCsvButton } from '@/components/dashboard/export-csv-button';
import { formatMoney, formatNumber } from '@/lib/format';
import type { StoreInventoryParams, StoreInventoryResult, StoreInventoryRow } from '@/features/inventory/actions';
import { AddProductsSheet } from './AddProductsSheet';
import { StoreStockSettingsDialog } from './StoreStockSettingsDialog';
import { RemoveFromStoreDialog } from './RemoveFromStoreDialog';

const STATE_LABEL: Record<StoreInventoryRow['stockState'], string> = {
  in: 'In stock',
  low: 'Low',
  out: 'Out of stock',
};

const STATE_VARIANT: Record<StoreInventoryRow['stockState'], 'success' | 'warning' | 'destructive'> = {
  in: 'success',
  low: 'warning',
  out: 'destructive',
};

const SORT_LABEL: Record<NonNullable<StoreInventoryParams['sort']>, string> = {
  name: 'Name (A–Z)',
  'stock-asc': 'Least available first',
  'stock-desc': 'Most available first',
  'value-desc': 'Highest value first',
};

/** Where the reorder point in force came from, said in the merchant's words. */
function thresholdHint(row: StoreInventoryRow): string {
  if (row.reorderPoint === null) return 'No reorder point set, so nothing warns you when this runs low here.';
  return row.reorderPointSource === 'store'
    ? `This store's own reorder point: ${formatNumber(row.reorderPoint)}.`
    : `From the product, used by every store: ${formatNumber(row.reorderPoint)}.`;
}

/**
 * This store's stock, one row per stocked unit — a variant where a product has
 * options, because that is what a quantity belongs to. Search, filter, sort and
 * page all live in the URL (AGENTS §3).
 */
export function StoreInventoryTable({
  storeName,
  storeIsOpen,
  result,
  params,
  can,
}: {
  storeName: string;
  /** A closed store takes no new products, so the button says why. */
  storeIsOpen: boolean;
  result: StoreInventoryResult;
  params: StoreInventoryParams;
  can: { edit: boolean; recordStock: boolean };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isNavigating, startTransition] = React.useTransition();
  const [query, setQuery] = React.useState(params.q ?? '');
  const [addOpen, setAddOpen] = React.useState(false);
  const [settingsRow, setSettingsRow] = React.useState<StoreInventoryRow | null>(null);
  const [removeRow, setRemoveRow] = React.useState<StoreInventoryRow | null>(null);

  const update = React.useCallback(
    (patch: Record<string, string | undefined>, { keepPage = false } = {}) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      if (!keepPage) next.delete('page');
      const qs = next.toString();
      startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
    },
    [pathname, router, searchParams],
  );

  React.useEffect(() => {
    if (query === (params.q ?? '')) return;
    const timer = setTimeout(() => update({ q: query.trim() || undefined }), 300);
    return () => clearTimeout(timer);
  }, [query, params.q, update]);

  const hasFilters = Boolean(params.q || params.stock);

  function clearFilters() {
    setQuery('');
    update({ q: undefined, stock: undefined });
  }

  if (result.stockedCount === 0) {
    return (
      <>
        <div className="px-6 py-6">
          <EmptyState
            icon={Boxes}
            title={`Nothing is stocked at ${storeName} yet`}
            description="Stock is counted per store. Choose which products this store carries — with an opening quantity if there is already stock on the shelf — or move stock across from another store."
            action={
              <div className="flex flex-wrap items-center justify-center gap-2">
                {can.edit && (
                  <Button size="sm" onClick={() => setAddOpen(true)} disabled={!storeIsOpen}>
                    <Plus className="size-3.5" />
                    Add products
                  </Button>
                )}
                <Link href="/inventory/transfers" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                  Move stock here
                </Link>
              </div>
            }
          />
        </div>

      <AddProductsSheet
        open={addOpen}
        onOpenChange={setAddOpen}
        warehouseId={params.warehouseId}
        storeName={storeName}
        canRecordStock={can.recordStock}
      />
      <StoreStockSettingsDialog
        open={settingsRow !== null}
        onOpenChange={(open) => !open && setSettingsRow(null)}
        warehouseId={params.warehouseId}
        storeName={storeName}
        row={settingsRow}
      />
      <RemoveFromStoreDialog
        open={removeRow !== null}
        onOpenChange={(open) => !open && setRemoveRow(null)}
        warehouseId={params.warehouseId}
        storeName={storeName}
        row={removeRow}
      />
      </>
    );
  }

  return (
    <>
      <PageToolbar>
        <div className="w-full sm:w-64">
          <Input
            aria-label="Search this store's stock"
            placeholder="Search product, SKU or shelf…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            startAdornment={<Search className="size-3.5" />}
            endAdornment={
              query ? (
                <button type="button" aria-label="Clear search" onClick={() => setQuery('')}>
                  <X className="size-3.5" />
                </button>
              ) : undefined
            }
          />
        </div>
        <div className="w-[calc(50%-4px)] sm:w-40">
          <SelectRoot value={params.stock ?? 'all'} onValueChange={(v) => update({ stock: v === 'all' ? undefined : v })}>
            <SelectTrigger aria-label="Stock level">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any stock level</SelectItem>
              <SelectItem value="in">In stock</SelectItem>
              <SelectItem value="low">Low stock</SelectItem>
              <SelectItem value="out">Out of stock</SelectItem>
            </SelectContent>
          </SelectRoot>
        </div>
        <div className="w-[calc(50%-4px)] sm:w-48">
          <SelectRoot value={params.sort ?? 'name'} onValueChange={(v) => update({ sort: v === 'name' ? undefined : v })}>
            <SelectTrigger aria-label="Sort">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(SORT_LABEL) as NonNullable<StoreInventoryParams['sort']>[]).map((key) => (
                <SelectItem key={key} value={key}>
                  {SORT_LABEL[key]}
                </SelectItem>
              ))}
            </SelectContent>
          </SelectRoot>
        </div>
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            Clear filters
          </Button>
        )}
        <div className="ml-auto flex items-center gap-2">
          {can.edit && (
            <Button size="sm" onClick={() => setAddOpen(true)} disabled={!storeIsOpen} title={storeIsOpen ? undefined : `${storeName} is closed`}>
              <Plus className="size-3.5" />
              Add products
            </Button>
          )}
          <ExportCsvButton
            name={`${storeName} stock`}
            rows={result.rows}
            columns={[
              { header: 'Product', value: (r) => r.name },
              { header: 'Option', value: (r) => r.variantName },
              { header: 'SKU', value: (r) => r.sku },
              { header: 'Shelf', value: (r) => r.location },
              { header: 'On hand', value: (r) => r.onHand },
              { header: 'Held for orders', value: (r) => r.held },
              { header: 'Available', value: (r) => r.available },
              { header: 'Reorder point', value: (r) => r.reorderPoint },
              { header: 'Reorder point set by', value: (r) => (r.reorderPointSource === 'store' ? 'This store' : r.reorderPointSource === 'product' ? 'Product' : null) },
              { header: 'Stock level', value: (r) => STATE_LABEL[r.stockState] },
              { header: 'Unit cost', value: (r) => r.unitCost },
              { header: 'Value', value: (r) => r.value },
            ]}
          />
        </div>
      </PageToolbar>

      <div className={cn('px-6 py-6 transition-opacity', isNavigating && 'opacity-60')}>
        {/* What the filter means, in the merchant's words: the threshold that
            decides "low" here is this store's own where it has one. */}
        {params.stock && (
          <p className="mb-4 text-xs text-muted-foreground">
            {params.stock === 'low'
              ? `Showing what is at or below the reorder point in force at ${storeName} — this store's own where it has one, otherwise the product's. A product with no reorder point anywhere never appears here.`
              : params.stock === 'out'
                ? `Showing what has nothing available at ${storeName}. Stock that is on the shelf but held for a customer's order counts as unavailable, because it can't be sold again.`
                : `Showing what is above the reorder point in force at ${storeName}.`}
          </p>
        )}
        {result.rows.length === 0 ? (
          <EmptyState
            variant="filtered"
            title="Nothing here matches those filters"
            action={
              <Button variant="outline" size="sm" onClick={clearFilters}>
                Clear filters
              </Button>
            }
          />
        ) : (
          <TableWrapper>
            <Table>
              <TableHead>
                <TableRow>
                  <TableColumnHeader>Product</TableColumnHeader>
                  <TableColumnHeader className="hidden md:table-cell">Shelf</TableColumnHeader>
                  <TableColumnHeader align="right">On hand</TableColumnHeader>
                  <TableColumnHeader align="right" className="hidden sm:table-cell">
                    Held
                  </TableColumnHeader>
                  <TableColumnHeader align="right">Available</TableColumnHeader>
                  <TableColumnHeader align="right" className="hidden lg:table-cell">
                    Reorder point
                  </TableColumnHeader>
                  <TableColumnHeader>Stock level</TableColumnHeader>
                  <TableColumnHeader align="right" className="hidden lg:table-cell">
                    Value here
                  </TableColumnHeader>
                  {can.edit && <TableColumnHeader className="w-10 sr-only">Actions</TableColumnHeader>}
                </TableRow>
              </TableHead>
              <TableBody>
                {result.rows.map((row) => (
                  <TableRow key={`${row.itemId}`}>
                    <TableCell className="py-2">
                      <Link href={`/inventory/products/${row.productId}`} className="font-medium text-foreground hover:underline">
                        {row.name}
                      </Link>
                      <p className="font-mono text-xs text-muted-foreground">
                        {row.sku}
                        {row.variantName && <span className="font-sans"> · {row.variantName}</span>}
                      </p>
                    </TableCell>
                    <TableCell muted className="hidden md:table-cell">
                      {row.location ?? '—'}
                    </TableCell>
                    <TableCell align="right" className="tabular-nums">
                      {formatNumber(row.onHand)}
                    </TableCell>
                    <TableCell align="right" muted className="hidden tabular-nums sm:table-cell">
                      {row.held > 0 ? formatNumber(row.held) : '—'}
                    </TableCell>
                    <TableCell align="right" className="font-medium tabular-nums">
                      {formatNumber(row.available)}
                    </TableCell>
                    <TableCell align="right" muted className="hidden tabular-nums lg:table-cell" title={thresholdHint(row)}>
                      {row.reorderPoint === null ? '—' : formatNumber(row.reorderPoint)}
                      {row.reorderPointSource === 'store' && <span className="ml-1 text-[10px] uppercase tracking-wide">this store</span>}
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATE_VARIANT[row.stockState]}>{STATE_LABEL[row.stockState]}</Badge>
                    </TableCell>
                    <TableCell align="right" muted className="hidden tabular-nums lg:table-cell">
                      {formatMoney(row.value)}
                    </TableCell>
                    {can.edit && (
                      <TableCell align="right">
                        <DropdownMenuRoot>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${row.name} at ${storeName}`}>
                              <MoreHorizontal className="size-3.5" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => setSettingsRow(row)}>
                              <Settings2 className="size-3.5" />
                              Settings at this store
                            </DropdownMenuItem>
                            <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setRemoveRow(row)}>
                              <Trash2 className="size-3.5" />
                              Remove from this store
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenuRoot>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {result.pageCount > 1 ? (
              <TablePagination
                page={result.page}
                totalPages={result.pageCount}
                totalItems={result.total}
                pageSize={result.perPage}
                onPageChange={(page) => update({ page: page > 1 ? String(page) : undefined }, { keepPage: true })}
              />
            ) : (
              <p className="border-t px-4 py-3 text-xs text-muted-foreground">
                {formatNumber(result.total)} product{result.total === 1 ? '' : 's'} stocked here
              </p>
            )}
          </TableWrapper>
        )}
      </div>

      <AddProductsSheet
        open={addOpen}
        onOpenChange={setAddOpen}
        warehouseId={params.warehouseId}
        storeName={storeName}
        canRecordStock={can.recordStock}
      />
      <StoreStockSettingsDialog
        open={settingsRow !== null}
        onOpenChange={(open) => !open && setSettingsRow(null)}
        warehouseId={params.warehouseId}
        storeName={storeName}
        row={settingsRow}
      />
      <RemoveFromStoreDialog
        open={removeRow !== null}
        onOpenChange={(open) => !open && setRemoveRow(null)}
        warehouseId={params.warehouseId}
        storeName={storeName}
        row={removeRow}
      />
    </>
  );
}
