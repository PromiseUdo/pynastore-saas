/*
 * Settings → Your data (ROADMAP 13.8): download the workspace's records, and
 * close the workspace. Owners only.
 */
import type { Metadata } from 'next';
import { getOrganizationContext } from '@/lib/organization';
import { SYSTEM_ROLES } from '@/lib/permissions';
import { AccessDenied } from '@/components/layout/access-denied';
import { CLOSURE_GRACE_DAYS, FINANCIAL_RETENTION_YEARS } from '@/lib/data-rights/policy';
import { WORKSPACE_DATASETS } from '@/lib/data-rights/workspace-export';
import { YourDataClient } from './_components/YourDataClient';

export const metadata: Metadata = { title: 'Your data' };

export default async function YourDataPage() {
  const ctx = await getOrganizationContext();
  const role = ctx.membership.role;
  if (!(role.isSystem && role.name === SYSTEM_ROLES.OWNER.name)) return <AccessDenied what="your workspace’s data" />;

  return (
    <YourDataClient
      workspaceName={ctx.organization.name}
      datasets={Object.entries(WORKSPACE_DATASETS).map(([key, label]) => ({ key, label }))}
      graceDays={CLOSURE_GRACE_DAYS}
      retentionYears={FINANCIAL_RETENTION_YEARS}
    />
  );
}
