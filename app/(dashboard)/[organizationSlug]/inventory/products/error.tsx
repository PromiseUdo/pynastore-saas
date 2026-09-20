'use client';

import { RouteError } from '@/components/layout/route-error';

export default function ProductsError({ unstable_retry }: { error: Error; unstable_retry: () => void }) {
  return <RouteError what="your products" retry={unstable_retry} />;
}
