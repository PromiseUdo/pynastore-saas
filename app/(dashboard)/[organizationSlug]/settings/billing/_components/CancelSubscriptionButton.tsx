'use client';

import * as React from 'react';
import { useTransition } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialogRoot,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { cancelSubscription } from '@/features/billing/actions';

export function CancelSubscriptionButton() {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = React.useState<string | null>(null);

  function handleConfirm() {
    startTransition(async () => {
      const result = await cancelSubscription();
      if (!result.success) setError(result.error);
    });
  }

  return (
    <AlertDialogRoot>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm">
          Cancel plan
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Cancel your subscription?</AlertDialogTitle>
          <AlertDialogDescription>
            You&apos;ll keep access to your current plan&apos;s features until the end of the
            billing period, then your workspace will move to the Free plan.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel>Keep plan</AlertDialogCancel>
          <AlertDialogAction onClick={handleConfirm} disabled={isPending}>
            {isPending ? <Loader2 className="size-3.5 animate-spin" /> : 'Cancel plan'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialogRoot>
  );
}
