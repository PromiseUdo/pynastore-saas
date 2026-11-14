'use client';

/*
 * The home page's sales chart: the last 30 days, a bar a day, with the 30
 * days before drawn faintly behind each bar — so "is this a good month?" is
 * answered at a glance, not in Reports. Two series, so a small legend; the
 * current one in the primary colour, the earlier one in a muted wash, both
 * from the theme tokens (light and dark).
 *
 * Every bar answers on hover or keyboard focus with its day, its sales and
 * orders, and the matching day before. The figures are counted as Reports →
 * Sales counts them (features/dashboard/overview.ts), which the link opens.
 */
import Link from 'next/link';
import { ArrowDownRight, ArrowRight, ArrowUpRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatMoney, formatNumber } from '@/lib/format';
import { bucketLabel, changePct } from '@/lib/reports/period';
import type { SalesTrend } from '@/features/dashboard/overview';

/** A round number at or above the largest bar, for the top gridline. */
function niceCeiling(value: number): number {
  if (value <= 0) return 0;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 2.5, 5, 10]) {
    if (step * magnitude >= value) return step * magnitude;
  }
  return 10 * magnitude;
}

export function SalesTrendChart({ trend, currency }: { trend: SalesTrend; currency: string }) {
  const money = (value: number) => formatMoney(value, currency);
  const top = niceCeiling(Math.max(0, ...trend.days.flatMap((d) => [d.sales, d.previousSales])));
  const change = changePct(trend.total, trend.previousTotal);
  const nothingYet = trend.total === 0 && trend.previousTotal === 0;
  // About five date labels across the bottom, the last one being today.
  const every = Math.ceil(trend.days.length / 5);

  return (
    <section aria-labelledby="sales-trend-heading" className="rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="sales-trend-heading" className="text-sm font-semibold">
            Sales, last 30 days
          </h2>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{money(trend.total)}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
            <span className="tabular-nums">
              {formatNumber(trend.orders)} order{trend.orders === 1 ? '' : 's'}
            </span>
            <span aria-hidden>·</span>
            {change === null ? (
              <span>{trend.previousTotal === 0 && trend.total > 0 ? 'Nothing in the 30 days before' : 'No sales to compare with yet'}</span>
            ) : (
              <span className={cn('inline-flex items-center gap-0.5 font-medium', change >= 0 ? 'text-success' : 'text-destructive')}>
                {change >= 0 ? <ArrowUpRight className="size-3.5" aria-hidden /> : <ArrowDownRight className="size-3.5" aria-hidden />}
                {change >= 0 ? 'Up' : 'Down'} {Math.abs(change)}%
                <span className="font-normal text-muted-foreground">on the 30 days before ({money(trend.previousTotal)})</span>
              </span>
            )}
          </p>
        </div>
        <Link
          href="/reports?view=sales&range=30d"
          className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          Sales report
          <ArrowRight className="size-3" aria-hidden />
        </Link>
      </div>

      {nothingYet ? (
        <p className="mt-6 rounded-md border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
          No sales in the last 60 days yet. Your first ones will show here, day by day.
        </p>
      ) : (
        <>
          <div className="mt-4 flex gap-2">
            {/* y-axis: just the top and zero, quietly */}
            <div className="flex h-40 w-14 shrink-0 flex-col justify-between text-right text-[11px] tabular-nums text-muted-foreground">
              <span>{money(top)}</span>
              <span>{money(0)}</span>
            </div>

            <div className="min-w-0 flex-1">
              <div
                className="relative flex h-40 items-end gap-px border-b border-border sm:gap-0.5"
                role="img"
                aria-label={`Sales each day for the last 30 days: ${money(trend.total)} in all, against ${money(trend.previousTotal)} in the 30 days before. Each bar can be focused for its figures.`}
              >
                <div className="pointer-events-none absolute inset-x-0 top-0 border-t border-dashed border-border" />
                <div className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-dashed border-border/60" />
                {trend.days.map((d, index) => {
                  const height = top > 0 ? (d.sales / top) * 100 : 0;
                  const before = top > 0 ? (d.previousSales / top) * 100 : 0;
                  const today = index === trend.days.length - 1;
                  return (
                    <div
                      key={d.day}
                      tabIndex={0}
                      aria-label={`${bucketLabel(d.day, 'day')}${today ? ' (today so far)' : ''}: ${money(d.sales)} from ${formatNumber(d.orders)} order${d.orders === 1 ? '' : 's'}. ${bucketLabel(d.previousDay, 'day', 'short')}: ${money(d.previousSales)}.`}
                      className="group relative flex h-full flex-1 items-end justify-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {/* The matching day before: a faint wash behind. */}
                      <div className="absolute inset-x-0 bottom-0 rounded-t-[3px] bg-muted-foreground/15" style={{ height: `${before}%` }} />
                      <div
                        className={cn(
                          'relative w-3/4 rounded-t-[3px] bg-primary/80 transition-colors group-hover:bg-primary group-focus-visible:bg-primary',
                          d.sales > 0 && 'min-h-[2px]',
                          today && 'bg-primary/50',
                        )}
                        style={{ height: `${height}%` }}
                      />
                      <div
                        className={cn(
                          'pointer-events-none absolute bottom-full z-10 mb-1 hidden w-max rounded-md border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md group-hover:block group-focus-visible:block',
                          // Keep the first and last few tooltips on screen.
                          index < 4 ? 'left-0' : index > trend.days.length - 5 ? 'right-0' : 'left-1/2 -translate-x-1/2',
                        )}
                      >
                        <p className="font-medium">
                          {bucketLabel(d.day, 'day')}
                          {today ? ' · so far' : ''}
                        </p>
                        <p className="tabular-nums">
                          {money(d.sales)} · {formatNumber(d.orders)} order{d.orders === 1 ? '' : 's'}
                        </p>
                        <p className="text-muted-foreground tabular-nums">
                          {bucketLabel(d.previousDay, 'day', 'short')}: {money(d.previousSales)}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-1.5 flex gap-px text-[11px] text-muted-foreground sm:gap-0.5" aria-hidden>
                {trend.days.map((d, index) => (
                  <span key={d.day} className="flex-1 overflow-visible whitespace-nowrap text-center">
                    {(trend.days.length - 1 - index) % every === 0 ? (index === trend.days.length - 1 ? 'Today' : bucketLabel(d.day, 'day', 'short')) : ''}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-hidden>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm bg-primary/80" />
              Last 30 days
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm bg-muted-foreground/15" />
              The 30 days before
            </span>
          </div>
        </>
      )}
    </section>
  );
}
