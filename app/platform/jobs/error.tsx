'use client';

import { RouteError } from '@/components/layout/route-error';

export default function JobsError({ unstable_retry }: { error: Error; unstable_retry: () => void }) {
  return <RouteError what="the scheduled jobs" retry={unstable_retry} />;
}
