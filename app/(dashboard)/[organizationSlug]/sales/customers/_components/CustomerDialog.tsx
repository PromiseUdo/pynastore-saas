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
import { createCustomer, updateCustomer, type CustomerRow } from '@/features/sales/actions';

type CustomerDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing?: CustomerRow | null;
};

export function CustomerDialog({ open, onOpenChange, editing }: CustomerDialogProps) {
  const router = useRouter();
  const [name, setName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [address, setAddress] = React.useState('');
  const [taxId, setTaxId] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [isPending, setIsPending] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setName(editing?.name ?? '');
      setEmail(editing?.email ?? '');
      setPhone(editing?.phone ?? '');
      setAddress(editing?.address ?? '');
      setTaxId(editing?.taxId ?? '');
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
    };

    const result = editing ? await updateCustomer(editing.id, payload) : await createCustomer(payload);

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
          <DialogTitle>{editing ? 'Edit customer' : 'New customer'}</DialogTitle>
          <DialogDescription>Keep customer details up to date for quotes and invoices.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="cust-name">Name *</Label>
            <Input id="cust-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="cust-email">Email</Label>
              <Input id="cust-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cust-phone">Phone</Label>
              <Input id="cust-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cust-address">Address</Label>
            <Input id="cust-address" value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cust-tax">Tax ID</Label>
            <Input id="cust-tax" value={taxId} onChange={(e) => setTaxId(e.target.value)} />
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
            {editing ? 'Save changes' : 'Create customer'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </DialogRoot>
  );
}
