'use client';

import { DiscoveryError } from '@/components/storefront/catalog/discovery-error';

export default function CollectionsError({ reset }: { error: Error; reset: () => void }) {
  return <DiscoveryError reset={reset} />;
}
