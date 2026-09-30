'use client';

import { RouteError } from '@/components/layout/route-error';

export default function JobsError({ error, unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  return <RouteError what="the scheduled jobs" retry={unstable_retry} error={error} />;
}
