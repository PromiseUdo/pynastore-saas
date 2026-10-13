'use client';

import { signOutHere } from '@/components/account/sign-out';
import { LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function SignOutButton() {
  return (
    <Button variant="ghost" size="sm" onClick={() => void signOutHere()}>
      <LogOut className="size-3.5" aria-hidden />
      Sign out
    </Button>
  );
}
