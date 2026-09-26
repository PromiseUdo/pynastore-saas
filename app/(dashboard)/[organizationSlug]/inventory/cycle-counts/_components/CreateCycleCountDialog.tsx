'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { CheckboxRoot } from '@/components/ui/checkbox';
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
import { createCycleCount } from '@/features/inventory/actions';
import type { ItemListRow, WarehouseRow } from '@/features/inventory/actions';

type CreateCycleCountDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  warehouses: WarehouseRow[];
  items: ItemListRow[];
  organizationSlug: string;
};

export function CreateCycleCountDialog({
  open,
  onOpenChange,
  warehouses,
  items,
  organizationSlug,
}: CreateCycleCountDialogProps) {
  const router = useRouter();
  /* Only the stores this member may work in can be written to, so those are
     the only ones offered — the server re-checks anyway (Phase 8.6). */
  const mine = React.useMemo(() => warehouses.filter((w) => w.canWorkHere), [warehouses]);

  const [warehouseId, setWarehouseId] = React.useState<string | undefined>(mine[0]?.id);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [notes, setNotes] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [isPending, setIsPending] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setWarehouseId(mine[0]?.id);
      setSelected(new Set());
      setNotes('');
      setError(null);
    }
  }, [open, warehouses]);

  function toggle(itemId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }

  async function handleSubmit() {
    if (!warehouseId) {
      setError('Select a store.');
      return;
    }
    if (selected.size === 0) {
      setError('Select at least one item to count.');
      return;
    }

    setIsPending(true);
    setError(null);

    const result = await createCycleCount({
      warehouseId,
      itemIds: [...selected],
      notes: notes.trim() || undefined,
    });

    setIsPending(false);
    if (!result.success) {
      setError(result.error);
      toast.error(result.error);
      return;
    }
    onOpenChange(false);
    router.push(`/inventory/cycle-counts/${result.data.id}`);
  }

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New cycle count</DialogTitle>
          <DialogDescription>Pick a store and the items to count.</DialogDescription>
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
            <Label>Items *</Label>
            <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border p-2">
              {items.map((item) => (
                <label key={item.id} className="flex items-center gap-2 rounded-sm px-1.5 py-1 text-sm hover:bg-muted/50">
                  <CheckboxRoot checked={selected.has(item.id)} onCheckedChange={() => toggle(item.id)} />
                  <span className="text-foreground">{item.name}</span>
                  <span className="text-xs text-muted-foreground">{item.sku}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cc-notes">Notes</Label>
            <Textarea id="cc-notes" className="h-16" value={notes} onChange={(e) => setNotes(e.target.value)} />
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
            Start count
          </Button>
        </DialogFooter>
      </DialogContent>
    </DialogRoot>
  );
}
