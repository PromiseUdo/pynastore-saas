'use client';

import { LogOut } from 'lucide-react';
import { signOut } from 'next-auth/react';
import { Button } from '@/components/ui/button';
import { getMarketingUrl } from '@/lib/tenant/urls';

export function SignOutButton() {
  return (
    <Button variant="ghost" size="sm" onClick={() => signOut({ callbackUrl: getMarketingUrl('/login') })}>
      <LogOut className="size-3.5" aria-hidden />
      Sign out
    </Button>
  );
}
