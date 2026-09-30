/*
 * Platform console → Plans and pricing (ROADMAP 11.7).
 *
 * The plan catalogue merchants choose from — the only place it is edited.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { notFound } from 'next/navigation';
import { PageBody, PageHeader } from '@/components/layout/page-header';
import { getPlatformStaff } from '@/lib/platform-staff';
import { buttonVariants } from '@/components/ui/button-variants';
import { listConsolePlans, listPlatformChanges } from '@/features/platform/plans';
import { PlansTable } from './_components/PlansTable';
import { RecentChanges } from './_components/RecentChanges';

export const metadata: Metadata = { title: 'Plans and pricing' };

export default async function ConsolePlansPage() {
  // The layout's staff check runs alongside this page, not before it.
  if (!(await getPlatformStaff())) notFound();
  const [plans, changes] = await Promise.all([listConsolePlans(), listPlatformChanges(10)]);
  if (!plans.success) throw new Error(plans.error);

  return (
    <>
      <PageHeader
        title="Plans and pricing"
        description="The plans merchants can choose, in the order they see them. Changes reach the pricing page straight away."
        actions={
          <Link href="/platform/plans/new" className={buttonVariants({ size: 'sm' })}>
            <Plus className="size-3.5" aria-hidden />
            New plan
          </Link>
        }
      />
      <PageBody>
        <div className="space-y-8">
          <PlansTable plans={plans.data} />
          <RecentChanges changes={changes.success ? changes.data : null} />
        </div>
      </PageBody>
    </>
  );
}
