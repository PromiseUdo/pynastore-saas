'use client';

/*
 * The shopper's own photo, beside the results it produced.
 *
 * Reads the in-tab store (lib/storefront/stores/visual-search-store.ts), so
 * it renders nothing when there is no local image for this query — a link
 * someone shared, a refresh, a "find similar" from a product page. That is
 * the correct outcome rather than a gap to fill: the photo was never
 * uploaded, so there is nothing to fetch (§23).
 */
import { useVisualPreview } from '@/lib/storefront/stores/visual-search-store';

export function VisualPreview({ token }: { token: string | undefined }) {
  const preview = useVisualPreview(token);
  if (!preview) return null;

  return (
    <figure className="shrink-0">
      {/* eslint-disable-next-line @next/next/no-img-element -- an object URL
          is a blob local to this tab; the image optimiser cannot fetch it. */}
      <img
        src={preview.url}
        alt={`The image you searched with${preview.fileName ? `: ${preview.fileName}` : ''}`}
        className="size-20 rounded-2xl border border-border bg-tile object-cover sm:size-24"
      />
    </figure>
  );
}
