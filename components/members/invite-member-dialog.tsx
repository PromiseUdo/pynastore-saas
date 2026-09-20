'use client';

import * as React from 'react';
import { useTransition } from 'react';
import {
  DialogRoot,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  SelectRoot,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { sendInvitation } from '@/features/invitations/actions';

type Role = { id: string; name: string };

type InviteMemberDialogProps = {
  roles: Role[];
  children: React.ReactNode; // trigger
  onSuccess?: () => void;
};

export function InviteMemberDialog({
  roles,
  children,
  onSuccess,
}: InviteMemberDialogProps) {
  const [open, setOpen] = React.useState(false);
  const [isPending, startTransition] = useTransition();
  const [email, setEmail] = React.useState('');
  const [roleId, setRoleId] = React.useState(roles[0]?.id ?? '');
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState(false);

  function reset() {
    setEmail('');
    setRoleId(roles[0]?.id ?? '');
    setError(null);
    setSuccess(false);
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) reset();
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !roleId) return;

    setError(null);
    setSuccess(false);

    startTransition(async () => {
      const result = await sendInvitation({ email, roleId });
      if (result.success) {
        setSuccess(true);
        onSuccess?.();
        setTimeout(() => {
          setOpen(false);
          reset();
        }, 1500);
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <DialogRoot open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invite team member</DialogTitle>
          <DialogDescription>
            Send an invitation email to add someone to your organization.
          </DialogDescription>
        </DialogHeader>

        {success ? (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <div className="flex size-10 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
              <svg className="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-sm font-medium text-foreground">Invitation sent!</p>
            <p className="text-xs text-muted-foreground">
              An email has been sent to <strong>{email}</strong>
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="invite-email">Email address</Label>
              <Input
                id="invite-email"
                type="email"
                placeholder="colleague@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={isPending}
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="invite-role">Role</Label>
              <SelectRoot value={roleId} onValueChange={setRoleId} disabled={isPending}>
                <SelectTrigger id="invite-role">
                  <SelectValue placeholder="Select a role" />
                </SelectTrigger>
                <SelectContent>
                  {roles.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </SelectRoot>
            </div>

            {error && (
              <p role="alert" className="text-xs font-medium text-destructive">
                {error}
              </p>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setOpen(false)}
                disabled={isPending}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={isPending || !email || !roleId}
              >
                {isPending ? 'Sending…' : 'Send invitation'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </DialogRoot>
  );
}
