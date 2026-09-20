'use client';

import * as React from 'react';
import Link from 'next/link';
import { PackageSearch, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader, PageToolbar, PageBody } from '@/components/layout/page-header';
import { EmptyState } from '@/components/layout/empty-state';
import { formatNumber } from '@/lib/format';
import {
  Table,
  TableWrapper,
  TableHead,
  TableBody,
  TableRow,
  TableColumnHeader,
  TableCell,
  TableEmpty,
} from '@/components/ui/table';
import {
  SelectRoot,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { LocationCell } from './LocationCell';
import type { PutawayRow, WarehouseRow } from '@/features/inventory/actions';

type PutawayPageClientProps = {
  rows: PutawayRow[];
  warehouses: WarehouseRow[];
  canManage: boolean;
};

export function PutawayPageClient({ rows, warehouses, canManage }: PutawayPageClientProps) {
  const [warehouseId, setWarehouseId] = React.useState<string>('__all__');
  const [onlyUnlocated, setOnlyUnlocated] = React.useState(false);
  const [query, setQuery] = React.useState('');

  const inStore = warehouseId === '__all__' ? rows : rows.filter((r) => r.warehouseId === warehouseId);
  const unlocatedCount = inStore.filter((r) => !r.location).length;

  const q = query.trim().toLowerCase();
  const filteredRows = inStore.filter(
    (r) =>
      (!onlyUnlocated || !r.location) &&
      (!q || r.itemName.toLowerCase().includes(q) || r.sku.toLowerCase().includes(q) || (r.location ?? '').toLowerCase().includes(q)),
  );

  return (
    <>
      <PageHeader
        title="Shelf locations"
        description="Where each item sits in each store, so pickers can find it instead of hunting for it."
      />

      {rows.length > 0 && (
        <PageToolbar>
          <div className="w-full sm:w-60">
            <Input
              aria-label="Search items or locations"
              placeholder="Search item, SKU or location…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              startAdornment={<Search className="size-3.5" />}
            />
          </div>
          <div className="w-[calc(50%-4px)] sm:w-44">
            <SelectRoot value={warehouseId} onValueChange={setWarehouseId}>
              <SelectTrigger aria-label="Store">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All stores</SelectItem>
                {warehouses.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </SelectRoot>
          </div>
          <Button
            variant={onlyUnlocated ? 'secondary' : 'outline'}
            size="sm"
            aria-pressed={onlyUnlocated}
            onClick={() => setOnlyUnlocated((v) => !v)}
          >
            Needs a location
            {unlocatedCount > 0 && <Badge variant="warning">{formatNumber(unlocatedCount)}</Badge>}
          </Button>
          <span className="ml-auto text-xs text-muted-foreground">
            {unlocatedCount === 0
              ? 'Every item here has a location.'
              : `${formatNumber(unlocatedCount)} still need${unlocatedCount === 1 ? 's' : ''} one.`}
          </span>
        </PageToolbar>
      )}

      <PageBody>
        {rows.length === 0 ? (
          <EmptyState
            icon={PackageSearch}
            title="Nothing to shelve yet"
            description={
              <>
                Once stock arrives in a store, each item shows up here so you can tag its aisle, shelf or bin. Receive a{' '}
                <Link href="/procurement/purchase-orders" className="text-primary hover:underline">
                  purchase order
                </Link>{' '}
                to get started.
              </>
            }
          />
        ) : filteredRows.length === 0 ? (
          <EmptyState
            variant="filtered"
            title={onlyUnlocated ? 'Everything here has a location' : 'Nothing matches your search'}
            action={
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setQuery('');
                  setOnlyUnlocated(false);
                  setWarehouseId('__all__');
                }}
              >
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
                  <TableColumnHeader>Store</TableColumnHeader>
                  <TableColumnHeader align="right">On hand</TableColumnHeader>
                  <TableColumnHeader>Location</TableColumnHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {filteredRows.map((r) => (
                  <TableRow key={`${r.inventoryItemId}-${r.warehouseId}`}>
                    <TableCell className="py-2">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-foreground">{r.itemName}</span>
                        {!r.location && <Badge variant="warning">Needs location</Badge>}
                      </div>
                      <p className="font-mono text-xs text-muted-foreground">{r.sku}</p>
                    </TableCell>
                    <TableCell muted>{r.warehouseName}</TableCell>
                    <TableCell align="right" className="tabular-nums">
                      {formatNumber(r.quantity)}
                    </TableCell>
                    <TableCell>
                      <LocationCell
                        inventoryItemId={r.inventoryItemId}
                        warehouseId={r.warehouseId}
                        location={r.location}
                        disabled={!canManage}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableWrapper>
        )}
      </PageBody>
    </>
  );
}
