'use client';

import { RouteError } from '@/components/layout/route-error';

export default function PostsError({ error, unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  return <RouteError what="your post history" retry={unstable_retry} error={error} />;
}
