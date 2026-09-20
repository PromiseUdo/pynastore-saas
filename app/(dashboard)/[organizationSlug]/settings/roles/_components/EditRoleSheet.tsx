'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  SheetRoot,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
  SheetClose,
} from '@/components/ui/sheet';
import { PermissionMatrix } from './PermissionMatrix';
import { updateRole, type RoleWithDetails } from '@/features/roles/actions';

type EditRoleSheetProps = {
  role: RoleWithDetails;
  callerPermissions: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
};

export function EditRoleSheet({
  role,
  callerPermissions,
  open,
  onOpenChange,
  onSuccess,
}: EditRoleSheetProps) {
  const router = useRouter();
  const [selected, setSelected] = React.useState<Set<string>>(
    new Set(role.permissionKeys),
  );
  const [isPending, setIsPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Reset when role changes or sheet opens
  React.useEffect(() => {
    setSelected(new Set(role.permissionKeys));
    setError(null);
  }, [role.id, role.permissionKeys, open]);

  async function handleSave() {
    setIsPending(true);
    setError(null);

    // Optimistic: close and refresh — if it fails, reopen with error
    const result = await updateRole({
      roleId: role.id,
      permissionKeys: [...selected] as Parameters<typeof updateRole>[0]['permissionKeys'],
    });

    setIsPending(false);

    if (!result.success) {
      setError(result.error);
      return;
    }

    router.refresh();
    onOpenChange(false);
    onSuccess?.();
  }

  const isDirty =
    selected.size !== role.permissionKeys.length ||
    [...selected].some((k) => !role.permissionKeys.includes(k));

  return (
    <SheetRoot open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right">
        <SheetHeader>
          <div className="flex items-center gap-2 pr-8">
            <SheetTitle>{role.name}</SheetTitle>
            {role.isSystem && (
              <Badge variant="secondary" className="text-xs">System</Badge>
            )}
          </div>
          <SheetDescription>
            {role.description ?? 'Edit the permissions for this role.'}
          </SheetDescription>
        </SheetHeader>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {role.isSystem && (
            <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800/40 dark:bg-amber-950/30 dark:text-amber-400">
              Changes to system roles affect all members currently assigned to{' '}
              <strong>{role.name}</strong>.
            </div>
          )}

          <PermissionMatrix
            selected={selected}
            onChange={setSelected}
            callerPermissions={callerPermissions}
            disabled={isPending}
          />
        </div>

        {/* Sticky footer */}
        <SheetFooter>
          <div className="flex w-full flex-col gap-2">
            {error && (
              <p className="text-xs text-destructive">{error}</p>
            )}
            <div className="flex items-center justify-end gap-2">
              <SheetClose asChild>
                <Button variant="outline" size="sm" disabled={isPending}>
                  Cancel
                </Button>
              </SheetClose>
              <Button
                size="sm"
                disabled={isPending || !isDirty}
                onClick={handleSave}
              >
                {isPending && <Loader2 className="size-3.5 animate-spin" />}
                Save changes
              </Button>
            </div>
          </div>
        </SheetFooter>
      </SheetContent>
    </SheetRoot>
  );
}
