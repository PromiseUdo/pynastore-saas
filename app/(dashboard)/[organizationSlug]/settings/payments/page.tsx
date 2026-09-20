/*
 * Settings → Payments.
 *
 * How the merchant's customers can pay, and the bank accounts behind the
 * "Bank transfer" option. Online payment and pay on delivery need no setup;
 * bank transfer appears at checkout as soon as there is an active account here.
 */
import type { Metadata } from 'next';
import { getOrganizationContext } from '@/lib/organization';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { AccessDenied } from '@/components/layout/access-denied';
import { listBankAccounts } from '@/features/settings/bank-accounts';
import { TRANSFER_HOLD_HOURS } from '@/lib/storefront/mock/checkout';
import { PaymentSettingsClient } from './_components/PaymentSettingsClient';

export const metadata: Metadata = { title: 'Payments' };

export default async function PaymentSettingsPage() {
  const ctx = await getOrganizationContext();
  const perms = ctx.membership.role.permissions;
  if (!hasPermission(perms, PERMISSIONS.SETTINGS_VIEW)) return <AccessDenied what="payment settings" />;

  const result = await listBankAccounts();
  if (!result.success) throw new Error(result.error);

  return (
    <PaymentSettingsClient
      accounts={result.data}
      canManage={hasPermission(perms, PERMISSIONS.SETTINGS_EDIT)}
      transferHoldHours={TRANSFER_HOLD_HOURS}
    />
  );
}
