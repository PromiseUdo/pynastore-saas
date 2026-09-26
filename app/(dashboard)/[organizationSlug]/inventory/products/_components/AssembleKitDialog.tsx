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
import { assembleKit } from '@/features/inventory/actions';
import type { WarehouseRow } from '@/features/inventory/actions';

type AssembleKitDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kit: { id: string; name: string } | null;
  warehouses: WarehouseRow[];
};

export function AssembleKitDialog({ open, onOpenChange, kit, warehouses }: AssembleKitDialogProps) {
  /* Assembly consumes and creates stock, so only the stores this member may
     work in are offered — the server re-checks anyway (Phase 8.6). */
  const mine = React.useMemo(() => warehouses.filter((w) => w.canWorkHere), [warehouses]);
  const router = useRouter();
  const [warehouseId, setWarehouseId] = React.useState<string | undefined>(mine[0]?.id);
  const [quantity, setQuantity] = React.useState('1');
  const [error, setError] = React.useState<string | null>(null);
  const [isPending, setIsPending] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setWarehouseId(mine[0]?.id);
      setQuantity('1');
      setError(null);
    }
  }, [open, warehouses]);

  async function handleSubmit() {
    if (!kit || !warehouseId) {
      setError('Select a store.');
      return;
    }
    const qty = Number(quantity);
    if (!qty || qty <= 0) {
      setError('Enter a valid quantity.');
      return;
    }

    setIsPending(true);
    setError(null);

    const result = await assembleKit({ kitItemId: kit.id, warehouseId, quantity: qty });

    setIsPending(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    toast.success('Kit assembled');
    router.refresh();
    onOpenChange(false);
  }

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Assemble {kit?.name}</DialogTitle>
          <DialogDescription>Consumes component stock and produces finished kit units.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Store</Label>
            <SelectRoot value={warehouseId} onValueChange={setWarehouseId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {mine.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </SelectRoot>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="assemble-qty">Quantity to assemble</Label>
            <Input id="assemble-qty" type="number" min="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
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
            Assemble
          </Button>
        </DialogFooter>
      </DialogContent>
    </DialogRoot>
  );
}
