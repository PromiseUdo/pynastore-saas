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
};

export function MembersTable({ members, roles, currentUserId, canManage }: MembersTableProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [errors, setErrors] = React.useState<Record<string, string>>({});

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

  function handleRemove(membershipId: string) {
    clearError(membershipId);
    startTransition(async () => {
      const result = await removeMember({ membershipId });
      if (!result.success) {
        setError(membershipId, result.error);
      } else {
        router.refresh();
      }
    });
  }

  return (
    <TableWrapper>
      <Table>
        <TableHead>
          <TableRow>
            <TableColumnHeader>Name</TableColumnHeader>
            <TableColumnHeader>Email</TableColumnHeader>
            <TableColumnHeader>Role</TableColumnHeader>
            <TableColumnHeader>Joined</TableColumnHeader>
            {canManage && <TableColumnHeader align="right">Actions</TableColumnHeader>}
          </TableRow>
        </TableHead>
        <TableBody>
          {members.length === 0 ? (
            <TableEmpty
              colSpan={canManage ? 5 : 4}
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
                    {new Date(m.joinedAt).toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                    })}
                  </TableCell>
                  {canManage && (
                    <TableCell align="right">
                      {m.user.id !== currentUserId && (
                        <Button
                          variant="ghost"
                          size="xs"
                          className="text-muted-foreground hover:text-destructive"
                          disabled={isPending}
                          onClick={() => handleRemove(m.id)}
                        >
                          Remove
                        </Button>
                      )}
                    </TableCell>
                  )}
                </TableRow>
                {errors[m.id] && (
                  <TableRow>
                    <TableCell colSpan={canManage ? 5 : 4} className="py-1 pt-0">
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
