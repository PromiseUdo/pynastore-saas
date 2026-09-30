'use client';

import { RouteError } from '@/components/layout/route-error';

export default function ConsoleOverviewError({ unstable_retry }: { error: Error; unstable_retry: () => void }) {
  return <RouteError what="the overview" retry={unstable_retry} />;
}
