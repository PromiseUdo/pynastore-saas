'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowDown, ArrowUp, Tags } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button-variants';
import { EmptyState } from '@/components/layout/empty-state';
import { Table, TableBody, TableCell, TableColumnHeader, TableHead, TableRow, TableWrapper } from '@/components/ui/table';
import { formatMoney, formatNumber } from '@/lib/format';
import { LIMIT_INFO } from '@/lib/billing/plans';
import { movePlan, type ConsolePlanRow } from '@/features/platform/plans';

export function PlansTable({ plans }: { plans: ConsolePlanRow[] }) {
  const router = useRouter();
  const [moving, setMoving] = React.useState<string | null>(null);

  async function move(planId: string, direction: 'up' | 'down') {
    setMoving(planId);
    const result = await movePlan(planId, direction);
    setMoving(null);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    router.refresh();
  }

  if (plans.length === 0) {
    return (
      <EmptyState
        icon={Tags}
        title="No plans yet"
        description="A plan is what merchants pay for: a monthly price, discounts for paying longer, and the features and limits it includes. Merchants can't sign up to pay until there is one on sale."
        action={
          <Link href="/platform/plans/new" className={buttonVariants({ size: 'sm' })}>
            Create the first plan
          </Link>
        }
      />
    );
  }

  const price = (plan: ConsolePlanRow, cycle: string) => plan.prices.find((p) => p.cycle === cycle);

  return (
    <section aria-labelledby="plans-title" className="space-y-2">
      <h2 id="plans-title" className="sr-only">
        Plans
      </h2>
      <p className="text-xs text-muted-foreground">
        A price change reaches new subscriptions and plan changes. Workspaces already paying keep their price until they
        change plan.
      </p>
      <TableWrapper>
        <Table>
          <TableHead>
            <tr>
              <TableColumnHeader className="w-20">
                <span className="sr-only">Order</span>
              </TableColumnHeader>
              <TableColumnHeader>Plan</TableColumnHeader>
              <TableColumnHeader align="right">Monthly</TableColumnHeader>
              <TableColumnHeader align="right">Every 6 months</TableColumnHeader>
              <TableColumnHeader align="right">Yearly</TableColumnHeader>
              <TableColumnHeader>Includes</TableColumnHeader>
              <TableColumnHeader align="right">Workspaces</TableColumnHeader>
              <TableColumnHeader>Status</TableColumnHeader>
            </tr>
          </TableHead>
          <TableBody>
            {plans.map((plan, i) => {
              const href = `/platform/plans/${plan.id}`;
              const six = price(plan, 'BIANNUAL');
              const year = price(plan, 'YEARLY');
              return (
                <TableRow
                  key={plan.id}
                  className="cursor-pointer"
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest('a,button')) return;
                    router.push(href);
                  }}
                >
                  <TableCell>
                    <div className="flex items-center gap-0.5">
                      <button
                        type="button"
                        aria-label={`Move ${plan.name} up`}
                        disabled={i === 0 || moving !== null}
                        onClick={() => move(plan.id, 'up')}
                        className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-30"
                      >
                        <ArrowUp className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        aria-label={`Move ${plan.name} down`}
                        disabled={i === plans.length - 1 || moving !== null}
                        onClick={() => move(plan.id, 'down')}
                        className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-30"
                      >
                        <ArrowDown className="size-3.5" />
                      </button>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Link href={href} className="font-medium text-foreground hover:underline">
                        {plan.name}
                      </Link>
                      {plan.highlighted && <Badge variant="default">Popular</Badge>}
                      {plan.isTrialPlan && <Badge variant="info">Free trial plan</Badge>}
                    </div>
                    {plan.tagline && <span className="block max-w-xs truncate text-xs text-muted-foreground">{plan.tagline}</span>}
                  </TableCell>
                  <TableCell align="right" className="tabular-nums">
                    {formatMoney(price(plan, 'MONTHLY')?.amount)}
                  </TableCell>
                  <TableCell align="right" className="tabular-nums">
                    {six ? formatMoney(six.amount) : '—'}
                    {six && six.discountPct > 0 && <span className="block text-xs text-muted-foreground">{six.discountPct}% off</span>}
                  </TableCell>
                  <TableCell align="right" className="tabular-nums">
                    {year ? formatMoney(year.amount) : '—'}
                    {year && year.discountPct > 0 && <span className="block text-xs text-muted-foreground">{year.discountPct}% off</span>}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {plan.featureCount} feature{plan.featureCount === 1 ? '' : 's'}
                    <span className="block">
                      {LIMIT_INFO.maxSeats.label(plan.maxSeats)} · {LIMIT_INFO.maxWarehouses.label(plan.maxWarehouses)}
                    </span>
                  </TableCell>
                  <TableCell align="right" className="tabular-nums">
                    {formatNumber(plan.workspaces)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={plan.isOnSale ? 'success' : 'muted'}>{plan.isOnSale ? 'On sale' : 'Off sale'}</Badge>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableWrapper>
    </section>
  );
}
