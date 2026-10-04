'use client';

import { RouteError } from '@/components/layout/route-error';

export default function CustomizeError({ error, unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  return <RouteError what="your store’s look" retry={unstable_retry} error={error} />;
}
