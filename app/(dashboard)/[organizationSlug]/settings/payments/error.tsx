'use client';

import { RouteError } from '@/components/layout/route-error';

export default function PaymentSettingsError({ unstable_retry }: { error: Error; unstable_retry: () => void }) {
  return <RouteError what="your payment settings" retry={unstable_retry} />;
}
