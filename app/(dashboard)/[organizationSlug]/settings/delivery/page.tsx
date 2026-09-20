/*
 * Settings → Delivery.
 *
 * Where the merchant delivers in Nigeria, what each option costs and how long
 * it takes, and where customers can collect. Checkout quotes from exactly this
 * for each customer's address (lib/storefront/delivery/). Also the return
 * window, which the product page quotes and the account page enforces.
 */
import type { Metadata } from 'next';
import { getOrganizationContext } from '@/lib/organization';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { AccessDenied } from '@/components/layout/access-denied';
import { getDeliverySettings } from '@/features/settings/delivery';
import { DeliverySettingsClient } from './_components/DeliverySettingsClient';

export const metadata: Metadata = { title: 'Delivery and returns' };

export default async function DeliverySettingsPage() {
  const ctx = await getOrganizationContext();
  const perms = ctx.membership.role.permissions;
  if (!hasPermission(perms, PERMISSIONS.SETTINGS_VIEW)) return <AccessDenied what="delivery and returns settings" />;

  const result = await getDeliverySettings();
  if (!result.success) throw new Error(result.error);

  return <DeliverySettingsClient settings={result.data} canManage={hasPermission(perms, PERMISSIONS.SETTINGS_EDIT)} />;
}
