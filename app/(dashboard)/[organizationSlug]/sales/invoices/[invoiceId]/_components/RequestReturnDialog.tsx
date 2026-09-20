'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  DialogRoot,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from '@/components/ui/dialog';
import { requestReturn, type InvoiceDetail } from '@/features/sales/actions';

type RequestReturnDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoice: InvoiceDetail;
};

export function RequestReturnDialog({ open, onOpenChange, invoice }: RequestReturnDialogProps) {
  const router = useRouter();
  const eligibleLines = invoice.lineItems.filter((li) => li.quantity - li.returnedQty > 0);
  const [quantities, setQuantities] = React.useState<Record<string, string>>({});
  const [reason, setReason] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [isPending, setIsPending] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setQuantities({});
      setReason('');
      setError(null);
    }
  }, [open]);

  async function handleSubmit() {
    const lineItems = eligibleLines
      .map((li) => ({ invoiceLineItemId: li.id, quantity: Number(quantities[li.id] ?? 0) }))
      .filter((r) => r.quantity > 0);

    if (lineItems.length === 0) {
      setError('Enter a quantity for at least one line item.');
      return;
    }

    setIsPending(true);
    setError(null);

    const result = await requestReturn(invoice.id, { reason: reason.trim() || undefined, lineItems });

    setIsPending(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    onOpenChange(false);
    router.push(`/sales/returns/${result.data.id}`);
  }

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Request return</DialogTitle>
          <DialogDescription>Enter how many units of each item are being returned.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {eligibleLines.map((li) => {
            const remaining = li.quantity - li.returnedQty;
            return (
              <div key={li.id} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{li.description}</p>
                  <p className="text-xs text-muted-foreground">{remaining} eligible to return</p>
                </div>
                <Input
                  className="w-24"
                  type="number"
                  min="0"
                  max={remaining}
                  value={quantities[li.id] ?? ''}
                  onChange={(e) => setQuantities((prev) => ({ ...prev, [li.id]: e.target.value }))}
                />
              </div>
            );
          })}

          <div className="space-y-1.5">
            <Label htmlFor="return-reason">Reason</Label>
            <Textarea id="return-reason" className="h-16" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" size="sm">
              Cancel
            </Button>
          </DialogClose>
          <Button size="sm" onClick={handleSubmit} disabled={isPending}>
            {isPending && <Loader2 className="size-3.5 animate-spin" />}
            Request return
          </Button>
        </DialogFooter>
      </DialogContent>
    </DialogRoot>
  );
}
