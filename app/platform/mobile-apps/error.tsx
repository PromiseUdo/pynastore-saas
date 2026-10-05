'use client';

import { RouteError } from '@/components/layout/route-error';

export default function MobileAppsError({ error, unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  return <RouteError what="the store apps" retry={unstable_retry} error={error} />;
}
