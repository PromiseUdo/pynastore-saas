/*
 * Description and specifications.
 *
 * Server component. The description is stored with light markdown (bold runs
 * and paragraph breaks), so it is rendered as paragraphs with `**bold**`
 * resolved — deliberately not `dangerouslySetInnerHTML`, and deliberately
 * not a markdown dependency for one bold run.
 *
 * The specification table is built from `product.specs`, whatever those turn
 * out to be: a laptop shows Warranty and Connectivity, a serum shows Skin
 * type, because those are the rows the data carries. There is no
 * per-category table here and nothing to keep in step when a merchant adds
 * an attribute.
 */
import { ReadMore } from './read-more';
import type { Product } from '@/lib/storefront/types';

export function ProductDetails({ product }: { product: Product }) {
  const paragraphs = product.description.split('\n\n').filter(Boolean);

  return (
    <div className="grid gap-10 lg:grid-cols-2 lg:gap-16">
      <section aria-labelledby="description-heading">
        <h2 id="description-heading" className="font-display text-2xl">
          About this product
        </h2>

        {/* Collapsed on small screens only: on a phone three paragraphs push
          * the specifications and reviews an entire screen further down. */}
        <ReadMore className="mt-4">
          <div className="space-y-4 text-sm leading-relaxed text-muted-foreground">
            {paragraphs.map((paragraph, i) => (
              <p key={i}>{renderInline(paragraph)}</p>
            ))}
          </div>
        </ReadMore>
      </section>

      {product.specs.length > 0 && (
        <section aria-labelledby="specs-heading">
          <h2 id="specs-heading" className="font-display text-2xl">
            Specifications
          </h2>

          <dl className="mt-4 divide-y rounded-2xl border">
            <Row label="Brand" value={product.brandName} />
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

/** Resolves `**bold**` runs; everything else is plain text. */
function renderInline(text: string): React.ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? (
      <strong key={i} className="font-semibold text-foreground">
        {part.slice(2, -2)}
      </strong>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}
