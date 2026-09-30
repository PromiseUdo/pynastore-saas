'use client';

import { DiscoveryError } from '@/components/storefront/catalog/discovery-error';

export default function ProductsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <DiscoveryError reset={reset} error={error} />;
}
