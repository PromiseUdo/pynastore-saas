/*
 * "Wholesale price · + VAT" beside a price a trade buyer sees (ROADMAP 21.2).
 *
 * Only ever for a signed-in trade buyer: the catalogue sets `wholesale` on a
 * product, and `atWholesale` on a variant, only when it priced them for one
 * (lib/storefront/data/from-prisma.ts). When the shop adds VAT to wholesale
 * prices, saying so beside the price is what keeps the shelf and the total
 * from disagreeing without warning (decision 8).
 */
import { cn } from '@/lib/utils';
import type { Product, ProductVariant } from '@/lib/storefront/types';
import { describeRules } from '@/lib/trade/quantity';

export function WholesaleNote({
  product,
  variant,
  className,
}: {
  product: Pick<Product, 'wholesale'>;
  /** the chosen variant, when there is one: a variant without a wholesale price is retail */
  variant?: Pick<ProductVariant, 'atWholesale'> | null;
  className?: string;
}) {
  if (!product.wholesale) return null;
  if (variant && !variant.atWholesale) return null;
  return (
    <span className={cn('text-xs font-semibold text-muted-foreground', className)}>
      Wholesale price{product.wholesale.vatAdded ? ' · + VAT' : ''}
    </span>
  );
}

/**
 * "Minimum 12 · in packs of 24" for a trade buyer (ROADMAP 21.3) — said
 * beside the price, so the quantity they start at isn't a surprise.
 */
export function TradeRulesNote({ product, className }: { product: Pick<Product, 'trade'>; className?: string }) {
  const text = describeRules(product.trade);
  if (!text) return null;
  return <span className={cn('block text-xs text-muted-foreground', className)}>{text}</span>;
}
