'use client';

import { RouteError } from '@/components/layout/route-error';

export default function ShopWalletError({ error, unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  return <RouteError what="your shop wallet" retry={unstable_retry} error={error} />;
}
