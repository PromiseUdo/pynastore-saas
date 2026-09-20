'use client';

import { RouteError } from '@/components/layout/route-error';

export default function OrdersError({ unstable_retry }: { error: Error; unstable_retry: () => void }) {
  return <RouteError what="your online orders" retry={unstable_retry} />;
}
