'use client';

import { RouteError } from '@/components/layout/route-error';

export default function BillingSettingsError({ unstable_retry }: { error: Error; unstable_retry: () => void }) {
  return <RouteError what="the billing settings" retry={unstable_retry} />;
}
