'use client';

import { RouteError } from '@/components/layout/route-error';

export default function VerificationCaseError({ unstable_retry }: { error: Error; unstable_retry: () => void }) {
  return <RouteError what="this business" retry={unstable_retry} />;
}
