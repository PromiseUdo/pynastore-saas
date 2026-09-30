'use client';

import { RouteError } from '@/components/layout/route-error';

export default function PaymentsError({ unstable_retry }: { error: Error; unstable_retry: () => void }) {
  return <RouteError what="your payments" retry={unstable_retry} />;
}
