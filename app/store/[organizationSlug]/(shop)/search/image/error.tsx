'use client';

/*
 * Last resort only: the page already turns a failed or invalid visual search
 * into the "no close matches" state with real routes out (see page.tsx), so
 * reaching here means something below the feature broke.
 */
import { DiscoveryError } from '@/components/storefront/catalog/discovery-error';

export default function VisualSearchError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <DiscoveryError reset={reset} error={error} title="Something went wrong with that image search." />;
}
