'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
import {
  SelectRoot,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { convertQuoteToInvoice } from '@/features/sales/actions';
import type { WarehouseRow } from '@/features/inventory/actions';

type ConvertToInvoiceDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  quoteId: string;
  warehouses: WarehouseRow[];
};

export function ConvertToInvoiceDialog({ open, onOpenChange, quoteId, warehouses }: ConvertToInvoiceDialogProps) {
  const router = useRouter();
  const [warehouseId, setWarehouseId] = React.useState<string | undefined>(warehouses[0]?.id);
  const [error, setError] = React.useState<string | null>(null);
  const [isPending, setIsPending] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setWarehouseId(warehouses[0]?.id);
      setError(null);
    }
  }, [open, warehouses]);

  async function handleSubmit() {
    if (!warehouseId) {
      setError('Select a fulfillment store.');
      return;
    }
    setIsPending(true);
    setError(null);

    const result = await convertQuoteToInvoice(quoteId, { warehouseId });

    setIsPending(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    onOpenChange(false);
    router.push(`/sales/invoices/${result.data.invoiceId}`);
  }

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Convert to invoice</DialogTitle>
          <DialogDescription>Choose the store this order will be fulfilled from.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Fulfillment store</Label>
            <SelectRoot value={warehouseId} onValueChange={setWarehouseId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {warehouses.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </SelectRoot>
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
            Convert
          </Button>
        </DialogFooter>
      </DialogContent>
    </DialogRoot>
  );
}
