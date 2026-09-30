'use client';

import { RouteError } from '@/components/layout/route-error';

export default function ProductError({ error, unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  return <RouteError what="this product" retry={unstable_retry} error={error} />;
}
