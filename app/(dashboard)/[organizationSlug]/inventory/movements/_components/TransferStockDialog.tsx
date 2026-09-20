'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
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
import {
  SelectRoot,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { createStockMovement, type ItemListRow, type WarehouseRow } from '@/features/inventory/actions';

type TransferStockDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: ItemListRow[];
  warehouses: WarehouseRow[];
};

export function TransferStockDialog({ open, onOpenChange, items, warehouses }: TransferStockDialogProps) {
  const router = useRouter();
  const [itemId, setItemId] = React.useState<string | undefined>(items[0]?.id);
  const [fromWarehouseId, setFromWarehouseId] = React.useState<string | undefined>(warehouses[0]?.id);
  const [toWarehouseId, setToWarehouseId] = React.useState<string | undefined>(warehouses[1]?.id);
  const [quantity, setQuantity] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [isPending, setIsPending] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setItemId(items[0]?.id);
      setFromWarehouseId(warehouses[0]?.id);
      setToWarehouseId(warehouses[1]?.id ?? warehouses[0]?.id);
      setQuantity('');
      setError(null);
    }
  }, [open, items, warehouses]);

  async function handleSubmit() {
    if (!itemId || !fromWarehouseId || !toWarehouseId) {
      setError('Select an item and both stores.');
      return;
    }
    if (fromWarehouseId === toWarehouseId) {
      setError('Source and destination stores must be different.');
      return;
    }
    const qty = Number(quantity);
    if (!qty || qty <= 0) {
      setError('Enter a valid quantity.');
      return;
    }

    setIsPending(true);
    setError(null);

    const result = await createStockMovement({
      inventoryItemId: itemId,
      warehouseId: fromWarehouseId,
      toWarehouseId,
      type: 'TRANSFER',
      quantity: qty,
    });

    setIsPending(false);
    if (!result.success) {
      setError(result.error);
      toast.error(result.error);
      return;
    }
    toast.success('Stock moved between stores');
    router.refresh();
    onOpenChange(false);
  }

  if (warehouses.length < 2) {
    return (
      <DialogRoot open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Transfer stock</DialogTitle>
            <DialogDescription>You need at least two stores to transfer stock between them.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" size="sm">
                Close
              </Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </DialogRoot>
    );
  }

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Transfer stock</DialogTitle>
          <DialogDescription>Move stock for one item between two stores.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Item</Label>
            <SelectRoot value={itemId} onValueChange={setItemId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {items.map((it) => (
                  <SelectItem key={it.id} value={it.id}>
                    {it.name} ({it.sku})
                  </SelectItem>
                ))}
              </SelectContent>
            </SelectRoot>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>From store</Label>
              <SelectRoot value={fromWarehouseId} onValueChange={setFromWarehouseId}>
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
            <div className="space-y-1.5">
              <Label>To store</Label>
              <SelectRoot value={toWarehouseId} onValueChange={setToWarehouseId}>
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
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tr-qty">Quantity</Label>
            <Input id="tr-qty" type="number" min="0" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
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
            Transfer
          </Button>
        </DialogFooter>
      </DialogContent>
    </DialogRoot>
  );
}
