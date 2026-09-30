/*
 * lib/domains/notify.ts
 *
 * The alert to PLATFORM_ADMIN_EMAIL that domain work is waiting (12.6/11.5).
 * The queue at /platform/domains is the record; this is only the nudge. Sent
 * when a registration or renewal is paid (lib/billing/apply-charge.ts) and
 * when a connected domain's records are found correct
 * (features/domains/actions.ts).
 */
import { prisma } from '@/lib/prisma';
import { sendDomainOrderNotificationEmail } from '@/lib/email';
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

  await sendDomainOrderNotificationEmail({
    orgName: organization.name,
    orgSlug: organization.slug,
    domainOrderType: domainOrder.type,
    domain: domainOrder.domain ?? '',
    queueUrl: getMarketingUrl('/platform/domains'),
  }).catch((err) => console.error('[notifyPendingDomainOrder] Notification failed:', err));
}
