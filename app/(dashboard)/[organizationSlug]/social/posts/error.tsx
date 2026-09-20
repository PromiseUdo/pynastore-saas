'use client';

import { RouteError } from '@/components/layout/route-error';

export default function PostsError({ unstable_retry }: { error: Error; unstable_retry: () => void }) {
  return <RouteError what="your post history" retry={unstable_retry} />;
}
