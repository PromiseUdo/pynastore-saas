'use client';

import * as React from 'react';
import { useTransition } from 'react';
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
import { revokeInvitation, resendInvitation } from '@/features/invitations/actions';

export type InvitationRow = {
  id: string;
  email: string;
  role: { id: string; name: string };
  createdAt: Date;
  expiresAt: Date;
  status: 'PENDING' | 'ACCEPTED' | 'EXPIRED' | 'REVOKED';
};

type InvitationsTableProps = {
  invitations: InvitationRow[];
  canManage: boolean;
};

export function InvitationsTable({ invitations, canManage }: InvitationsTableProps) {
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

  function handleRevoke(invitationId: string) {
    clearError(invitationId);
    startTransition(async () => {
      const result = await revokeInvitation(invitationId);
      if (!result.success) {
        setError(invitationId, result.error);
      } else {
        router.refresh();
      }
    });
  }

  function handleResend(invitationId: string) {
    clearError(invitationId);
    startTransition(async () => {
      const result = await resendInvitation(invitationId);
      if (!result.success) {
        setError(invitationId, result.error);
      }
    });
  }

  return (
    <TableWrapper>
      <Table>
        <TableHead>
          <TableRow>
            <TableColumnHeader>Email</TableColumnHeader>
            <TableColumnHeader>Role</TableColumnHeader>
            <TableColumnHeader>Invited</TableColumnHeader>
            <TableColumnHeader>Expires</TableColumnHeader>
            <TableColumnHeader>Status</TableColumnHeader>
            {canManage && <TableColumnHeader align="right">Actions</TableColumnHeader>}
          </TableRow>
        </TableHead>
        <TableBody>
          {invitations.length === 0 ? (
            <TableEmpty
              colSpan={canManage ? 6 : 5}
              title="No pending invitations"
              description="Invited members will appear here until they accept."
            />
          ) : (
            invitations.map((inv) => {
              const isExpired = inv.expiresAt < new Date() && inv.status === 'PENDING';
              const effectiveStatus = isExpired ? 'EXPIRED' : inv.status;

              return (
                <React.Fragment key={inv.id}>
                  <TableRow>
                    <TableCell className="font-medium">{inv.email}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{inv.role.name}</Badge>
                    </TableCell>
                    <TableCell muted className="text-xs">
                      {new Date(inv.createdAt).toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                      })}
                    </TableCell>
                    <TableCell muted className="text-xs">
                      {new Date(inv.expiresAt).toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                      })}
                    </TableCell>
                    <TableCell>
                      <InvitationStatusBadge status={effectiveStatus} />
                    </TableCell>
                    {canManage && (
                      <TableCell align="right">
                        <div className="flex items-center justify-end gap-1">
                          {effectiveStatus === 'PENDING' && (
                            <>
                              <Button
                                variant="ghost"
                                size="xs"
                                disabled={isPending}
                                onClick={() => handleResend(inv.id)}
                                className="text-muted-foreground hover:text-foreground"
                              >
                                Resend
                              </Button>
                              <Button
                                variant="ghost"
                                size="xs"
                                disabled={isPending}
                                onClick={() => handleRevoke(inv.id)}
                                className="text-muted-foreground hover:text-destructive"
                              >
                                Revoke
                              </Button>
                            </>
                          )}
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                  {errors[inv.id] && (
                    <TableRow>
                      <TableCell colSpan={canManage ? 6 : 5} className="py-1 pt-0">
                        <p className="text-xs text-destructive">{errors[inv.id]}</p>
                      </TableCell>
                    </TableRow>
                  )}
                </React.Fragment>
              );
            })
          )}
        </TableBody>
      </Table>
    </TableWrapper>
  );
}

function InvitationStatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'PENDING':
      return <Badge variant="pending" dot>Pending</Badge>;
    case 'ACCEPTED':
      return <Badge variant="approved" dot>Accepted</Badge>;
    case 'EXPIRED':
      return <Badge variant="warning" dot>Expired</Badge>;
    case 'REVOKED':
      return <Badge variant="muted" dot>Revoked</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}
