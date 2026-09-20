'use client';

import * as React from 'react';
import { Lock, MoreHorizontal, Pencil } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenuRoot,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  TooltipProvider,
  TooltipRoot,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip';
import { useRouter } from 'next/navigation';
import { updateRole, type RoleWithDetails } from '@/features/roles/actions';
import { EditRoleSheet } from './EditRoleSheet';
import { DeleteRoleDialog } from './DeleteRoleDialog';
import { DuplicateRoleDialog } from './DuplicateRoleDialog';

type RoleCardProps = {
  role: RoleWithDetails;
  callerPermissions: string[];
  organizationSlug: string;
};

export function RoleCard({ role, callerPermissions, organizationSlug }: RoleCardProps) {
  const router = useRouter();

  const [editOpen, setEditOpen] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [duplicateOpen, setDuplicateOpen] = React.useState(false);
  const [renaming, setRenaming] = React.useState(false);
  const [renameValue, setRenameValue] = React.useState(role.name);
  const [renameError, setRenameError] = React.useState<string | null>(null);
  const [isPending, setIsPending] = React.useState(false);

  // Derived: module list from permission keys
  const modules = [...new Set(role.permissionKeys.map((k) => k.split('.')[0]))];
  const moduleDisplay = modules.slice(0, 3).join(', ') + (modules.length > 3 ? `, +${modules.length - 3}` : '');

  const canDelete = !role.isSystem && role.memberCount === 0;
  const deleteDisabledReason = role.isSystem
    ? 'System roles cannot be deleted'
    : role.memberCount > 0
    ? `Reassign ${role.memberCount} member${role.memberCount !== 1 ? 's' : ''} first`
    : undefined;

  async function handleRenameCommit() {
    const trimmed = renameValue.trim();
    if (trimmed === role.name) {
      setRenaming(false);
      return;
    }
    if (trimmed.length < 2) {
      setRenameError('At least 2 characters required.');
      return;
    }
    setIsPending(true);
    setRenameError(null);

    const result = await updateRole({ roleId: role.id, name: trimmed });
    setIsPending(false);

    if (!result.success) {
      setRenameError(result.error);
      return;
    }

    router.refresh();
    setRenaming(false);
  }

  function handleRenameKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') handleRenameCommit();
    if (e.key === 'Escape') {
      setRenameValue(role.name);
      setRenaming(false);
      setRenameError(null);
    }
  }

  return (
    <>
      <Card size="sm">
        <CardContent className="flex items-start justify-between gap-4 py-1">
          {/* Left */}
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              {renaming ? (
                <div className="flex items-center gap-2">
                  <Input
                    className="h-6 w-48 text-sm"
                    value={renameValue}
                    onChange={(e) => {
                      setRenameValue(e.target.value);
                      setRenameError(null);
                    }}
                    onBlur={handleRenameCommit}
                    onKeyDown={handleRenameKeyDown}
                    disabled={isPending}
                    autoFocus
                  />
                  {renameError && (
                    <span className="text-xs text-destructive">{renameError}</span>
                  )}
                </div>
              ) : (
                <span className="font-medium text-foreground leading-none">
                  {role.name}
                </span>
              )}
              {role.isSystem && (
                <Badge variant="secondary" className="gap-1 text-[10px]">
                  <Lock className="size-2.5" />
                  System
                </Badge>
              )}
              <Badge variant="muted" className="text-[10px]">
                {role.memberCount} member{role.memberCount !== 1 ? 's' : ''}
              </Badge>
            </div>

            {role.description && (
              <p className="text-xs text-muted-foreground line-clamp-1">
                {role.description}
              </p>
            )}
          </div>

          {/* Right */}
          <div className="flex shrink-0 items-center gap-3">
            <Badge variant="outline" className="hidden text-[10px] sm:flex">
              {role.permissionKeys.length} permission{role.permissionKeys.length !== 1 ? 's' : ''}
              {moduleDisplay ? ` · ${moduleDisplay}` : ''}
            </Badge>

            <TooltipProvider delayDuration={300}>
              <DropdownMenuRoot>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" aria-label="Role actions">
                    <MoreHorizontal className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  <DropdownMenuItem onSelect={() => setTimeout(() => setEditOpen(true), 0)}>
                    Edit permissions
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setTimeout(() => setDuplicateOpen(true), 0)}>
                    Duplicate
                  </DropdownMenuItem>
                  {!role.isSystem && (
                    <DropdownMenuItem
                      onSelect={() => {
                        setRenameValue(role.name);
                        setRenaming(true);
                      }}
                    >
                      <Pencil className="size-3.5" />
                      Rename
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  {canDelete ? (
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onSelect={() => setTimeout(() => setDeleteOpen(true), 0)}
                    >
                      Delete
                    </DropdownMenuItem>
                  ) : (
                    <TooltipRoot>
                      <TooltipTrigger asChild>
                        <DropdownMenuItem disabled>Delete</DropdownMenuItem>
                      </TooltipTrigger>
                      <TooltipContent side="left">{deleteDisabledReason}</TooltipContent>
                    </TooltipRoot>
                  )}
                </DropdownMenuContent>
              </DropdownMenuRoot>
            </TooltipProvider>
          </div>
        </CardContent>
      </Card>

      <EditRoleSheet
        role={role}
        callerPermissions={callerPermissions}
        open={editOpen}
        onOpenChange={setEditOpen}
      />

      <DeleteRoleDialog
        role={role}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        organizationSlug={organizationSlug}
      />

      <DuplicateRoleDialog
        role={role}
        open={duplicateOpen}
        onOpenChange={setDuplicateOpen}
      />
    </>
  );
}
