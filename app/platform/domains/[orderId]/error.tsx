'use client';

import { RouteError } from '@/components/layout/route-error';

export default function DomainOrderError({ unstable_retry }: { error: Error; unstable_retry: () => void }) {
  return <RouteError what="this domain order" retry={unstable_retry} />;
}
