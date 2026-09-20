'use client';

import { RouteError } from '@/components/layout/route-error';

export default function ReviewsError({ unstable_retry }: { error: Error; unstable_retry: () => void }) {
  return <RouteError what="your customer reviews" retry={unstable_retry} />;
}
