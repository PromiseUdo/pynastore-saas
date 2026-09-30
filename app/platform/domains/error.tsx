'use client';

import { RouteError } from '@/components/layout/route-error';

export default function DomainsError({ unstable_retry }: { error: Error; unstable_retry: () => void }) {
  return <RouteError what="the domain queue" retry={unstable_retry} />;
}
