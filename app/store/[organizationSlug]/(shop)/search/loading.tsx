/*
 * Streamed while the search runs. Mock data resolves instantly today, but
 * this boundary is what keeps the page from blocking once `catalog.ts` talks
 * to a real API — the shell renders immediately and the grid fills in.
 */
import { CatalogSkeleton } from '@/components/storefront/catalog/results-grid';

export default function Loading() {
  return <CatalogSkeleton />;
}
