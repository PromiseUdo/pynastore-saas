'use client';

import { RouteError } from '@/components/layout/route-error';

export default function ReviewsError({ error, unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  return <RouteError what="your customer reviews" retry={unstable_retry} error={error} />;
}
