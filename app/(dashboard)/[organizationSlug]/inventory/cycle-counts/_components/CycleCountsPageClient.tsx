'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Plus, ClipboardCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageHeader, PageToolbar, PageBody } from '@/components/layout/page-header';
import { EmptyState } from '@/components/layout/empty-state';
import { formatDate, formatNumber } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
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
import { CreateCycleCountDialog } from './CreateCycleCountDialog';
import type { CycleCountListRow, ItemListRow, WarehouseRow } from '@/features/inventory/actions';

type CycleCountsPageClientProps = {
  cycleCounts: CycleCountListRow[];
  warehouses: WarehouseRow[];
  items: ItemListRow[];
  canManage: boolean;
  organizationSlug: string;
};

const STATUS_VARIANT: Record<CycleCountListRow['status'], 'pending' | 'completed' | 'muted'> = {
  OPEN: 'pending',
  COMPLETED: 'completed',
  CANCELLED: 'muted',
};

const STATUS_LABEL: Record<CycleCountListRow['status'], string> = {
  OPEN: 'Counting',
  COMPLETED: 'Done',
  CANCELLED: 'Cancelled',
};

export function CycleCountsPageClient({
  cycleCounts,
  warehouses,
  items,
  canManage,
  organizationSlug,
}: CycleCountsPageClientProps) {
  const router = useRouter();
  const [createOpen, setCreateOpen] = React.useState(false);
  const open = cycleCounts.filter((c) => c.status === 'OPEN');

  return (
    <>
      <PageHeader
        title="Stock counts"
        description="Count what's physically on the shelf, then let us correct the numbers to match."
        actions={
          canManage ? (
            <Button size="sm" onClick={() => setCreateOpen(true)} disabled={warehouses.length === 0 || items.length === 0}>
              <Plus className="size-3.5" />
              Start a count
            </Button>
          ) : undefined
        }
      />

      {open.length > 0 && (
        <PageToolbar>
          <p className="text-sm text-muted-foreground">
            {open.length === 1 ? 'One count is' : `${open.length} counts are`} still in progress — finishing a count
            adjusts stock to the numbers you entered.
          </p>
        </PageToolbar>
      )}

      <PageBody>
        {cycleCounts.length === 0 ? (
          <EmptyState
            icon={ClipboardCheck}
            title="No stock counts yet"
            description="Pick a store and the items to check, enter what you actually find on the shelf, and we'll correct the difference and record why."
            action={
              canManage ? (
                <Button size="sm" onClick={() => setCreateOpen(true)} disabled={warehouses.length === 0 || items.length === 0}>
                  <Plus className="size-3.5" />
                  Start a count
                </Button>
              ) : undefined
            }
          />
        ) : (
          <TableWrapper>
            <Table>
              <TableHead>
                <TableRow>
                  <TableColumnHeader>Store</TableColumnHeader>
                  <TableColumnHeader align="right">Items</TableColumnHeader>
                  <TableColumnHeader>Status</TableColumnHeader>
                  <TableColumnHeader>Started</TableColumnHeader>
                  <TableColumnHeader>Finished</TableColumnHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {cycleCounts.map((c) => (
                    <TableRow
                      key={c.id}
                      clickable
                      onClick={() => router.push(`/inventory/cycle-counts/${c.id}`)}
                    >
                      <TableCell className="font-medium text-foreground">{c.warehouseName}</TableCell>
                      <TableCell align="right" className="tabular-nums">
                        {formatNumber(c.itemCount)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={STATUS_VARIANT[c.status]}>{STATUS_LABEL[c.status]}</Badge>
                      </TableCell>
                      <TableCell muted className="whitespace-nowrap">
                        {formatDate(c.createdAt)}
                      </TableCell>
                      <TableCell muted className="whitespace-nowrap">
                        {formatDate(c.completedAt)}
                      </TableCell>
                    </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableWrapper>
        )}
      </PageBody>

      <CreateCycleCountDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        warehouses={warehouses}
        items={items}
        organizationSlug={organizationSlug}
      />
    </>
  );
}
