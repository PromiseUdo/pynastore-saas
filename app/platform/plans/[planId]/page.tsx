/*
 * Platform console → Plans and pricing → one plan (ROADMAP 11.7).
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PageBody } from '@/components/layout/page-header';
import { getPlatformStaff } from '@/lib/platform-staff';
import { formatNumber } from '@/lib/format';
import { getConsolePlan } from '@/features/platform/plans';
import { PlanEditor } from '../_components/PlanEditor';
import { PlanHeader } from '../_components/PlanHeader';

export const metadata: Metadata = { title: 'Edit plan' };

type Props = { params: Promise<{ planId: string }> };

export default async function EditPlanPage({ params }: Props) {
  const { planId } = await params;
  // The layout's staff check runs alongside this page, not before it.
  if (!(await getPlatformStaff())) notFound();
  const result = await getConsolePlan(planId);
  if (!result.success) throw new Error(result.error);
  const plan = result.data;
  if (!plan) notFound();

  return (
    <>
      <PlanHeader
        title={plan.draft.name}
        onSale={plan.isOnSale}
        isTrialPlan={plan.isTrialPlan}
        description={
          plan.workspaces === 0
            ? 'No workspace is on this plan.'
            : `${formatNumber(plan.workspaces)} workspace${plan.workspaces === 1 ? ' is' : 's are'} on this plan, ${formatNumber(plan.paying)} of them paying.`
        }
      />
      <PageBody>
        <PlanEditor key={plan.id} plan={plan} />
      </PageBody>
    </>
  );
}
