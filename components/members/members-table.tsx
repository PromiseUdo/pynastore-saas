'use client';

import * as React from 'react';
import { useTransition, useOptimistic } from 'react';
import { useRouter } from 'next/navigation';
import {
  Table,
  TableWrapper,
  TableHead,
  TableBody,
  TableRow,
  TableColumnHeader,
  TableCell,
  TableEmpty,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  SelectRoot,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import {
  AlertDialogRoot,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import Link from 'next/link';
import { History, Loader2, Store } from 'lucide-react';
import { formatDate } from '@/lib/format';
import { updateMemberRole, removeMember } from '@/features/members/actions';
import { MemberStoresDialog, type StoreOption } from './member-stores-dialog';

export type MemberRow = {
  id: string;
  user: {
    id: string;
    name: string | null;
    email: string;
    image: string | null;
  };
  role: { id: string; name: string; isSystem?: boolean };
  joinedAt: Date;
  /**
   * Stores this member may change stock in. EMPTY MEANS EVERY STORE
   * (ROADMAP Phase 8.6), which is what the column shows.
   */
  storeIds: string[];
  storeNames: string[];
};

type Role = { id: string; name: string };

type MembersTableProps = {
  members: MemberRow[];
  roles: Role[];
  /** Every store in the workspace, for the "which stores" dialog. */
  stores: StoreOption[];
  currentUserId: string;
  canManage: boolean;
  /** `settings.view` — whether this viewer can open Settings → Activity. */
  canViewActivity?: boolean;
};

export function MembersTable({
  members,
  roles,
  stores,
  currentUserId,
  canManage,
  canViewActivity = false,
}: MembersTableProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  /* Removing someone's access is irreversible for them — it goes through a
   * confirmation that says what will happen (AGENTS §4). */
  const [removing, setRemoving] = React.useState<MemberRow | null>(null);
  /* Which stores someone may work in — a separate question from their role,
     so it gets its own dialog rather than another column of selects. */
  const [editingStores, setEditingStores] = React.useState<MemberRow | null>(null);

  function setError(id: string, msg: string) {
    setErrors((prev) => ({ ...prev, [id]: msg }));
  }

  function clearError(id: string) {
    setErrors((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  function handleRoleChange(membershipId: string, roleId: string) {
    clearError(membershipId);
    startTransition(async () => {
      const result = await updateMemberRole({ membershipId, roleId });
      if (!result.success) {
        setError(membershipId, result.error);
      } else {
        router.refresh();
      }
    });
  }

  function handleRemove() {
    const member = removing;
    if (!member) return;
    clearError(member.id);
    startTransition(async () => {
      const result = await removeMember({ membershipId: member.id });
      if (!result.success) {
        setError(member.id, result.error);
      } else {
        router.refresh();
      }
      setRemoving(null);
    });
  }

  const showActions = canManage || canViewActivity;
  const columnCount = showActions ? 6 : 5;

  return (
    <>
    <TableWrapper>
      <Table>
        <TableHead>
          <TableRow>
            <TableColumnHeader>Name</TableColumnHeader>
            <TableColumnHeader>Email</TableColumnHeader>
            <TableColumnHeader>Role</TableColumnHeader>
            <TableColumnHeader>Stores</TableColumnHeader>
            <TableColumnHeader>Joined</TableColumnHeader>
            {showActions && <TableColumnHeader align="right">Actions</TableColumnHeader>}
          </TableRow>
        </TableHead>
        <TableBody>
          {members.length === 0 ? (
            <TableEmpty
              colSpan={columnCount}
              title="No members yet"
              description="Invite team members to get started."
            />
          ) : (
            members.map((m) => (
              <React.Fragment key={m.id}>
                <TableRow>
                  <TableCell>
                    <div className="flex items-center gap-2.5">
                      <Avatar name={m.user.name ?? m.user.email} image={m.user.image} />
                      <span className="font-medium text-foreground">
                        {m.user.name ?? '—'}
                        {m.user.id === currentUserId && (
                          <Badge variant="secondary" className="ml-2 text-[10px]">You</Badge>
                        )}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell muted>{m.user.email}</TableCell>
                  <TableCell>
                    {canManage && m.user.id !== currentUserId ? (
                      <SelectRoot
                        defaultValue={m.role.id}
                        onValueChange={(v) => handleRoleChange(m.id, v)}
                        disabled={isPending}
                      >
                        <SelectTrigger className="h-7 w-40 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {roles.map((r) => (
                            <SelectItem key={r.id} value={r.id} className="text-xs">
                              {r.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </SelectRoot>
                    ) : (
                      <Badge variant="secondary">{m.role.name}</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-xs">
                    {m.storeIds.length === 0 ? (
                      <span className="text-muted-foreground">All stores</span>
                    ) : (
                      <span className="text-foreground" title={m.storeNames.join(', ')}>
                        {m.storeNames.length <= 2 ? m.storeNames.join(', ') : `${m.storeNames.length} stores`}
                      </span>
                    )}
                  </TableCell>
                  <TableCell muted className="text-xs">
                    {formatDate(m.joinedAt)}
                  </TableCell>
                  {showActions && (
                    <TableCell align="right">
                      <div className="flex items-center justify-end gap-1">
                        {canViewActivity && (
                          <Button variant="ghost" size="xs" className="text-muted-foreground" asChild>
                            <Link href={`/settings/activity?member=${m.user.id}`}>
                              <History className="size-3.5" />
                              Activity
                            </Link>
                          </Button>
                        )}
                        {canManage && (
                          <Button
                            variant="ghost"
                            size="xs"
                            className="text-muted-foreground"
                            disabled={isPending}
                            onClick={() => setEditingStores(m)}
                          >
                            <Store className="size-3.5" />
                            Stores
                          </Button>
                        )}
                        {canManage && m.user.id !== currentUserId && (
                          <Button
                            variant="ghost"
                            size="xs"
                            className="text-muted-foreground hover:text-destructive"
                            disabled={isPending}
                            onClick={() => setRemoving(m)}
                          >
                            Remove
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  )}
                </TableRow>
                {errors[m.id] && (
                  <TableRow>
                    <TableCell colSpan={columnCount} className="py-1 pt-0">
                      <p className="text-xs text-destructive">{errors[m.id]}</p>
                    </TableCell>
                  </TableRow>
                )}
              </React.Fragment>
            ))
          )}
        </TableBody>
      </Table>
    </TableWrapper>

      <AlertDialogRoot open={removing !== null} onOpenChange={(next) => !next && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {removing?.user.name ?? removing?.user.email}?</AlertDialogTitle>
            <AlertDialogDescription>
              They’ll lose access to this workspace straight away and won’t be able to sign in to it.
              What they’ve already done stays in the activity log. You can invite them again later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep member</AlertDialogCancel>
            <Button variant="destructive" onClick={handleRemove} disabled={isPending}>
              {isPending && <Loader2 className="size-3.5 animate-spin" />}
              Remove member
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialogRoot>

      <MemberStoresDialog
        open={editingStores !== null}
        onOpenChange={(next) => !next && setEditingStores(null)}
        member={
          editingStores
            ? {
                id: editingStores.id,
                name: editingStores.user.name ?? editingStores.user.email,
                storeIds: editingStores.storeIds,
                isOwner: Boolean(editingStores.role.isSystem) && editingStores.role.name === 'Owner',
              }
            : null
        }
        stores={stores}
      />
    </>
  );
}

function Avatar({ name, image }: { name: string; image: string | null }) {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');

  if (image) {
    return (
      <img
        src={image}
        alt={name}
        className="size-7 rounded-full object-cover"
        referrerPolicy="no-referrer"
      />
    );
  }

  return (
    <div className="flex size-7 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
      {initials}
    </div>
  );
}
