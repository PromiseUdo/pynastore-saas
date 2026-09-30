'use client';

import { RouteError } from '@/components/layout/route-error';

export default function CollectionsError({ error, unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  return <RouteError what="your collections" retry={unstable_retry} error={error} />;
}
