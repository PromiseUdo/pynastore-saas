'use client';

import { RouteError } from '@/components/layout/route-error';

export default function StoreError({ unstable_retry }: { error: Error; unstable_retry: () => void }) {
  return <RouteError what="this store" retry={unstable_retry} />;
}
