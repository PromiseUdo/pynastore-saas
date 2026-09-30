/*
 * Settings → Setup guide (ROADMAP 12.5): "Get your shop ready", always here
 * once it's hidden from the dashboard, and where the shop is opened or
 * closed again.
 */
import type { Metadata } from 'next';
import { PageBody, PageHeader } from '@/components/layout/page-header';
import { AccessDenied } from '@/components/layout/access-denied';
import { getOrganizationContext } from '@/lib/organization';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { SetupGuideSection } from '@/components/dashboard/setup-guide-section';
import { ShowGuideButton } from './ShowGuideButton';

export const metadata: Metadata = { title: 'Setup guide' };

export default async function SetupGuidePage() {
  const ctx = await getOrganizationContext();
  if (!hasPermission(ctx.membership.role.permissions, PERMISSIONS.SETTINGS_VIEW)) {
    return <AccessDenied what="the setup guide" />;
  }
  const org = await prisma.organization.findUnique({ where: { id: ctx.organization.id }, select: { setupGuideDismissedAt: true } });
  const canEdit = hasPermission(ctx.membership.role.permissions, PERMISSIONS.SETTINGS_EDIT);

  return (
    <>
      <PageHeader
        title="Setup guide"
        description="What your shop needs before customers can order, and whether it's open."
        actions={canEdit && org?.setupGuideDismissedAt ? <ShowGuideButton /> : undefined}
      />
      <PageBody>
        <SetupGuideSection variant="settings" />
      </PageBody>
    </>
  );
}
