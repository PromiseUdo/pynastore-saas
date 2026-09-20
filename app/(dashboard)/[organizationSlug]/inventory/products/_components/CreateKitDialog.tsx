'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, Plus, Trash2 } from 'lucide-react';
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
import { createKit, type ItemListRow } from '@/features/inventory/actions';

type ComponentRow = { componentItemId: string; quantity: string };

type CreateKitDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  candidateItems: ItemListRow[];
};

export function CreateKitDialog({ open, onOpenChange, candidateItems }: CreateKitDialogProps) {
  const router = useRouter();
  const [sku, setSku] = React.useState('');
  const [name, setName] = React.useState('');
  const [sellingPrice, setSellingPrice] = React.useState('');
  const [rows, setRows] = React.useState<ComponentRow[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [isPending, setIsPending] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setSku('');
      setName('');
      setSellingPrice('');
      setRows([]);
      setError(null);
    }
  }, [open]);

  function addRow() {
    if (candidateItems.length === 0) return;
    setRows((prev) => [...prev, { componentItemId: candidateItems[0].id, quantity: '1' }]);
  }

  function updateRow(index: number, patch: Partial<ComponentRow>) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  function removeRow(index: number) {
    setRows((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit() {
    if (!sku.trim() || !name.trim()) {
      setError('SKU and name are required.');
      return;
    }
    if (rows.length === 0) {
      setError('Add at least one component.');
      return;
    }

    setIsPending(true);
    setError(null);

    const result = await createKit({
      sku: sku.trim(),
      name: name.trim(),
      unit: 'pcs',
      sellingPrice: sellingPrice ? Number(sellingPrice) : undefined,
      components: rows.map((r) => ({ componentItemId: r.componentItemId, quantity: Number(r.quantity) || 0 })),
    });

    setIsPending(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    toast.success('Kit created');
    router.refresh();
    onOpenChange(false);
  }

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>New kit (BOM)</DialogTitle>
          <DialogDescription>Combine existing items into an assembled product.</DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="kit-sku">SKU *</Label>
              <Input id="kit-sku" value={sku} onChange={(e) => setSku(e.target.value)} autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="kit-name">Name *</Label>
              <Input id="kit-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="kit-price">Selling price</Label>
            <Input id="kit-price" type="number" min="0" value={sellingPrice} onChange={(e) => setSellingPrice(e.target.value)} />
          </div>

          <div className="space-y-2">
            <Label>Components *</Label>
            {rows.map((row, i) => (
              <div key={i} className="flex items-center gap-2">
                <SelectRoot value={row.componentItemId} onValueChange={(v) => updateRow(i, { componentItemId: v })}>
                  <SelectTrigger className="flex-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {candidateItems.map((it) => (
                      <SelectItem key={it.id} value={it.id}>
                        {it.name} ({it.sku})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </SelectRoot>
                <Input
                  className="w-20"
                  type="number"
                  min="0"
                  value={row.quantity}
                  onChange={(e) => updateRow(i, { quantity: e.target.value })}
                />
                <Button variant="ghost" size="icon-sm" onClick={() => removeRow(i)}>
                  <Trash2 className="size-3.5 text-destructive" />
                </Button>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={addRow} disabled={candidateItems.length === 0}>
              <Plus className="size-3.5" />
              Add component
            </Button>
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
            Create kit
          </Button>
        </DialogFooter>
      </DialogContent>
    </DialogRoot>
  );
}
