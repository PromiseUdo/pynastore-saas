'use client';

import { RouteError } from '@/components/layout/route-error';

export default function ErrorsError({ error, unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  return <RouteError what="the error log" retry={unstable_retry} error={error} />;
}
