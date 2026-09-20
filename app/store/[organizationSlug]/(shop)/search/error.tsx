'use client';

import { DiscoveryError } from '@/components/storefront/catalog/discovery-error';

export default function SearchError({ reset }: { error: Error; reset: () => void }) {
  return <DiscoveryError reset={reset} title="Something went wrong while searching." />;
}
