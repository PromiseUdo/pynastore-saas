'use client';

import { RouteError } from '@/components/layout/route-error';

export default function OrdersError({ error, unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  return <RouteError what="your online orders" retry={unstable_retry} error={error} />;
}
