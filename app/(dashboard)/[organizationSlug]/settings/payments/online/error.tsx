'use client';

import { RouteError } from '@/components/layout/route-error';

export default function PaymentSetupError({ unstable_retry }: { error: Error; unstable_retry: () => void }) {
  return <RouteError what="your online payment setup" retry={unstable_retry} />;
}
