'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialogRoot,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { AlertDialog } from 'radix-ui';
import { deleteRole, type RoleWithDetails } from '@/features/roles/actions';

type DeleteRoleDialogProps = {
  role: Pick<RoleWithDetails, 'id' | 'name' | 'memberCount' | 'isSystem'>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationSlug: string;
  onSuccess?: () => void;
};

export function DeleteRoleDialog({
  role,
  open,
  onOpenChange,
  organizationSlug,
  onSuccess,
}: DeleteRoleDialogProps) {
  const router = useRouter();
  const [isPending, setIsPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleDelete() {
    setIsPending(true);
    setError(null);

    const result = await deleteRole(role.id);
    setIsPending(false);

    if (!result.success) {
      setError(result.error);
      return;
    }

    router.refresh();
    onOpenChange(false);
    onSuccess?.();
  }

  const hasMembers = role.memberCount > 0;

  return (
    <AlertDialogRoot open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        {hasMembers ? (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>Cannot delete &quot;{role.name}&quot;</AlertDialogTitle>
              <AlertDialogDescription>
                This role is assigned to{' '}
                <strong>
                  {role.memberCount} member{role.memberCount !== 1 ? 's' : ''}
                </strong>
                . Reassign them to a different role before deleting.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="mt-2">
              <a
                href="/settings/members"
                className="text-sm text-primary underline-offset-4 hover:underline"
              >
                Go to Members settings →
              </a>
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel>Close</AlertDialogCancel>
            </AlertDialogFooter>
          </>
        ) : (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete &quot;{role.name}&quot;?</AlertDialogTitle>
              <AlertDialogDescription>
                This action cannot be undone. The role and all its permission
                assignments will be permanently removed.
              </AlertDialogDescription>
            </AlertDialogHeader>

            {error && (
              <p className="mt-2 text-xs text-destructive">{error}</p>
            )}

            <AlertDialogFooter>
              <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
              <AlertDialog.Action asChild>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={isPending}
                  onClick={handleDelete}
                >
                  {isPending && <Loader2 className="size-3.5 animate-spin" />}
                  Delete role
                </Button>
              </AlertDialog.Action>
            </AlertDialogFooter>
          </>
        )}
      </AlertDialogContent>
    </AlertDialogRoot>
  );
}
