'use client';

import { RouteError } from '@/components/layout/route-error';

export default function VerificationCaseError({ error, unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  return <RouteError what="this business" retry={unstable_retry} error={error} />;
}
