/*
 * The header above a set of visual matches.
 *
 * Two jobs, and the second is the one that matters: say how sure we are.
 * The heading follows the search's confidence — how close the best product
 * photo actually was to the shopper's — so a weak best match reads "closest
 * we could find" instead of dressing a guess up as a hit.
 *
 * Server component. The only client island is <VisualPreview>, which can
 * only read an object URL that exists in the shopper's own tab.
 */
import Link from 'next/link';
import { ImageUp, Info } from 'lucide-react';
import { VisualPreview } from './visual-preview';
import { VISUAL_SEARCH_PATH } from '@/lib/storefront/visual-search/query';
import type {
  VisualAttribute,
  VisualSearchConfidence,
} from '@/lib/storefront/visual-search/types';

const HEADINGS: Record<VisualSearchConfidence, { title: string; blurb: string }> = {
  high: {
    title: 'Visual matches',
    blurb: 'Products from this store that look closest to your image — best matches first.',
  },
  medium: {
    title: 'Best visual matches',
    blurb: 'The closest products we could find from your image, best matches first.',
  },
  low: {
    title: 'Closest we could find',
    blurb:
      'We couldn’t tell much from that image, so these are this store’s nearest equivalents. Filter or sort them below.',
  },
};

export function VisualMatchHeader({
  confidence,
  attributes,
  total,
  token,
  sourceProductName,
}: {
  confidence: VisualSearchConfidence;
  attributes: VisualAttribute[];
  total: number;
  /** the query id, for looking up this tab's own preview */
  token?: string;
  /** set when the search came from a product page's "find similar" */
  sourceProductName?: string;
}) {
  const copy = HEADINGS[confidence];
  const title = sourceProductName ? `Similar to ${sourceProductName}` : copy.title;

  return (
    <header>
      <div className="flex items-start gap-4">
        <VisualPreview token={token} />

        <div className="min-w-0">
          <p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-teal">
            <ImageUp aria-hidden className="size-3.5" />
            Visual search
          </p>
          <h1 className="mt-1.5 text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            {sourceProductName
              ? 'Products from this store with the closest look, best matches first.'
              : copy.blurb}
          </p>
        </div>
      </div>

      {/* Only what the provider actually reported. No chip without a source. */}
      {attributes.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">Matched on</span>
          {attributes.map((attribute) => (
            <span
              key={`${attribute.kind}:${attribute.value}`}
              className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1 text-xs font-medium"
            >
              {attribute.kind === 'colour' && (
                <span aria-hidden className="text-muted-foreground">
                  Colour ·
                </span>
              )}
              {attribute.label}
            </span>
          ))}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <p className="text-sm text-muted-foreground">
          {total.toLocaleString()} {total === 1 ? 'product' : 'products'} to explore
        </p>
        <Link
          href={VISUAL_SEARCH_PATH}
          className="text-sm font-semibold text-brand underline-offset-4 hover:underline"
        >
          Search another image
        </Link>
      </div>

      <p className="mt-4 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
        <Info aria-hidden className="mt-0.5 size-3.5 shrink-0 text-teal" />
        <span>
          Matched by comparing your photo with this store’s product photos.
          Prices and stock are the store’s own, as shown.
        </span>
      </p>
    </header>
  );
}
