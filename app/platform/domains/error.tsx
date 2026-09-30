'use client';

import { RouteError } from '@/components/layout/route-error';

export default function DomainsError({ error, unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  return <RouteError what="the domain queue" retry={unstable_retry} error={error} />;
}
