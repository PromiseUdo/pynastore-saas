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
import { createSupplier, updateSupplier, type SupplierRow } from '@/features/procurement/actions';

type SupplierDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing?: SupplierRow | null;
};

export function SupplierDialog({ open, onOpenChange, editing }: SupplierDialogProps) {
  const router = useRouter();
  const [name, setName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [address, setAddress] = React.useState('');
  const [taxId, setTaxId] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [isPending, setIsPending] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setName(editing?.name ?? '');
      setEmail(editing?.email ?? '');
      setPhone(editing?.phone ?? '');
      setAddress(editing?.address ?? '');
      setTaxId(editing?.taxId ?? '');
      setNotes(editing?.notes ?? '');
      setError(null);
    }
  }, [open, editing]);

  async function handleSubmit() {
    if (!name.trim()) {
      setError('Name is required.');
      return;
    }
    setIsPending(true);
    setError(null);

    const payload = {
      name: name.trim(),
      email: email.trim() || undefined,
      phone: phone.trim() || undefined,
      address: address.trim() || undefined,
      taxId: taxId.trim() || undefined,
      notes: notes.trim() || undefined,
    };

    const result = editing ? await updateSupplier(editing.id, payload) : await createSupplier(payload);

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
          <DialogTitle>{editing ? 'Edit supplier' : 'New supplier'}</DialogTitle>
          <DialogDescription>Keep supplier details up to date for purchase orders.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="sup-name">Name *</Label>
            <Input id="sup-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="sup-email">Email</Label>
              <Input id="sup-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sup-phone">Phone</Label>
              <Input id="sup-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sup-address">Address</Label>
            <Input id="sup-address" value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sup-tax">Tax ID</Label>
            <Input id="sup-tax" value={taxId} onChange={(e) => setTaxId(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sup-notes">Notes</Label>
            <Textarea id="sup-notes" className="h-16" value={notes} onChange={(e) => setNotes(e.target.value)} />
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
            {editing ? 'Save changes' : 'Create supplier'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </DialogRoot>
  );
}
