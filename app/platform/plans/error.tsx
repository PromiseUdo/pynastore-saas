'use client';

import { RouteError } from '@/components/layout/route-error';

export default function PlansError({ unstable_retry }: { error: Error; unstable_retry: () => void }) {
  return <RouteError what="the plans" retry={unstable_retry} />;
}
