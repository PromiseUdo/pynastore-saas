'use client';

import { RouteError } from '@/components/layout/route-error';

export default function CategoriesError({ unstable_retry }: { error: Error; unstable_retry: () => void }) {
  return <RouteError what="your categories" retry={unstable_retry} />;
}
