/*
 * lib/domains/notify.ts
 *
 * The alert to platform staff that domain work is waiting (12.6/11.5),
 * raised as 'platform.domain-order' (lib/notifications): emailed to
 * PLATFORM_ADMIN_EMAIL and listed for platform staff.
 * The queue at /platform/domains is the record; this is only the nudge. Sent
 * when a registration or renewal is paid (lib/billing/apply-charge.ts) and
 * when a connected domain's records are found correct
 * (features/domains/actions.ts).
 */
import { prisma } from '@/lib/prisma';
import { notify } from '@/lib/notifications/notify';
import { getMarketingUrl } from '@/lib/tenant/urls';

export async function notifyPendingDomainOrder(
  organizationId: string,
  domainOrder: { type: 'EXISTING' | 'REGISTER' | 'RENEW'; domain: string | null },
): Promise<void> {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { name: true, slug: true },
  });
  if (!organization) return;

  const domain = domainOrder.domain ?? '';
  await notify({
    kind: 'platform.domain-order',
    organizationId: null,
    facts: { shopName: organization.name, domain, type: domainOrder.type },
    email: {
      template: 'domain-order',
      props: {
        orgName: organization.name,
        orgSlug: organization.slug,
        domainOrderType: domainOrder.type,
        domain,
        queueUrl: getMarketingUrl('/platform/domains'),
      },
    },
  });
}
