'use client';

import { DiscoveryError } from '@/components/storefront/catalog/discovery-error';

export default function ProductsError({ reset }: { error: Error; reset: () => void }) {
  return <DiscoveryError reset={reset} />;
}
