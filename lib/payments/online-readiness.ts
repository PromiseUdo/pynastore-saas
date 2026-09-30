/*
 * lib/payments/online-readiness.ts
 *
 * Whether a shop may take online payments right now, read from the database.
 * Server only. The rule itself is pure and lives in ./payment-setup.ts
 * (`onlinePaymentReadiness`) so it can be tested without a database.
 */
import { prisma } from '@/lib/prisma';
import { onlinePaymentReadiness, type OnlinePaymentBlocker } from './payment-setup';

export async function getOnlinePaymentReadiness(
  organizationId: string,
): Promise<{ ready: boolean; blocker: OnlinePaymentBlocker | null }> {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: {
      status: true,
      paymentAccount: { select: { verificationStatus: true, setupStatus: true } },
    },
  });
  if (!organization) return { ready: false, blocker: 'suspended' };
  return onlinePaymentReadiness({ account: organization.paymentAccount, organizationStatus: organization.status });
}
