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
import {
  SelectRoot,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { PermissionMatrix } from './PermissionMatrix';
import { createRole, type RoleWithDetails } from '@/features/roles/actions';
import type { PermissionKey } from '@/lib/permissions';

type CreateRoleDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  callerPermissions: string[];
  existingRoles: Pick<RoleWithDetails, 'id' | 'name' | 'permissionKeys'>[];
  onSuccess?: (roleId: string) => void;
};

export function CreateRoleDialog({
  open,
  onOpenChange,
  callerPermissions,
  existingRoles,
  onSuccess,
}: CreateRoleDialogProps) {
  const router = useRouter();
  const [step, setStep] = React.useState<1 | 2>(1);
  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [nameError, setNameError] = React.useState<string | null>(null);
  const [submitError, setSubmitError] = React.useState<string | null>(null);
  const [isPending, setIsPending] = React.useState(false);

  function reset() {
    setStep(1);
    setName('');
    setDescription('');
    setSelected(new Set());
    setNameError(null);
    setSubmitError(null);
  }

  React.useEffect(() => {
    if (!open) reset();
  }, [open]);

  function handleNext() {
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      setNameError('Name must be at least 2 characters.');
      return;
    }
    if (trimmed.length > 50) {
      setNameError('Name must be 50 characters or less.');
      return;
    }
    setNameError(null);
    setStep(2);
  }

  function handleCopyFrom(roleId: string) {
    if (roleId === '__scratch__') {
      setSelected(new Set());
      return;
    }
    const source = existingRoles.find((r) => r.id === roleId);
    if (!source) return;
    // Only copy permissions the caller holds
    const filtered = source.permissionKeys.filter((k) => callerPermissions.includes(k));
    setSelected(new Set(filtered));
  }

  async function handleCreate() {
    setIsPending(true);
    setSubmitError(null);

    const result = await createRole({
      name: name.trim(),
      description: description.trim() || undefined,
      permissionKeys: [...selected] as PermissionKey[],
    });

    setIsPending(false);

    if (!result.success) {
      setSubmitError(result.error);
      return;
    }

    router.refresh();
    onOpenChange(false);
    onSuccess?.(result.data.roleId);
  }

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {step === 1 ? 'Create a new role' : `Configure permissions — ${name.trim()}`}
          </DialogTitle>
          <DialogDescription>
            {step === 1
              ? 'Give the role a name and optional description.'
              : 'Choose what members with this role can do.'}
          </DialogDescription>
        </DialogHeader>

        {step === 1 ? (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="role-name">Role name *</Label>
              <Input
                id="role-name"
                placeholder="e.g. Finance Manager"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setNameError(null);
                }}
                aria-invalid={nameError ? true : undefined}
                autoFocus
              />
              {nameError && (
                <p className="text-xs text-destructive">{nameError}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="role-desc">Description</Label>
              <Textarea
                id="role-desc"
                placeholder="Briefly describe what this role is for…"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="h-20"
              />
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Copy from existing role */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground shrink-0">Copy from:</span>
              <SelectRoot defaultValue="__scratch__" onValueChange={handleCopyFrom}>
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__scratch__" className="text-xs">
                    Start from scratch
                  </SelectItem>
                  {existingRoles.map((r) => (
                    <SelectItem key={r.id} value={r.id} className="text-xs">
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </SelectRoot>
            </div>

            {/* Permission matrix — scrollable */}
            <div className="max-h-[420px] overflow-y-auto pr-1">
              <PermissionMatrix
                selected={selected}
                onChange={setSelected}
                callerPermissions={callerPermissions}
                disabled={isPending}
              />
            </div>

            {submitError && (
              <p className="text-xs text-destructive">{submitError}</p>
            )}
          </div>
        )}

        <DialogFooter>
          {step === 1 ? (
            <>
              <DialogClose asChild>
                <Button variant="outline" size="sm">Cancel</Button>
              </DialogClose>
              <Button size="sm" onClick={handleNext}>
                Next
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setStep(1)}
                disabled={isPending}
              >
                Back
              </Button>
              <Button size="sm" onClick={handleCreate} disabled={isPending}>
                {isPending && <Loader2 className="size-3.5 animate-spin" />}
                Create role
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </DialogRoot>
  );
}
