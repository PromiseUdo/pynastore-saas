'use client';

import { RouteError } from '@/components/layout/route-error';

export default function DiscountsError({ error, unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  return <RouteError what="your discount codes" retry={unstable_retry} error={error} />;
}
