'use client';

import { RouteError } from '@/components/layout/route-error';

export default function PlanError({ unstable_retry }: { error: Error; unstable_retry: () => void }) {
  return <RouteError what="this plan" retry={unstable_retry} />;
}
