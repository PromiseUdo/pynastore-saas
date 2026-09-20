'use client';

import { RouteError } from '@/components/layout/route-error';

export default function ComposeError({ unstable_retry }: { error: Error; unstable_retry: () => void }) {
  return <RouteError what="the post composer" retry={unstable_retry} />;
}
