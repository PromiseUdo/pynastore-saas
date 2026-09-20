'use client';

import { RouteError } from '@/components/layout/route-error';

export default function DiscountsError({ unstable_retry }: { error: Error; unstable_retry: () => void }) {
  return <RouteError what="your discount codes" retry={unstable_retry} />;
}
