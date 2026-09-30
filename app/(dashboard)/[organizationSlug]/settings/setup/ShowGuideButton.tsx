'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { setSetupGuideHidden } from '@/features/onboarding/actions';

/** Puts the hidden guide back on the dashboard. */
export function ShowGuideButton() {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        const result = await setSetupGuideHidden(false);
        setPending(false);
        if (!result.success) return toast.error(result.error);
        toast.success('The guide is back on your dashboard');
        router.refresh();
      }}
    >
      {pending && <Loader2 className="size-3.5 animate-spin" />}
      Show on dashboard
    </Button>
  );
}
