'use client';

import { RouteError } from '@/components/layout/route-error';

export default function MovementsError({ unstable_retry }: { error: Error; unstable_retry: () => void }) {
  return <RouteError what="your stock movements" retry={unstable_retry} />;
}
