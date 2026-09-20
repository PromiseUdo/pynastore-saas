'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
import { rejectPurchaseOrder } from '@/features/procurement/actions';

type RejectPODialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  poId: string;
};

export function RejectPODialog({ open, onOpenChange, poId }: RejectPODialogProps) {
  const router = useRouter();
  const [reason, setReason] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [isPending, setIsPending] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setReason('');
      setError(null);
    }
  }, [open]);

  async function handleSubmit() {
    setIsPending(true);
    setError(null);
    const result = await rejectPurchaseOrder(poId, reason.trim());
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
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Reject purchase order</DialogTitle>
          <DialogDescription>Explain why this order is being rejected.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="reject-reason">Reason</Label>
          <Textarea id="reject-reason" className="h-20" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" size="sm">
              Cancel
            </Button>
          </DialogClose>
          <Button variant="destructive" size="sm" onClick={handleSubmit} disabled={isPending}>
            {isPending && <Loader2 className="size-3.5 animate-spin" />}
            Reject
          </Button>
        </DialogFooter>
      </DialogContent>
    </DialogRoot>
  );
}
