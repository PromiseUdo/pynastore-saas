'use client';

import { RouteError } from '@/components/layout/route-error';

export default function QuestionsError({ unstable_retry }: { error: Error; unstable_retry: () => void }) {
  return <RouteError what="your customer questions" retry={unstable_retry} />;
}
