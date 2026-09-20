'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { retryProductImageSearch } from '@/features/inventory/actions';
import type { ProductImageSearchStatus } from '@/lib/storefront/visual-search/indexing';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * Whether this product's saved photos can be found by "Search by image" in
 * the online store. Photos are prepared in the background after a save, so
 * a fresh upload shows as "Preparing" for a moment; a failure can be retried.
 */
export function ImageSearchStatus({
  productId,
  status,
  canRetry,
}: {
  productId: string;
  status: ProductImageSearchStatus;
  canRetry: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  if (status.images === 0) return null;

  async function retry() {
    setPending(true);
    const result = await retryProductImageSearch(productId);
    setPending(false);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success('Trying those photos again — this takes a minute or two.');
    router.refresh();
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <span>Search by image:</span>
      {status.indexed === status.images ? (
        <Badge variant="success">Ready</Badge>
      ) : (
        <>
          {status.indexed > 0 && <Badge variant="success">{plural(status.indexed, 'photo')} ready</Badge>}
          {status.pending > 0 && <Badge variant="pending">Preparing {plural(status.pending, 'photo')}</Badge>}
          {status.failed > 0 && <Badge variant="destructive">{plural(status.failed, 'photo')} couldn’t be prepared</Badge>}
        </>
      )}
      {status.failed > 0 && canRetry && (
        <Button type="button" variant="outline" size="sm" onClick={() => void retry()} disabled={pending}>
          {pending && <Loader2 className="size-3.5 animate-spin" />}
          Try again
        </Button>
      )}
      <span className="basis-full">Shoppers can find this product by uploading a similar photo. Updates after you save.</span>
    </div>
  );
}
