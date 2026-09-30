'use client';

import { RouteError } from '@/components/layout/route-error';

export default function SocialError({ error, unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  return <RouteError what="your connected social accounts" retry={unstable_retry} error={error} />;
}
