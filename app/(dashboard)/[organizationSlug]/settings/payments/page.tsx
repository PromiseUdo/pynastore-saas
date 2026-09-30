/*
 * Settings → Payments.
 *
 * How the merchant's customers can pay, the "Get paid online" setup
 * (ROADMAP 10.2, its own page under ./online), and the bank accounts behind
 * the "Bank transfer" option. Online payment and pay on delivery need no setup;
 * bank transfer appears at checkout as soon as there is an active account here.
 */
import type { Metadata } from 'next';
import { getOrganizationContext } from '@/lib/organization';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { AccessDenied } from '@/components/layout/access-denied';
import { listBankAccounts } from '@/features/settings/bank-accounts';
import { getPaymentSetup, listSettlementBanks } from '@/features/settings/payment-setup';
import { isPaystackTestMode } from '@/lib/payments/paystack';
import { syncSubaccount } from '@/lib/payments/subaccounts';
import { paymentSetupState, requiredDocuments, setupChecklist } from '@/lib/payments/payment-setup';
import { TRANSFER_HOLD_HOURS } from '@/lib/storefront/orders/holds';
import { PaymentSettingsClient } from './_components/PaymentSettingsClient';

export const metadata: Metadata = { title: 'Payments' };

export default async function PaymentSettingsPage() {
  const ctx = await getOrganizationContext();
  const perms = ctx.membership.role.permissions;
  if (!hasPermission(perms, PERMISSIONS.SETTINGS_VIEW)) return <AccessDenied what="payment settings" />;

  // Paystack sends no subaccount webhooks: a stale copy is refreshed here,
  // so a subaccount Paystack switched off shows as such (ROADMAP 10.3).
  await syncSubaccount(ctx.organization.id);
  const canManage = hasPermission(perms, PERMISSIONS.SETTINGS_EDIT);
  const [result, setup, banks] = await Promise.all([
    listBankAccounts(),
    getPaymentSetup(),
    // Only someone who can add an account needs the bank list.
    canManage ? listSettlementBanks() : null,
  ]);
  if (!result.success) throw new Error(result.error);
  if (!setup.success) throw new Error(setup.error);

  const account = setup.data.account;
  const checklist = account
    ? setupChecklist({
        ...account,
        documents: account.documents.filter((d) => requiredDocuments(account.businessType).includes(d.kind)),
      })
    : null;

  return (
    <PaymentSettingsClient
      accounts={result.data}
      canManage={canManage}
      banks={banks?.success ? banks.data : []}
      banksError={banks && !banks.success ? banks.error : null}
      testMode={isPaystackTestMode()}
      transferHoldHours={TRANSFER_HOLD_HOURS}
      onlineSetup={{
        state: paymentSetupState(account),
        done: checklist?.filter((i) => i.done).length ?? 0,
        total: checklist?.length ?? 0,
        settlement: account?.settlementAccountName
          ? { bankName: account.settlementBankName, accountNumber: account.settlementAccountNumber, accountName: account.settlementAccountName }
          : null,
      }}
    />
  );
}
