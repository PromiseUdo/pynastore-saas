'use client';

import { RouteError } from '@/components/layout/route-error';

export default function BrandsError({ unstable_retry }: { error: Error; unstable_retry: () => void }) {
  return <RouteError what="your brands" retry={unstable_retry} />;
}
