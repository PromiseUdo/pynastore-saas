'use client';

import { RouteError } from '@/components/layout/route-error';

export default function MobileAppOrderError({ error, unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  return <RouteError what="this store app" retry={unstable_retry} error={error} />;
}
