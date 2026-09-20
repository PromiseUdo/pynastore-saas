'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import { createInvoice } from '@/features/sales/actions';
import type { CustomerRow } from '@/features/sales/actions';
import type { ItemListRow, WarehouseRow } from '@/features/inventory/actions';

type LineItemRow = {
  inventoryItemId: string;
  description: string;
  quantity: string;
  unitPrice: string;
  isDropShip: boolean;
};

type CreateInvoiceDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customers: CustomerRow[];
  warehouses: WarehouseRow[];
  items: ItemListRow[];
};

export function CreateInvoiceDialog({ open, onOpenChange, customers, warehouses, items }: CreateInvoiceDialogProps) {
  const router = useRouter();
  const [customerId, setCustomerId] = React.useState<string | undefined>(customers[0]?.id);
  const [warehouseId, setWarehouseId] = React.useState<string | undefined>(warehouses[0]?.id);
  const [dueDate, setDueDate] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [taxAmount, setTaxAmount] = React.useState('');
  const [rows, setRows] = React.useState<LineItemRow[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [isPending, setIsPending] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setCustomerId(customers[0]?.id);
      setWarehouseId(warehouses[0]?.id);
      setDueDate('');
      setNotes('');
      setTaxAmount('');
      setRows([]);
      setError(null);
    }
  }, [open, customers, warehouses]);

  function addRow() {
    const first = items[0];
    setRows((prev) => [
      ...prev,
      {
        inventoryItemId: first?.id ?? '',
        description: first ? `${first.name} (${first.sku})` : '',
        quantity: '1',
        unitPrice: first?.sellingPrice ? String(first.sellingPrice) : '0',
        isDropShip: false,
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
      isDropShip: false,
    });
  }

  function removeRow(index: number) {
    setRows((prev) => prev.filter((_, i) => i !== index));
  }

  const subtotal = rows.reduce((sum, r) => sum + (Number(r.quantity) || 0) * (Number(r.unitPrice) || 0), 0);

  async function handleSubmit() {
    if (!customerId || !warehouseId) {
      setError('Select a customer and a fulfillment store.');
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

    const result = await createInvoice({
      customerId,
      warehouseId,
      currency: 'USD',
      notes: notes.trim() || undefined,
      dueDate: dueDate ? new Date(dueDate) : undefined,
      taxAmount: taxAmount ? Number(taxAmount) : undefined,
      lineItems: rows.map((r) => ({
        inventoryItemId: r.inventoryItemId || undefined,
        description: r.description.trim(),
        quantity: Number(r.quantity),
        unitPrice: Number(r.unitPrice) || 0,
        isDropShip: r.isDropShip,
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
          <DialogTitle>New invoice</DialogTitle>
          <DialogDescription>Bill a customer directly, without going through a quote.</DialogDescription>
        </DialogHeader>

        <div className="max-h-[65vh] space-y-4 overflow-y-auto pr-1">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
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
              <Label>Fulfillment store *</Label>
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
            <div className="space-y-1.5">
              <Label htmlFor="inv-due">Due date</Label>
              <Input id="inv-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Line items *</Label>
            {rows.map((row, i) => {
              const selectedItem = items.find((it) => it.id === row.inventoryItemId);
              const canDropShip = !!selectedItem?.preferredSupplierId;
              return (
                <div key={i} className="space-y-1">
                  <div className="flex items-center gap-2">
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
                  <label className="flex items-center gap-1.5 pl-1 text-xs text-muted-foreground">
                    <CheckboxRoot
                      checked={row.isDropShip}
                      disabled={!canDropShip}
                      onCheckedChange={(v) => updateRow(i, { isDropShip: v === true })}
                    />
                    {canDropShip ? 'Drop-ship from preferred supplier' : 'Drop-ship (set a preferred supplier on this item first)'}
                  </label>
                </div>
              );
            })}
            <Button variant="outline" size="sm" onClick={addRow} disabled={items.length === 0}>
              <Plus className="size-3.5" />
              Add line item
            </Button>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="inv-tax">Tax amount</Label>
              <Input id="inv-tax" type="number" min="0" value={taxAmount} onChange={(e) => setTaxAmount(e.target.value)} />
            </div>
            <div className="flex items-end justify-end text-sm text-muted-foreground">
              Subtotal: {subtotal.toFixed(2)}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="inv-notes">Notes</Label>
            <Textarea id="inv-notes" className="h-16" value={notes} onChange={(e) => setNotes(e.target.value)} />
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
