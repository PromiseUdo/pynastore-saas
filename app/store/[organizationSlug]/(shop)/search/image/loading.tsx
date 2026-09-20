/*
 * Streamed while the visual search runs. The provider is deterministic and
 * instant today; this boundary is what keeps the page from blocking once a
 * real embedding + vector lookup sits behind the service.
 */
import { CatalogSkeleton } from '@/components/storefront/catalog/results-grid';

export default function Loading() {
  return <CatalogSkeleton />;
}
