/*
 * Settings → Mobile app (ROADMAP 16.2): the store's own Android and iPhone
 * app, a paid add-on. Ask for it, pay, follow it from built to live, renew it
 * each year, and choose whether the website offers it.
 */
import type { Metadata } from 'next';
import { PageBody, PageHeader } from '@/components/layout/page-header';
import { AccessDenied } from '@/components/layout/access-denied';
import { getOrganizationContext } from '@/lib/organization';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { getOrganizationEntitlements } from '@/lib/billing/entitlements';
import { getMobileAppPricing } from '@/lib/settings';
import { canRenew } from '@/lib/mobile/orders';
import { appStoreUrl, googlePlayUrl } from '@/lib/mobile/listing-rules';
import { MobileAppClient, type MobileAppPageData } from './MobileAppClient';

export const metadata: Metadata = { title: 'Mobile app' };

export default async function MobileAppSettingsPage() {
  const ctx = await getOrganizationContext();
  const perms = ctx.membership.role.permissions;
  if (!hasPermission(perms, PERMISSIONS.SETTINGS_VIEW)) return <AccessDenied what="your mobile app" />;
  const organizationId = ctx.organization.id;

  const [pricing, { access, subscription }, app] = await Promise.all([
    getMobileAppPricing(),
    getOrganizationEntitlements(),
    prisma.mobileApp.findUnique({
      where: { organizationId },
      include: { payments: { where: { paidAt: { not: null } }, orderBy: { paidAt: 'desc' } } },
    }),
  ]);
  const now = new Date();

  const data: MobileAppPageData = {
    pricing,
    paidPlan: access.state === 'active' && (subscription?.status === 'ACTIVE' || subscription?.status === 'PAST_DUE'),
    canEdit: hasPermission(perms, PERMISSIONS.SETTINGS_EDIT),
    canPay: hasPermission(perms, PERMISSIONS.BILLING_MANAGE),
    app: app
      ? {
          stage: app.stage,
          status: app.status,
          name: app.name,
          icon: app.iconUrl && app.iconPublicId ? { url: app.iconUrl, publicId: app.iconPublicId } : null,
          backgroundColor: app.backgroundColor ?? '#ffffff',
          shortDescription: app.shortDescription ?? '',
          wantsAndroid: app.wantsAndroid,
          wantsIos: app.wantsIos,
          paidAt: app.paidAt,
          buildingAt: app.buildingAt,
          deliveredAt: app.deliveredAt,
          liveAt: app.liveAt,
          versionName: app.versionName,
          downloadUrl: app.downloadUrl,
          deliveryNote: app.deliveryNote,
          paidThrough: app.paidThrough,
          graceEndsAt: app.graceEndsAt,
          canRenew: canRenew(app, now),
          appStoreUrl: app.appStoreId ? appStoreUrl(app.appStoreId) : null,
          googlePlayUrl: app.onGooglePlay ? googlePlayUrl(app.appId) : null,
          promoteOnWebsite: app.promoteOnWebsite,
          payments: app.payments.map((p) => ({ kind: p.kind, amount: Number(p.amount), paidAt: p.paidAt! })),
        }
      : null,
  };

  return (
    <>
      <PageHeader
        title="Mobile app"
        description="Your shop’s own app for Android and iPhone, with your name and icon. Customers install it and shop from it instead of the website."
      />
      <PageBody>
        <MobileAppClient data={data} />
      </PageBody>
    </>
  );
}
