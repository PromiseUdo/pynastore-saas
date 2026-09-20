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
import { duplicateRole, type RoleWithDetails } from '@/features/roles/actions';

type DuplicateRoleDialogProps = {
  role: Pick<RoleWithDetails, 'id' | 'name'>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: (newRoleId: string) => void;
};

export function DuplicateRoleDialog({
  role,
  open,
  onOpenChange,
  onSuccess,
}: DuplicateRoleDialogProps) {
  const router = useRouter();
  const [newName, setNewName] = React.useState('');
  const [isPending, setIsPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setNewName(`Copy of ${role.name}`);
      setError(null);
    }
  }, [open, role.name]);

  async function handleConfirm() {
    const trimmed = newName.trim();
    if (trimmed.length < 2) {
      setError('Name must be at least 2 characters.');
      return;
    }

    setIsPending(true);
    setError(null);

    const result = await duplicateRole(role.id, trimmed);
    setIsPending(false);

    if (!result.success) {
      setError(result.error);
      return;
    }

    router.refresh();
    onOpenChange(false);
    onSuccess?.(result.data.roleId);
  }

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Duplicate &quot;{role.name}&quot;</DialogTitle>
          <DialogDescription>
            A new custom role will be created with the same permissions.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="dup-name">New role name</Label>
          <Input
            id="dup-name"
            value={newName}
            onChange={(e) => {
              setNewName(e.target.value);
              setError(null);
            }}
            aria-invalid={error ? true : undefined}
            autoFocus
            onKeyDown={(e) => e.key === 'Enter' && !isPending && handleConfirm()}
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" size="sm" disabled={isPending}>
              Cancel
            </Button>
          </DialogClose>
          <Button size="sm" onClick={handleConfirm} disabled={isPending}>
            {isPending && <Loader2 className="size-3.5 animate-spin" />}
            Create role
          </Button>
        </DialogFooter>
      </DialogContent>
    </DialogRoot>
  );
}
