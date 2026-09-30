'use client';

import { RouteError } from '@/components/layout/route-error';

export default function SegmentError({ error, unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  return <RouteError what="these reports" retry={unstable_retry} error={error} />;
}
