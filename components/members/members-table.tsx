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
import { History, Loader2 } from 'lucide-react';
import { formatDate } from '@/lib/format';
import { updateMemberRole, removeMember } from '@/features/members/actions';

export type MemberRow = {
  id: string;
  user: {
    id: string;
    name: string | null;
    email: string;
    image: string | null;
  };
  role: { id: string; name: string };
  joinedAt: Date;
};

type Role = { id: string; name: string };

type MembersTableProps = {
  members: MemberRow[];
  roles: Role[];
  currentUserId: string;
  canManage: boolean;
  /** `settings.view` — whether this viewer can open Settings → Activity. */
  canViewActivity?: boolean;
};

export function MembersTable({
  members,
  roles,
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
  const columnCount = showActions ? 5 : 4;

  return (
    <>
    <TableWrapper>
      <Table>
        <TableHead>
          <TableRow>
            <TableColumnHeader>Name</TableColumnHeader>
            <TableColumnHeader>Email</TableColumnHeader>
            <TableColumnHeader>Role</TableColumnHeader>
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
