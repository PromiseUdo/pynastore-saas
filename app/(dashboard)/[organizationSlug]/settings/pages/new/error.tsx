'use client';

import { RouteError } from '@/components/layout/route-error';

export default function StorePageError({ unstable_retry }: { error: Error; unstable_retry: () => void }) {
  return <RouteError what="this store page" retry={unstable_retry} />;
}
