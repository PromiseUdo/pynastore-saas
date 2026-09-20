'use client';

import { RouteError } from '@/components/layout/route-error';

export default function ProductError({ unstable_retry }: { error: Error; unstable_retry: () => void }) {
  return <RouteError what="this product" retry={unstable_retry} />;
}
