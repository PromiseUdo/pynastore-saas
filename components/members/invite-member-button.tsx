'use client';

import { Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { InviteMemberDialog } from './invite-member-dialog';

type Role = { id: string; name: string };

type InviteMemberButtonProps = {
  roles: Role[];
  onSuccess?: () => void;
};

export function InviteMemberButton({ roles, onSuccess }: InviteMemberButtonProps) {
  return (
    <InviteMemberDialog roles={roles} onSuccess={onSuccess}>
      <Button size="sm">
        <Users className="size-3.5" />
        Invite member
      </Button>
    </InviteMemberDialog>
  );
}
