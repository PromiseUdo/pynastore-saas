'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableWrapper,
  TableHead,
  TableBody,
  TableRow,
  TableColumnHeader,
  TableCell,
} from '@/components/ui/table';
import { approveReturn, rejectReturn, type ReturnDetail } from '@/features/sales/actions';

type ReturnDetailClientProps = {
  returnRequest: ReturnDetail;
  canManage: boolean;
};

const STATUS_VARIANT: Record<ReturnDetail['status'], 'pending' | 'approved' | 'rejected'> = {
  REQUESTED: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
};

export function ReturnDetailClient({ returnRequest, canManage }: ReturnDetailClientProps) {
  const router = useRouter();
  const [isPending, setIsPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function runAction(action: () => Promise<{ success: boolean; error?: string }>) {
    setIsPending(true);
    setError(null);
    const result = await action();
    setIsPending(false);
    if (!result.success) {
      setError(result.error ?? 'Something went wrong');
      return;
    }
    router.refresh();
  }

  return (
    <>
      <div className="flex items-center justify-between border-b bg-background px-6 py-5">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold tracking-tight text-foreground">Return for {returnRequest.invoiceNumber}</h1>
            <Badge variant={STATUS_VARIANT[returnRequest.status]}>{returnRequest.status}</Badge>
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {returnRequest.customerName} ·{' '}
            <Link href={`/sales/invoices/${returnRequest.invoiceId}`} className="text-primary hover:underline">
              View invoice
            </Link>
          </p>
        </div>
        {returnRequest.status === 'REQUESTED' && canManage && (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => runAction(() => rejectReturn(returnRequest.id))} disabled={isPending}>
              Reject
            </Button>
            <Button size="sm" onClick={() => runAction(() => approveReturn(returnRequest.id))} disabled={isPending}>
              {isPending && <Loader2 className="size-3.5 animate-spin" />}
              Approve &amp; restock
            </Button>
          </div>
        )}
      </div>

      <div className="space-y-4 px-6 py-6">
        {error && <p className="text-sm text-destructive">{error}</p>}

        <TableWrapper>
          <Table>
            <TableHead>
              <TableRow>
                <TableColumnHeader>Item</TableColumnHeader>
                <TableColumnHeader align="right">Quantity</TableColumnHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {returnRequest.lineItems.map((li) => (
                <TableRow key={li.id}>
                  <TableCell className="font-medium text-foreground">{li.description}</TableCell>
                  <TableCell align="right">{li.quantity}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableWrapper>

        {returnRequest.reason && (
          <div className="rounded-lg border bg-card px-4 py-3">
            <p className="text-xs font-medium text-muted-foreground">Reason</p>
            <p className="mt-1 text-sm text-foreground">{returnRequest.reason}</p>
          </div>
        )}
        {returnRequest.notes && (
          <div className="rounded-lg border bg-card px-4 py-3">
            <p className="text-xs font-medium text-muted-foreground">Notes</p>
            <p className="mt-1 text-sm text-foreground">{returnRequest.notes}</p>
          </div>
        )}
      </div>
    </>
  );
}
