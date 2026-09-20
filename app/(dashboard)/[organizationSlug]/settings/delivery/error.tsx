'use client';

import { RouteError } from '@/components/layout/route-error';

export default function DeliverySettingsError({ unstable_retry }: { error: Error; unstable_retry: () => void }) {
  return <RouteError what="your delivery settings" retry={unstable_retry} />;
}
