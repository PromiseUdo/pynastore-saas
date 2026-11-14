/*
 * "Selling best" on the home page (dashboard recommendation 3): the five
 * products that took the most in the last 7 days, each with the units sold,
 * what they took, and a bar for their share of everything sold — so the
 * winners stand out without reading numbers. One series, so one colour (the
 * primary token), and the share is said in words too.
 *
 * Counted as Reports → Top products counts (features/dashboard/overview.ts),
 * which the link opens for the same 7 days.
 */
import Link from 'next/link';
import { ArrowRight, Package } from 'lucide-react';
import { formatMoney, formatNumber } from '@/lib/format';
import type { TopProductsWeek } from '@/features/dashboard/overview';

export function TopProductsCard({ top, currency }: { top: TopProductsWeek; currency: string }) {
  const lead = top.rows[0]?.revenue ?? 0;

  return (
    <section aria-labelledby="top-products-heading" className="flex flex-col rounded-lg border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="top-products-heading" className="text-sm font-semibold">
            Selling best, last 7 days
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {top.productCount === 0
              ? 'By what each product took'
              : `${formatNumber(top.productCount)} product${top.productCount === 1 ? '' : 's'} sold`}
          </p>
        </div>
        <Link
          href="/reports?view=products&range=7d"
          className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          All products
          <ArrowRight className="size-3" aria-hidden />
        </Link>
      </div>

      {top.rows.length === 0 ? (
        <div className="mt-4 flex flex-1 flex-col items-center justify-center rounded-md border border-dashed px-4 py-8 text-center">
          <Package className="size-5 text-muted-foreground" aria-hidden />
          <p className="mt-2 text-sm text-muted-foreground">Nothing sold in the last 7 days yet. Your best sellers will show here.</p>
        </div>
      ) : (
        <ol className="mt-4 space-y-3.5">
          {top.rows.map((row, index) => {
            const share = Math.round(row.shareRatio * 100);
            const width = lead > 0 ? Math.max(2, (row.revenue / lead) * 100) : 0;
            return (
              <li key={row.productId ?? `${row.name}-${index}`} className="text-sm">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate">
                    <span className="mr-1.5 text-xs tabular-nums text-muted-foreground">{index + 1}</span>
                    {row.productId ? (
                      <Link href={`/inventory/products/${row.productId}`} className="font-medium text-foreground hover:underline">
                        {row.name}
                      </Link>
                    ) : (
                      <span className="font-medium text-foreground">{row.name}</span>
                    )}
                  </span>
                  <span className="shrink-0 font-medium tabular-nums">{formatMoney(row.revenue, currency)}</span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                  <div className="h-full rounded-full bg-primary/80" style={{ width: `${width}%` }} />
                </div>
                <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                  {formatNumber(row.unitsSold)} sold · {share < 1 ? 'under 1%' : `${share}%`} of sales
                </p>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
