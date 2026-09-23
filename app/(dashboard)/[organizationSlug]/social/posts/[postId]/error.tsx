'use client';

import { RouteError } from '@/components/layout/route-error';

export default function PostDetailError({ unstable_retry }: { error: Error; unstable_retry: () => void }) {
  return <RouteError what="this post" retry={unstable_retry} />;
}
