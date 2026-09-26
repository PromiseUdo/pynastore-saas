'use client';

import * as React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeftRight, History, Plus, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { PageHeader, PageToolbar, PageBody } from '@/components/layout/page-header';
import { EmptyState } from '@/components/layout/empty-state';
import { SelectRoot, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Table, TableWrapper, TableHead, TableBody, TableRow, TableColumnHeader, TableCell } from '@/components/ui/table';
import { TablePagination } from '@/components/ui/table-pagination';
import { ExportCsvButton } from '@/components/dashboard/export-csv-button';
import { formatDate, formatMoney, formatNumber } from '@/lib/format';
import { MOVEMENT_LABEL, MOVEMENT_VARIANT, movementReason, movementSign } from '@/lib/inventory-labels';
import type { ItemListRow, MovementListParams, MovementListResult, MovementRow, WarehouseRow } from '@/features/inventory/actions';
import { RecordMovementDialog } from './RecordMovementDialog';
import { TransferStockDialog } from './TransferStockDialog';

type MovementsPageClientProps = {
  result: MovementListResult;
  params: MovementListParams;
  items: ItemListRow[];
  warehouses: WarehouseRow[];
  canRecord: boolean;
};

export function MovementsPageClient({ result, params, items, warehouses, canRecord }: MovementsPageClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isNavigating, startTransition] = React.useTransition();

  const [query, setQuery] = React.useState(params.q ?? '');
  const [recordOpen, setRecordOpen] = React.useState(false);
  const [transferOpen, setTransferOpen] = React.useState(false);

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

  const hasFilters = Boolean(params.q || params.warehouseId || params.type || params.from || params.to);

  function clearFilters() {
    setQuery('');
    update({ q: undefined, store: undefined, type: undefined, from: undefined, to: undefined });
  }

  return (
    <>
      <PageHeader
        title="Stock movements"
        description="Every change to your stock, newest first. This record is never edited — corrections are added as new entries."
        actions={
          canRecord ? (
            <>
              <Button variant="outline" size="sm" onClick={() => setTransferOpen(true)} disabled={warehouses.length < 2}>
                <ArrowLeftRight className="size-3.5" />
                Move between stores
              </Button>
              <Button size="sm" onClick={() => setRecordOpen(true)} disabled={items.length === 0 || warehouses.length === 0}>
                <Plus className="size-3.5" />
                Record movement
              </Button>
            </>
          ) : undefined
        }
      />

      {result.ledgerSize > 0 && (
        <PageToolbar>
          <div className="w-full sm:w-64">
            <Input
              aria-label="Search movements"
              placeholder="Search item, SKU or note…"
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
            <SelectRoot value={params.type ?? 'all'} onValueChange={(v) => update({ type: v === 'all' ? undefined : v })}>
              <SelectTrigger aria-label="Movement type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                {(Object.keys(MOVEMENT_LABEL) as MovementRow['type'][]).map((type) => (
                  <SelectItem key={type} value={type}>
                    {MOVEMENT_LABEL[type]}
                  </SelectItem>
                ))}
              </SelectContent>
            </SelectRoot>
          </div>
          <div className="w-[calc(50%-4px)] sm:w-44">
            <SelectRoot value={params.warehouseId ?? 'all'} onValueChange={(v) => update({ store: v === 'all' ? undefined : v })}>
              <SelectTrigger aria-label="Store">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All stores</SelectItem>
                {warehouses.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </SelectRoot>
          </div>
          <div className="flex items-center gap-1.5">
            <Input
              type="date"
              aria-label="From date"
              className="w-36"
              value={params.from ?? ''}
              max={params.to}
              onChange={(e) => update({ from: e.target.value || undefined })}
            />
            <span className="text-xs text-muted-foreground">to</span>
            <Input
              type="date"
              aria-label="To date"
              className="w-36"
              value={params.to ?? ''}
              min={params.from}
              onChange={(e) => update({ to: e.target.value || undefined })}
            />
          </div>
          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              Clear filters
            </Button>
          )}
          <div className="ml-auto">
            <ExportCsvButton
              name="Stock movements"
              rows={result.rows}
              columns={[
                { header: 'Date', value: (m) => new Date(m.createdAt).toISOString() },
                { header: 'Item', value: (m) => m.itemName },
                { header: 'SKU', value: (m) => m.itemSku },
                { header: 'Type', value: (m) => MOVEMENT_LABEL[m.type] },
                { header: 'Store', value: (m) => m.warehouseName },
                { header: 'Moved to', value: (m) => m.toWarehouseName },
                { header: 'Quantity', value: (m) => m.quantity },
                { header: 'Unit cost', value: (m) => m.unitCost },
                { header: 'Reason', value: (m) => movementReason(m) },
              ]}
            />
          </div>
        </PageToolbar>
      )}

      <PageBody className={cn('transition-opacity', isNavigating && 'opacity-60')}>
        {result.ledgerSize === 0 ? (
          <EmptyState
            icon={History}
            title="No stock movements yet"
            description="Every time stock arrives, leaves or is counted, it lands here — with what changed, where, and why. Receiving a purchase order or packing an order writes entries for you."
            action={
              canRecord ? (
                <Button size="sm" onClick={() => setRecordOpen(true)} disabled={items.length === 0 || warehouses.length === 0}>
                  <Plus className="size-3.5" />
                  Record a movement
                </Button>
              ) : undefined
            }
          />
        ) : result.rows.length === 0 ? (
          <EmptyState
            variant="filtered"
            title="No movements match these filters"
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
                  <TableColumnHeader>Item</TableColumnHeader>
                  <TableColumnHeader>What happened</TableColumnHeader>
                  <TableColumnHeader>Store</TableColumnHeader>
                  <TableColumnHeader align="right">Quantity</TableColumnHeader>
                  <TableColumnHeader align="right" className="hidden lg:table-cell">
                    Unit cost
                  </TableColumnHeader>
                  <TableColumnHeader className="hidden md:table-cell">Reason</TableColumnHeader>
                  <TableColumnHeader>Date</TableColumnHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {result.rows.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="py-2">
                      <span className="font-medium text-foreground">{m.itemName}</span>
                      <p className="font-mono text-xs text-muted-foreground">{m.itemSku}</p>
                    </TableCell>
                    <TableCell>
                      <Badge variant={MOVEMENT_VARIANT[m.type]}>{MOVEMENT_LABEL[m.type]}</Badge>
                    </TableCell>
                    <TableCell muted className="whitespace-nowrap">
                      {m.warehouseName}
                      {m.toWarehouseName && <span className="text-foreground"> → {m.toWarehouseName}</span>}
                    </TableCell>
                    <TableCell align="right" className="tabular-nums">
                      {movementSign(m.type)}
                      {formatNumber(m.quantity)}
                    </TableCell>
                    <TableCell align="right" muted className="hidden tabular-nums lg:table-cell">
                      {formatMoney(m.unitCost)}
                    </TableCell>
                    <TableCell muted className="hidden max-w-56 truncate md:table-cell" title={movementReason(m)}>
                      {movementReason(m)}
                    </TableCell>
                    <TableCell muted className="whitespace-nowrap">
                      {formatDate(m.createdAt)}
                    </TableCell>
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
                {formatNumber(result.total)} movement{result.total === 1 ? '' : 's'}
              </p>
            )}
          </TableWrapper>
        )}
      </PageBody>

      <RecordMovementDialog open={recordOpen} onOpenChange={setRecordOpen} items={items} warehouses={warehouses} />
      <TransferStockDialog open={transferOpen} onOpenChange={setTransferOpen} items={items} warehouses={warehouses} />
    </>
  );
}
