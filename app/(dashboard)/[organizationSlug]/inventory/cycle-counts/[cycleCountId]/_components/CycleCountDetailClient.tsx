'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowLeft, Loader2, Save, CheckCircle2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageBody } from '@/components/layout/page-header';
import {
  AlertDialogRoot,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { formatDate, formatNumber } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableWrapper,
  TableHead,
  TableBody,
  TableRow,
  TableColumnHeader,
  TableCell,
} from '@/components/ui/table';
import { recordCounts, completeCycleCount, cancelCycleCount, type CycleCountDetail } from '@/features/inventory/actions';

type CycleCountDetailClientProps = {
  cycleCount: CycleCountDetail;
  canManage: boolean;
};

const STATUS_LABEL: Record<CycleCountDetail['status'], string> = {
  OPEN: 'Counting',
  COMPLETED: 'Done',
  CANCELLED: 'Cancelled',
};

const STATUS_VARIANT: Record<CycleCountDetail['status'], 'pending' | 'completed' | 'muted'> = {
  OPEN: 'pending',
  COMPLETED: 'completed',
  CANCELLED: 'muted',
};

export function CycleCountDetailClient({ cycleCount, canManage }: CycleCountDetailClientProps) {
  const router = useRouter();
  const [counts, setCounts] = React.useState<Record<string, string>>(
    Object.fromEntries(cycleCount.items.map((i) => [i.id, i.countedQty !== null ? String(i.countedQty) : ''])),
  );
  const [error, setError] = React.useState<string | null>(null);
  const [isSaving, setIsSaving] = React.useState(false);
  const [isCompleting, setIsCompleting] = React.useState(false);
  const [isCancelling, setIsCancelling] = React.useState(false);
  const [confirm, setConfirm] = React.useState<'complete' | 'cancel' | null>(null);

  const isOpen = cycleCount.status === 'OPEN';
  const allCounted = cycleCount.items.every((i) => counts[i.id] !== undefined && counts[i.id] !== '');
  const countedSoFar = cycleCount.items.filter((i) => counts[i.id] !== undefined && counts[i.id] !== '').length;

  /* What completing the count would actually change, so the confirmation can
   * say it plainly instead of "are you sure?". */
  const differences = cycleCount.items
    .map((item) => ({ item, variance: counts[item.id] === '' || counts[item.id] === undefined ? null : Number(counts[item.id]) - item.expectedQty }))
    .filter((row) => row.variance !== null && row.variance !== 0);

  async function handleSave() {
    setIsSaving(true);
    setError(null);

    const result = await recordCounts(cycleCount.id, {
      counts: cycleCount.items
        .filter((i) => counts[i.id] !== '' && counts[i.id] !== undefined)
        .map((i) => ({ cycleCountItemId: i.id, countedQty: Number(counts[i.id]) })),
    });

    setIsSaving(false);
    if (!result.success) {
      setError(result.error);
      toast.error(result.error);
      return;
    }
    toast.success('Progress saved');
    router.refresh();
  }

  async function handleComplete() {
    setIsCompleting(true);
    setError(null);

    const saveResult = await recordCounts(cycleCount.id, {
      counts: cycleCount.items.map((i) => ({ cycleCountItemId: i.id, countedQty: Number(counts[i.id]) })),
    });
    if (!saveResult.success) {
      setIsCompleting(false);
      setError(saveResult.error);
      return;
    }

    const result = await completeCycleCount(cycleCount.id);
    setIsCompleting(false);
    if (!result.success) {
      setError(result.error);
      toast.error(result.error);
      return;
    }
    setConfirm(null);
    toast.success(
      differences.length === 0
        ? 'Count finished — everything matched'
        : `Count finished — ${differences.length} item${differences.length === 1 ? '' : 's'} corrected`,
    );
    router.refresh();
  }

  async function handleCancel() {
    setIsCancelling(true);
    setError(null);
    const result = await cancelCycleCount(cycleCount.id);
    setIsCancelling(false);
    if (!result.success) {
      setError(result.error);
      toast.error(result.error);
      return;
    }
    setConfirm(null);
    toast.success('Count cancelled — no stock was changed');
    router.refresh();
  }

  return (
    <>
      <div className="border-b bg-background px-4 py-4 sm:px-6">
        <Link
          href="/inventory/cycle-counts"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3" /> Stock counts
        </Link>
        <div className="mt-1 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-lg font-semibold tracking-tight text-foreground">{cycleCount.warehouseName}</h1>
            <Badge variant={STATUS_VARIANT[cycleCount.status]}>{STATUS_LABEL[cycleCount.status]}</Badge>
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {isOpen
              ? `${countedSoFar} of ${cycleCount.itemCount} item${cycleCount.itemCount === 1 ? '' : 's'} counted. Finishing the count corrects stock to match what you entered.`
              : `${cycleCount.itemCount} item${cycleCount.itemCount === 1 ? '' : 's'} counted${cycleCount.completedAt ? ` on ${formatDate(cycleCount.completedAt)}` : ''}.`}
          </p>
        </div>
        {isOpen && canManage && (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setConfirm('cancel')} disabled={isCancelling}>
              <XCircle className="size-3.5" />
              Cancel count
            </Button>
            <Button variant="outline" size="sm" onClick={handleSave} disabled={isSaving}>
              {isSaving && <Loader2 className="size-3.5 animate-spin" />}
              <Save className="size-3.5" />
              Save progress
            </Button>
            <Button size="sm" onClick={() => setConfirm('complete')} disabled={isCompleting || !allCounted}>
              <CheckCircle2 className="size-3.5" />
              Finish count
            </Button>
          </div>
        )}
        </div>
        {isOpen && canManage && !allCounted && (
          <p className="mt-2 text-xs text-muted-foreground">
            Enter a number for every item before finishing — an uncounted item would look like zero stock.
          </p>
        )}
      </div>

      <PageBody>
        {error && (
          <p role="alert" className="mb-4 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        <TableWrapper>
          <Table>
            <TableHead>
              <TableRow>
                <TableColumnHeader>Item</TableColumnHeader>
                <TableColumnHeader align="right">System says</TableColumnHeader>
                <TableColumnHeader align="right">You counted</TableColumnHeader>
                <TableColumnHeader align="right">Difference</TableColumnHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {cycleCount.items.map((item) => {
                const countedValue = counts[item.id] ?? '';
                const variance = countedValue !== '' ? Number(countedValue) - item.expectedQty : null;
                return (
                  <TableRow key={item.id}>
                    <TableCell>
                      <span className="font-medium text-foreground">{item.itemName}</span>
                      <p className="text-xs text-muted-foreground">{item.sku}</p>
                    </TableCell>
                    <TableCell align="right" muted>
                      {item.expectedQty}
                    </TableCell>
                    <TableCell align="right">
                      {isOpen && canManage ? (
                        <Input
                          className="ml-auto h-7 w-24 text-right"
                          type="number"
                          min="0"
                          value={countedValue}
                          onChange={(e) => setCounts((prev) => ({ ...prev, [item.id]: e.target.value }))}
                        />
                      ) : (
                        (item.countedQty ?? '—')
                      )}
                    </TableCell>
                    <TableCell align="right">
                      {variance !== null && (
                        <Badge variant={variance === 0 ? 'muted' : variance > 0 ? 'success' : 'destructive'}>
                          {variance === 0 ? 'Matches' : variance > 0 ? `+${formatNumber(variance)} found` : `${formatNumber(variance)} missing`}
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableWrapper>
      </PageBody>

      <AlertDialogRoot open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm === 'cancel' ? 'Cancel this count?' : 'Finish the count and correct stock?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === 'cancel' ? (
                'Nothing you counted will be saved and stock stays exactly as it is.'
              ) : differences.length === 0 ? (
                'Everything you counted matches the system, so no stock will change.'
              ) : (
                <>
                  {differences.length} item{differences.length === 1 ? '' : 's'} will be corrected to match your count:
                  <span className="mt-2 block max-h-40 space-y-1 overflow-y-auto">
                    {differences.slice(0, 8).map(({ item, variance }) => (
                      <span key={item.id} className="block text-foreground">
                        {item.itemName}: {item.expectedQty} → {counts[item.id]}{' '}
                        <span className={variance! > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive'}>
                          ({variance! > 0 ? `+${variance}` : variance})
                        </span>
                      </span>
                    ))}
                    {differences.length > 8 && <span className="block">and {differences.length - 8} more…</span>}
                  </span>
                  <span className="mt-2 block">Each correction is recorded in stock movements. This can’t be undone.</span>
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{confirm === 'cancel' ? 'Keep counting' : 'Go back'}</AlertDialogCancel>
            {confirm === 'cancel' ? (
              <Button variant="destructive" onClick={handleCancel} disabled={isCancelling}>
                {isCancelling && <Loader2 className="size-3.5 animate-spin" />}
                Cancel count
              </Button>
            ) : (
              <Button onClick={handleComplete} disabled={isCompleting}>
                {isCompleting && <Loader2 className="size-3.5 animate-spin" />}
                Finish count
              </Button>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialogRoot>
    </>
  );
}
