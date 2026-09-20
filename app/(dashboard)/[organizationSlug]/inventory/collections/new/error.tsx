'use client';

import { RouteError } from '@/components/layout/route-error';

export default function CollectionsError({ unstable_retry }: { error: Error; unstable_retry: () => void }) {
  return <RouteError what="your collections" retry={unstable_retry} />;
}
