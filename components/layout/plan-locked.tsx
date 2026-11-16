'use client';

/*
 * "Not on your plan" (AGENTS §7, ROADMAP 22.1). A plan-gated feature is
 * never hidden: it says what it does and how to get it. Two sizes:
 *
 *   - `PlanLocked`, in place of a page or section the plan doesn't open;
 *   - `PlanLockedNote`, a one-line note above things the shop already made
 *     (its campaigns, its custom roles) that keep working but can't be added to.
 *
 * The words come from FEATURE_INFO, so the pricing page, the console and
 * this panel name a feature the same way. In the business app the way to buy
 * goes (UpgradeLink) and the explanation stays.
 */
import { Lock } from 'lucide-react';
import { EmptyState } from '@/components/layout/empty-state';
import { UpgradeLink, useNoBuying } from '@/components/business-app/no-buying';
import { buttonVariants } from '@/components/ui/button-variants';
import { FEATURE_INFO, type FeatureKey } from '@/lib/billing/plans';

const upgradeHref = (feature: FeatureKey) => `/upgrade?feature=${encodeURIComponent(feature)}`;

export function PlanLocked({ feature, description, className }: { feature: FeatureKey; description?: string; className?: string }) {
  const info = FEATURE_INFO[feature];
  return (
    <EmptyState
      icon={Lock}
      title={`${info.label} isn’t on your plan`}
      description={description ?? `${info.description}. Choose a plan that includes it to start.`}
      action={
        <UpgradeLink href={upgradeHref(feature)} className={buttonVariants({ size: 'sm' })}>
          See plans
        </UpgradeLink>
      }
      className={className}
    />
  );
}

export function PlanLockedNote({ feature, children }: { feature: FeatureKey; children: React.ReactNode }) {
  const noBuying = useNoBuying();
  return (
    <div role="status" className="flex flex-col gap-2 rounded-md border bg-muted/40 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
      <p className="flex items-start gap-2 text-foreground">
        <Lock className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span>{children}</span>
      </p>
      {!noBuying && (
        <UpgradeLink href={upgradeHref(feature)} className={buttonVariants({ size: 'sm', variant: 'outline', className: 'shrink-0 self-start sm:self-auto' })}>
          See plans
        </UpgradeLink>
      )}
    </div>
  );
}

