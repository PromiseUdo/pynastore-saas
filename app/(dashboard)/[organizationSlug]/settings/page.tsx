/*
 * Settings → General.
 *
 * The business's own details: what it's called, its logo, how customers reach
 * it, and the currency every amount in the workspace is written in.
 */
import type { Metadata } from 'next';
import { getOrganizationContext } from '@/lib/organization';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { AccessDenied } from '@/components/layout/access-denied';
import { getOrganizationSettings } from '@/features/settings/organization';
import { SUPPORTED_CURRENCIES } from '@/lib/currencies';
import { getStorefrontUrl } from '@/lib/tenant/urls';
import { GeneralSettingsClient } from './_components/GeneralSettingsClient';

export const metadata: Metadata = { title: 'General' };

export default async function GeneralSettingsPage() {
  const ctx = await getOrganizationContext();
  const perms = ctx.membership.role.permissions;
  if (!hasPermission(perms, PERMISSIONS.SETTINGS_VIEW)) return <AccessDenied what="these settings" />;

  const result = await getOrganizationSettings();
  if (!result.success) throw new Error(result.error);

  return (
    <GeneralSettingsClient
      settings={result.data}
      canManage={hasPermission(perms, PERMISSIONS.SETTINGS_EDIT)}
      storeUrl={getStorefrontUrl(result.data.slug)}
      currencies={[...SUPPORTED_CURRENCIES]}
    />
  );
}
