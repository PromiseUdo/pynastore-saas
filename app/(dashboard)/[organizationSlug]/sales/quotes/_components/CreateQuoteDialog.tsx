'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Plus, Trash2 } from 'lucide-react';
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
import { createQuote } from '@/features/sales/actions';
import type { CustomerRow } from '@/features/sales/actions';
import type { ItemListRow } from '@/features/inventory/actions';

type LineItemRow = { inventoryItemId: string; description: string; quantity: string; unitPrice: string };

type CreateQuoteDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customers: CustomerRow[];
  items: ItemListRow[];
};

export function CreateQuoteDialog({ open, onOpenChange, customers, items }: CreateQuoteDialogProps) {
  const router = useRouter();
  const [customerId, setCustomerId] = React.useState<string | undefined>(customers[0]?.id);
  const [validUntil, setValidUntil] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [taxAmount, setTaxAmount] = React.useState('');
  const [rows, setRows] = React.useState<LineItemRow[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [isPending, setIsPending] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setCustomerId(customers[0]?.id);
      setValidUntil('');
      setNotes('');
      setTaxAmount('');
      setRows([]);
      setError(null);
    }
  }, [open, customers]);

  function addRow() {
    const first = items[0];
    setRows((prev) => [
      ...prev,
      {
        inventoryItemId: first?.id ?? '',
        description: first ? `${first.name} (${first.sku})` : '',
        quantity: '1',
        unitPrice: first?.sellingPrice ? String(first.sellingPrice) : '0',
      },
    ]);
  }

  function updateRow(index: number, patch: Partial<LineItemRow>) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  function selectItem(index: number, itemId: string) {
    const item = items.find((i) => i.id === itemId);
    updateRow(index, {
      inventoryItemId: itemId,
      description: item ? `${item.name} (${item.sku})` : '',
      unitPrice: item?.sellingPrice ? String(item.sellingPrice) : '0',
    });
  }

  function removeRow(index: number) {
    setRows((prev) => prev.filter((_, i) => i !== index));
  }

  const subtotal = rows.reduce((sum, r) => sum + (Number(r.quantity) || 0) * (Number(r.unitPrice) || 0), 0);

  async function handleSubmit() {
    if (!customerId) {
      setError('Select a customer.');
      return;
    }
    if (rows.length === 0) {
      setError('Add at least one line item.');
      return;
    }
    if (rows.some((r) => !r.description.trim() || !r.quantity || Number(r.quantity) <= 0)) {
      setError('Every line item needs a description and a positive quantity.');
      return;
    }

    setIsPending(true);
    setError(null);

    const result = await createQuote({
      customerId,
      currency: 'USD',
      notes: notes.trim() || undefined,
      validUntil: validUntil ? new Date(validUntil) : undefined,
      taxAmount: taxAmount ? Number(taxAmount) : undefined,
      lineItems: rows.map((r) => ({
        inventoryItemId: r.inventoryItemId || undefined,
        description: r.description.trim(),
        quantity: Number(r.quantity),
        unitPrice: Number(r.unitPrice) || 0,
      })),
    });

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
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>New quote</DialogTitle>
          <DialogDescription>Draft a quote to send to a customer.</DialogDescription>
        </DialogHeader>

        <div className="max-h-[65vh] space-y-4 overflow-y-auto pr-1">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Customer *</Label>
              <SelectRoot value={customerId} onValueChange={setCustomerId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {customers.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </SelectRoot>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="quote-valid">Valid until</Label>
              <Input id="quote-valid" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Line items *</Label>
            {rows.map((row, i) => (
              <div key={i} className="flex items-center gap-2">
                <SelectRoot value={row.inventoryItemId || undefined} onValueChange={(v) => selectItem(i, v)}>
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="Item" />
                  </SelectTrigger>
                  <SelectContent>
                    {items.map((it) => (
                      <SelectItem key={it.id} value={it.id}>
                        {it.name} ({it.sku})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </SelectRoot>
                <Input
                  className="w-16"
                  type="number"
                  min="0"
                  placeholder="Qty"
                  value={row.quantity}
                  onChange={(e) => updateRow(i, { quantity: e.target.value })}
                />
                <Input
                  className="w-24"
                  type="number"
                  min="0"
                  placeholder="Unit price"
                  value={row.unitPrice}
                  onChange={(e) => updateRow(i, { unitPrice: e.target.value })}
                />
                <Button variant="ghost" size="icon-sm" onClick={() => removeRow(i)}>
                  <Trash2 className="size-3.5 text-destructive" />
                </Button>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={addRow} disabled={items.length === 0}>
              <Plus className="size-3.5" />
              Add line item
            </Button>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="quote-tax">Tax amount</Label>
              <Input id="quote-tax" type="number" min="0" value={taxAmount} onChange={(e) => setTaxAmount(e.target.value)} />
            </div>
            <div className="flex items-end justify-end text-sm text-muted-foreground">
              Subtotal: {subtotal.toFixed(2)}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="quote-notes">Notes</Label>
            <Textarea id="quote-notes" className="h-16" value={notes} onChange={(e) => setNotes(e.target.value)} />
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
            Create draft
          </Button>
        </DialogFooter>
      </DialogContent>
    </DialogRoot>
  );
}
