/*
 * lib/domains/notify.ts
 *
 * Shared by lib/billing/checkout.ts (a zero-fee EXISTING-domain order needs
 * no payment, so it's notified immediately) and lib/billing/apply-charge.ts
 * (a REGISTER/paid EXISTING order is notified once the charge succeeds).
 */
import { prisma } from '@/lib/prisma';
import { sendDomainOrderNotificationEmail } from '@/lib/email';

export async function notifyPendingDomainOrder(
  organizationId: string,
  domainOrder: { type: 'EXISTING' | 'REGISTER'; domain: string | null },
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
  }).catch((err) => console.error('[notifyPendingDomainOrder] Notification failed:', err));
}
