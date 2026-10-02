/*
 * lib/payments/online-readiness.ts
 *
 * Whether a shop may take online payments right now, read from the database.
 * Server only. The rule itself is pure and lives in ./payment-setup.ts
 * (`onlinePaymentReadiness`) so it can be tested without a database.
 */
import { prisma } from '@/lib/prisma';
import { onlinePaymentReadiness, type OnlinePaymentBlocker } from './payment-setup';
import { subaccountMatchesMode } from './subaccounts';

export async function getOnlinePaymentReadiness(
  organizationId: string,
): Promise<{ ready: boolean; blocker: OnlinePaymentBlocker | null }> {
  const organization = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: {
      status: true,
      paymentAccount: { select: { verificationStatus: true, setupStatus: true, paystackSubaccountCode: true, paystackSubaccountMode: true } },
    },
  });
  if (!organization) return { ready: false, blocker: 'suspended' };
  const account = organization.paymentAccount;
  return onlinePaymentReadiness({
    // A subaccount from the other Paystack mode isn't set up, whatever its status says (13.9).
    account: account && { ...account, setupStatus: account.setupStatus === 'ACTIVE' && !subaccountMatchesMode(account) ? 'NOT_STARTED' : account.setupStatus },
    organizationStatus: organization.status,
  });
}
