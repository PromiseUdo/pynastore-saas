import { cn } from '@/lib/utils';
import { discountPercent, formatMoney, formatPriceRange } from '@/lib/storefront/format';

export function Price({
  amount,
  compareAt = null,
  currency = 'NGN',
  className,
  size = 'md',
}: {
  amount: number;
  compareAt?: number | null;
  currency?: string;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const pct = discountPercent(amount, compareAt);
  const sizes = {
    sm: 'text-sm',
    md: 'text-base',
    lg: 'text-xl',
  } as const;
  return (
    <span className={cn('inline-flex items-baseline gap-2', className)}>
      <span className={cn('font-semibold text-price', sizes[size])}>{formatMoney(amount, currency)}</span>
      {pct != null && (
        <>
          <span className={cn('text-muted-foreground line-through', size === 'lg' ? 'text-base' : 'text-xs')}>
            {formatMoney(compareAt!, currency)}
          </span>
          <span className="rounded bg-sale/10 px-1.5 py-0.5 text-[11px] font-semibold text-sale">-{pct}%</span>
        </>
      )}
    </span>
  );
}

export function PriceRange({
  from,
  to,
  currency = 'NGN',
  className,
}: {
  from: number;
  to: number;
  currency?: string;
  className?: string;
}) {
  return <span className={cn('font-semibold text-price', className)}>{formatPriceRange(from, to, currency)}</span>;
}
