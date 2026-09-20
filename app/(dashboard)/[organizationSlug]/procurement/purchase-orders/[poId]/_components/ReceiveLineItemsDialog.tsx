'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  DialogRoot,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from '@/components/ui/dialog';
import { receivePOLineItems, type PODetail } from '@/features/procurement/actions';

type ReceiveLineItemsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  po: PODetail;
};

export function ReceiveLineItemsDialog({ open, onOpenChange, po }: ReceiveLineItemsDialogProps) {
  const router = useRouter();
  const outstanding = po.lineItems.filter((li) => li.receivedQty < li.quantity);
  const [quantities, setQuantities] = React.useState<Record<string, string>>({});
  const [error, setError] = React.useState<string | null>(null);
  const [isPending, setIsPending] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setQuantities(
        Object.fromEntries(outstanding.map((li) => [li.id, String(li.quantity - li.receivedQty)])),
      );
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function handleSubmit() {
    const receipts = outstanding
      .map((li) => ({ lineItemId: li.id, receivedQty: Number(quantities[li.id] ?? 0) }))
      .filter((r) => r.receivedQty > 0);

    if (receipts.length === 0) {
      setError('Enter a quantity for at least one line item.');
      return;
    }

    setIsPending(true);
    setError(null);

    const result = await receivePOLineItems(po.id, { receipts });

    setIsPending(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    router.refresh();
    onOpenChange(false);
  }

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Receive stock</DialogTitle>
          <DialogDescription>Enter how many units of each item arrived.</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {outstanding.map((li) => (
            <div key={li.id} className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{li.description}</p>
                <p className="text-xs text-muted-foreground">
                  {li.receivedQty} of {li.quantity} received
                </p>
              </div>
              <Input
                className="w-24"
                type="number"
                min="0"
                max={li.quantity - li.receivedQty}
                value={quantities[li.id] ?? ''}
                onChange={(e) => setQuantities((prev) => ({ ...prev, [li.id]: e.target.value }))}
                disabled={!li.inventoryItemId}
              />
            </div>
          ))}
          {outstanding.some((li) => !li.inventoryItemId) && (
            <p className="text-xs text-muted-foreground">
              Line items without a linked catalog item can&apos;t update stock and are excluded.
            </p>
          )}
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
            Record receipt
          </Button>
        </DialogFooter>
      </DialogContent>
    </DialogRoot>
  );
}
