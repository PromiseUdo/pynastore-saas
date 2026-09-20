'use client';

import { RouteError } from '@/components/layout/route-error';

export default function SocialError({ unstable_retry }: { error: Error; unstable_retry: () => void }) {
  return <RouteError what="your connected social accounts" retry={unstable_retry} />;
}
