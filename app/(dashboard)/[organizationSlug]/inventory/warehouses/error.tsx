'use client';

import { RouteError } from '@/components/layout/route-error';

export default function SegmentError({ unstable_retry }: { error: Error; unstable_retry: () => void }) {
  return <RouteError what="your stores" retry={unstable_retry} />;
}
