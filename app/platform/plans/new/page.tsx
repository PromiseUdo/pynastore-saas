import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PageBody } from '@/components/layout/page-header';
import { getPlatformStaff } from '@/lib/platform-staff';
import { PlanEditor } from '../_components/PlanEditor';
import { PlanHeader } from '../_components/PlanHeader';

export const metadata: Metadata = { title: 'New plan' };

export default async function NewPlanPage() {
  if (!(await getPlatformStaff())) notFound();
  return (
    <>
      <PlanHeader
        title="New plan"
        description="A new plan starts off sale, so you can check it before merchants see it."
      />
      <PageBody>
        <PlanEditor plan={null} />
      </PageBody>
    </>
  );
}
