'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
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
import {
  SelectRoot,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { createStockMovement, type ItemListRow, type WarehouseRow } from '@/features/inventory/actions';

type RecordMovementDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: ItemListRow[];
  warehouses: WarehouseRow[];
};

const MOVEMENT_TYPES = [
  { value: 'IN', label: 'Stock in (received)' },
  { value: 'OUT', label: 'Stock out (issued)' },
  { value: 'ADJUSTMENT', label: 'Adjustment (correction)' },
] as const;

export function RecordMovementDialog({ open, onOpenChange, items, warehouses }: RecordMovementDialogProps) {
  const router = useRouter();
  const [type, setType] = React.useState<'IN' | 'OUT' | 'ADJUSTMENT'>('IN');
  const [itemId, setItemId] = React.useState<string | undefined>(items[0]?.id);
  const [warehouseId, setWarehouseId] = React.useState<string | undefined>(warehouses[0]?.id);
  const [quantity, setQuantity] = React.useState('');
  const [unitCost, setUnitCost] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [isPending, setIsPending] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setType('IN');
      setItemId(items[0]?.id);
      setWarehouseId(warehouses[0]?.id);
      setQuantity('');
      setUnitCost('');
      setNotes('');
      setError(null);
    }
  }, [open, items, warehouses]);

  async function handleSubmit() {
    if (!itemId || !warehouseId) {
      setError('Select an item and a store.');
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
      warehouseId,
      type,
      quantity: qty,
      unitCost: type === 'IN' && unitCost ? Number(unitCost) : undefined,
      notes: notes.trim() || undefined,
    });

    setIsPending(false);
    if (!result.success) {
      setError(result.error);
      toast.error(result.error);
      return;
    }
    toast.success('Stock movement recorded');
    router.refresh();
    onOpenChange(false);
  }

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Record stock movement</DialogTitle>
          <DialogDescription>Log stock received, issued, or corrected at a store.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Type</Label>
            <SelectRoot value={type} onValueChange={(v) => setType(v as typeof type)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MOVEMENT_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </SelectRoot>
          </div>

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

          <div className="space-y-1.5">
            <Label>Store</Label>
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

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="mv-qty">Quantity</Label>
              <Input id="mv-qty" type="number" min="0" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            </div>
            {type === 'IN' && (
              <div className="space-y-1.5">
                <Label htmlFor="mv-cost">Unit cost</Label>
                <Input id="mv-cost" type="number" min="0" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} />
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="mv-notes">Notes</Label>
            <Textarea id="mv-notes" className="h-16" value={notes} onChange={(e) => setNotes(e.target.value)} />
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
            Record
          </Button>
        </DialogFooter>
      </DialogContent>
    </DialogRoot>
  );
}
