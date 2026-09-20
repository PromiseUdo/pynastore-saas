'use client';

import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** Body for an admin `error.tsx` boundary. `retry` should be Next's
 *  `unstable_retry`, which re-fetches the segment's server data — plain
 *  `reset` only re-renders and would hit the same failed load. */
export function RouteError({ what, retry }: { what: string; retry: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center justify-center px-6 py-20 text-center">
      <AlertTriangle className="size-6 text-amber-600 dark:text-amber-400" />
      <h2 className="mt-3 text-base font-semibold text-foreground">We couldn’t load {what}</h2>
      <p className="mt-1 text-sm text-muted-foreground">Check your connection and try again.</p>
      <Button size="sm" variant="outline" className="mt-4" onClick={retry}>
        Try again
      </Button>
    </div>
  );
}
