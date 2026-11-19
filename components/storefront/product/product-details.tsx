/*
 * Description and specifications.
 *
 * Server component. The description is written in the store's small
 * formatting language (lib/storefront/pages/format.ts — the admin's
 * formatting toolbar types it): paragraphs, **bold**, headings, bulleted and
 * numbered lists, links. It is parsed to data and rendered by the same
 * PageBlocks as the admin preview — never `dangerouslySetInnerHTML`.
 *
 * The specification table is built from `product.specs`, whatever those turn
 * out to be: a laptop shows Warranty and Connectivity, a serum shows Skin
 * type, because those are the rows the data carries. There is no
 * per-category table here and nothing to keep in step when a merchant adds
 * an attribute.
 */
import { ReadMore } from './read-more';
import { PageBlocks } from '@/components/content/page-blocks';
import { parsePageBody } from '@/lib/storefront/pages/format';
import type { Product } from '@/lib/storefront/types';

const SPECS_BOX_ID = 'product-specs';

export function ProductDetails({ product }: { product: Product }) {
  const blocks = parsePageBody(product.description);

  return (
    <div className="grid gap-10 lg:grid-cols-2 lg:gap-16">
      <section aria-labelledby="description-heading">
        <h2 id="description-heading" className="font-display text-2xl">
          About this product
        </h2>

        {/* Long copy folds behind "Read more": on a desktop it ends level
          * with the specifications box beside it, and on a phone it stops
          * three paragraphs pushing the reviews a whole screen down. */}
        <ReadMore className="mt-4" matchId={product.specs.length > 0 ? SPECS_BOX_ID : undefined}>
          <PageBlocks blocks={blocks} nested className="sm:text-sm" />
        </ReadMore>
      </section>

      {product.specs.length > 0 && (
        <section aria-labelledby="specs-heading">
          <h2 id="specs-heading" className="font-display text-2xl">
            Specifications
          </h2>

          <dl id={SPECS_BOX_ID} className="mt-4 divide-y rounded-2xl border">
            {/* No brand on the product: no empty row. */}
            {product.brandName?.trim() && <Row label="Brand" value={product.brandName} />}
            {product.specs.map((spec) => (
              <Row key={spec.label} label={spec.label} value={spec.value} />
            ))}
          </dl>
        </section>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[minmax(6.5rem,40%)_minmax(0,1fr)] gap-4 px-4 py-3 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words font-medium">{value}</dd>
    </div>
  );
}
