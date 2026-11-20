'use client';

/*
 * The plans, by billing cycle, and what each includes — from the catalogue.
 * Monthly / every 6 months / yearly, with the saving named against paying
 * monthly and the monthly equivalent shown for the longer cycles.
 */
import * as React from 'react';
import Link from 'next/link';
import { Check, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatMoney } from '@/lib/format';
import { CYCLES, CYCLE_ORDER, FEATURE_INFO, LIMIT_INFO, type BillingCycleKey, type FeatureKey } from '@/lib/billing/plans';
import type { PlanOffer } from '@/lib/billing/catalogue';

export function PricingTable({ plans, trialPlanName }: { plans: PlanOffer[]; trialPlanName: string | null }) {
  const cycles = CYCLE_ORDER.filter((c) => plans.some((p) => p.prices.some((x) => x.cycle === c)));
  const [cycle, setCycle] = React.useState<BillingCycleKey>(cycles[0] ?? 'MONTHLY');
  const saving = (c: BillingCycleKey) => Math.max(0, ...plans.flatMap((p) => p.prices.filter((x) => x.cycle === c).map((x) => x.discountPct)));
  const features = (Object.keys(FEATURE_INFO) as FeatureKey[]).filter(
    (f) => FEATURE_INFO[f].built && plans.some((p) => p.features.includes(f)),
  );

  return (
    <div className="space-y-16">
      {cycles.length > 1 && (
        <div className="flex justify-center">
          <div role="radiogroup" aria-label="How often you pay" className="inline-flex rounded-full border bg-card p-1 shadow-sm">
            {cycles.map((c) => {
              const s = saving(c);
              return (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={cycle === c}
                  onClick={() => setCycle(c)}
                  className={cn(
                    'flex h-10 items-center gap-2 rounded-full px-4 text-[14px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    cycle === c ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {CYCLES[c].label}
                  {s > 0 && (
                    <span className={cn('text-xs', cycle === c ? 'text-mk-sun' : 'text-primary')}>−{s}%</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className={cn('grid gap-5', plans.length === 1 ? 'mx-auto max-w-sm' : plans.length === 2 ? 'mx-auto max-w-3xl md:grid-cols-2' : 'md:grid-cols-3')}>
        {plans.map((plan) => {
          const price = plan.prices.find((p) => p.cycle === cycle);
          const months = CYCLES[cycle].months;
          return (
            <div
              key={plan.id}
              className={cn(
                'relative flex flex-col rounded-3xl border bg-card p-7 sm:p-8',
                plan.highlighted && 'border-primary shadow-[0_24px_50px_-24px_rgba(14,107,71,0.5)] ring-1 ring-primary',
              )}
            >
              {plan.highlighted && (
                <span className="absolute -top-3 left-7 rounded-full bg-mk-sun px-3 py-1 text-xs font-semibold text-[#11211a]">Recommended</span>
              )}
              <h2 className="text-balance font-mk-display text-[22px] font-semibold tracking-[-0.01em]">{plan.name}</h2>
              {plan.tagline && <p className="mt-1 min-h-10 text-sm text-muted-foreground">{plan.tagline}</p>}
              <div className="mt-6">
                {price ? (
                  <>
                    <p className="flex items-baseline gap-1.5">
                      <span className="font-mk-display text-[2.6rem] font-bold leading-none tracking-[-0.03em] tabular-nums">{formatMoney(price.amount)}</span>
                      <span className="text-sm text-muted-foreground">/ {CYCLES[cycle].per}</span>
                    </p>
                    <p className="mt-1.5 min-h-5 text-sm text-muted-foreground tabular-nums">
                      {months > 1
                        ? `${formatMoney(Math.round(price.amount / months))} a month${price.discountPct ? ` — you save ${price.discountPct}%` : ''}`
                        : ''}
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">Not offered {CYCLES[cycle].label.toLowerCase()}.</p>
                )}
              </div>
              <Link
                href="/register"
                className={cn(
                  'mt-6 inline-flex h-12 items-center justify-center rounded-full text-[15px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                  plan.highlighted ? 'bg-primary text-primary-foreground hover:bg-[#0b5a3b]' : 'border border-foreground/15 bg-card hover:border-foreground/30',
                )}
              >
                {trialPlanName === plan.name ? 'Start free trial' : `Start with ${plan.name}`}
              </Link>
              <ul className="mt-7 space-y-3 border-t pt-6 text-sm">
                {(Object.keys(LIMIT_INFO) as (keyof typeof LIMIT_INFO)[]).map((k) => (
                  <li key={k} className="flex gap-3">
                    <Check className="mt-0.5 size-4 shrink-0 text-primary" strokeWidth={2.5} aria-hidden />
                    {LIMIT_INFO[k].label(plan.limits[k])}
                  </li>
                ))}
                {plan.features
                  .filter((f) => FEATURE_INFO[f].built)
                  .map((f) => (
                    <li key={f} className="flex gap-3">
                      <Check className="mt-0.5 size-4 shrink-0 text-primary" strokeWidth={2.5} aria-hidden />
                      {FEATURE_INFO[f].label}
                    </li>
                  ))}
              </ul>
            </div>
          );
        })}
      </div>

      <p className="text-center text-sm text-muted-foreground">
        Every plan includes your own online shop, and you can connect a domain you already own — like yourshop.com.ng — for free.
        No plan takes a commission on your sales; Paystack’s standard fee applies to online payments. On a paid plan you can also add
        your shop’s own Android and iPhone app.
      </p>

      {plans.length > 1 && (
        <div>
          <h2 className="text-balance text-center font-mk-display text-[2rem] font-semibold tracking-[-0.03em]">Compare plans</h2>
          <div className="mt-8 overflow-x-auto rounded-3xl border bg-card">
            <table className="w-full min-w-[40rem] text-sm">
              <thead>
                <tr className="border-b bg-muted/60">
                  <th scope="col" className="px-5 py-4 text-left font-medium text-muted-foreground">
                    <span className="sr-only">Feature</span>
                  </th>
                  {plans.map((p) => (
                    <th key={p.id} scope="col" className="px-5 py-4 text-left font-semibold">
                      {p.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {(Object.keys(LIMIT_INFO) as (keyof typeof LIMIT_INFO)[]).map((k) => (
                  <tr key={k}>
                    <th scope="row" className="px-5 py-3.5 text-left font-normal text-muted-foreground">
                      {k === 'maxSeats' ? 'Team members' : 'Stores (branches)'}
                    </th>
                    {plans.map((p) => (
                      <td key={p.id} className="px-5 py-3.5 tabular-nums">
                        {p.limits[k] === null ? 'Unlimited' : p.limits[k]}
                      </td>
                    ))}
                  </tr>
                ))}
                {features.map((f) => (
                  <tr key={f}>
                    <th scope="row" className="px-5 py-3.5 text-left font-normal">
                      <span className="text-foreground">{FEATURE_INFO[f].label}</span>
                      <span className="block text-xs text-muted-foreground">{FEATURE_INFO[f].description}</span>
                    </th>
                    {plans.map((p) => (
                      <td key={p.id} className="px-5 py-3.5">
                        {p.features.includes(f) ? (
                          <Check className="size-4 text-primary" strokeWidth={2.5} aria-label="Included" />
                        ) : (
                          <Minus className="size-4 text-muted-foreground/50" aria-label="Not included" />
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
