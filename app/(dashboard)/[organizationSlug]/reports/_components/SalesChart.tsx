'use client';

/*
 * Sales per day (or month) as bars — one series, so one colour (the primary
 * token) and no legend; the title names it. Every bar answers on hover or
 * keyboard focus with its day and figures, and the table under the chart is
 * the same numbers for anyone who'd rather read them.
 */
import { cn } from '@/lib/utils';
import { formatMoney, formatNumber } from '@/lib/format';
import { bucketLabel, type BucketUnit } from '@/lib/reports/period';
import type { RevenueBucket } from '@/features/reports/sales-reports';

/** A round number at or above the largest bar, for the top gridline. */
function niceCeiling(value: number): number {
  if (value <= 0) return 0;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 2.5, 5, 10]) {
    if (step * magnitude >= value) return step * magnitude;
  }
  return 10 * magnitude;
}

export function SalesChart({ buckets, unit }: { buckets: RevenueBucket[]; unit: BucketUnit }) {
  const top = niceCeiling(Math.max(0, ...buckets.map((b) => b.sales)));
  // Label every bar when there are few; otherwise about seven, evenly spread.
  const every = buckets.length <= 14 ? 1 : Math.ceil(buckets.length / 7);

  return (
    <figure className="rounded-lg border bg-card p-4 shadow-xs">
      <figcaption className="text-sm font-semibold text-foreground">
        Sales by {unit === 'day' ? 'day' : 'month'}
      </figcaption>

      <div className="mt-4 flex gap-2">
        {/* y-axis: just the top and zero, quietly */}
        <div className="flex h-44 w-14 shrink-0 flex-col justify-between text-right text-[11px] tabular-nums text-muted-foreground">
          <span>{formatMoney(top)}</span>
          <span>{formatMoney(0)}</span>
        </div>

        <div className="min-w-0 flex-1">
          <div
            className="relative flex h-44 items-end gap-0.5 border-b border-border"
            role="img"
            aria-label={`Sales by ${unit}. The table below lists every figure.`}
          >
            <div className="pointer-events-none absolute inset-x-0 top-0 border-t border-dashed border-border" />
            <div className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-dashed border-border/60" />
            {buckets.map((bucket) => {
              const height = top > 0 ? (bucket.sales / top) * 100 : 0;
              return (
                <div
                  key={bucket.key}
                  tabIndex={0}
                  aria-label={`${bucketLabel(bucket.key, unit)}: ${formatMoney(bucket.sales)} from ${formatNumber(bucket.orders)} order${bucket.orders === 1 ? '' : 's'}`}
                  className="group relative flex h-full max-w-10 flex-1 items-end justify-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <div
                    className={cn(
                      'w-full rounded-t-[4px] bg-primary/80 transition-colors group-hover:bg-primary group-focus-visible:bg-primary',
                      bucket.sales > 0 && 'min-h-[2px]',
                    )}
                    style={{ height: `${height}%` }}
                  />
                  <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden w-max -translate-x-1/2 rounded-md border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md group-hover:block group-focus-visible:block">
                    <p className="font-medium">{bucketLabel(bucket.key, unit)}</p>
                    <p className="tabular-nums">{formatMoney(bucket.sales)}</p>
                    <p className="text-muted-foreground tabular-nums">
                      {formatNumber(bucket.orders)} order{bucket.orders === 1 ? '' : 's'}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-1.5 flex gap-0.5 text-[11px] text-muted-foreground" aria-hidden>
            {buckets.map((bucket, i) => (
              <span key={bucket.key} className="max-w-10 flex-1 truncate text-center">
                {i % every === 0 ? bucketLabel(bucket.key, unit, 'short') : ''}
              </span>
            ))}
          </div>
        </div>
      </div>
    </figure>
  );
}
