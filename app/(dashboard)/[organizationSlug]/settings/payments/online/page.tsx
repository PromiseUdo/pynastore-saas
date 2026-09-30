/*
 * Settings → Payments → Get paid online (ROADMAP 10.2).
 *
 * Seeing it needs `settings.view`; changing it needs `settings.edit`. The bank
 * list is only fetched for someone who can change the account.
 */
import type { Metadata } from 'next';
import { getOrganizationContext } from '@/lib/organization';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { AccessDenied } from '@/components/layout/access-denied';
import { getPaymentSetup, listSettlementBanks } from '@/features/settings/payment-setup';
import { syncSubaccount } from '@/lib/payments/subaccounts';
import { isPaystackTestMode } from '@/lib/payments/paystack';
import { PaymentSetupForm } from './_components/PaymentSetupForm';

export const metadata: Metadata = { title: 'Get paid online' };

export default async function PaymentSetupPage() {
  const ctx = await getOrganizationContext();
  const perms = ctx.membership.role.permissions;
  if (!hasPermission(perms, PERMISSIONS.SETTINGS_VIEW)) return <AccessDenied what="payment settings" />;
  const canManage = hasPermission(perms, PERMISSIONS.SETTINGS_EDIT);

  await syncSubaccount(ctx.organization.id);
  const [setup, banks] = await Promise.all([getPaymentSetup(), canManage ? listSettlementBanks() : null]);
  if (!setup.success) throw new Error(setup.error);

  const account = setup.data.account;
  return (
    <PaymentSetupForm
      // A save or a review changes the record; start the form again from it.
      key={`${account?.verificationStatus ?? 'new'}-${account?.submittedAt?.toISOString() ?? ''}`}
      view={setup.data}
      banks={banks?.success ? banks.data : []}
      banksError={banks && !banks.success ? banks.error : null}
      canManage={canManage}
      testMode={isPaystackTestMode()}
    />
  );
}
