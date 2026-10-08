/*
 * Settings → Storefront.
 *
 * How the shop appears when someone finds or shares it — the line Google
 * shows, the share picture — and the merchant's own tracking ids. The look
 * and the front-page slides live in Online store → Customize (ROADMAP 15.1).
 */
import type { Metadata } from 'next';
import { getOrganizationContext } from '@/lib/organization';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { AccessDenied } from '@/components/layout/access-denied';
import { getStorefrontAppearance } from '@/features/settings/storefront';
import { StorefrontSettingsClient } from './_components/StorefrontSettingsClient';
import { storefrontUrlFor } from '@/lib/domains/storefront-url';

export const metadata: Metadata = { title: 'Storefront' };

export default async function StorefrontSettingsPage() {
  const ctx = await getOrganizationContext();
  const perms = ctx.membership.role.permissions;
  if (!hasPermission(perms, PERMISSIONS.SETTINGS_VIEW)) return <AccessDenied what="storefront settings" />;

  const result = await getStorefrontAppearance();
  if (!result.success) throw new Error(result.error);

  return (
    <StorefrontSettingsClient
      appearance={result.data.appearance}
      chat={result.data.chat}
      canViewMessages={hasPermission(perms, PERMISSIONS.MESSAGES_VIEW)}
      storeUrl={await storefrontUrlFor(ctx.organization.slug)}
      canManage={hasPermission(perms, PERMISSIONS.SETTINGS_EDIT)}
      canCustomize={hasPermission(perms, PERMISSIONS.STOREFRONT_DESIGN)}
    />
  );
}
