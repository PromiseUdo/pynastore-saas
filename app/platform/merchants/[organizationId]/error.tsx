'use client';

import { RouteError } from '@/components/layout/route-error';

export default function MerchantError({ unstable_retry }: { error: Error; unstable_retry: () => void }) {
  return <RouteError what="this merchant" retry={unstable_retry} />;
}
