'use client';

import { RouteError } from '@/components/layout/route-error';

export default function SegmentError({ unstable_retry }: { error: Error; unstable_retry: () => void }) {
  return <RouteError what="the sale screen" retry={unstable_retry} />;
}
