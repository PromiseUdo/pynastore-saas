'use client';

import { RouteError } from '@/components/layout/route-error';

export default function StorePagesError({ unstable_retry }: { error: Error; unstable_retry: () => void }) {
  return <RouteError what="your store pages" retry={unstable_retry} />;
}
