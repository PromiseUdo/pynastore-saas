'use client';

import { RouteError } from '@/components/layout/route-error';

export default function ComposeError({ error, unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  return <RouteError what="the post composer" retry={unstable_retry} error={error} />;
}
