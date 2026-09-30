'use client';

import { RouteError } from '@/components/layout/route-error';

export default function PaymentSetupError({ error, unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  return <RouteError what="your online payment setup" retry={unstable_retry} error={error} />;
}
