'use client';

import { RouteError } from '@/components/layout/route-error';

export default function PaymentsError({ error, unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  return <RouteError what="the payment problems" retry={unstable_retry} error={error} />;
}
