'use client';

import { RouteError } from '@/components/layout/route-error';

export default function LaunchError({ error, unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  return <RouteError what="the go-live checklist" retry={unstable_retry} error={error} />;
}
