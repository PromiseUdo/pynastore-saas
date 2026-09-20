/*
 * Social Commerce → connected accounts.
 *
 * Phase 1: connecting a store's own Facebook Page and Instagram professional
 * account, seeing what's connected, and disconnecting. Posting products to
 * those accounts comes next; this page deliberately promises nothing it
 * can't do yet.
 *
 * Available on every plan — no feature gate.
 */
import type { Metadata } from 'next';
import { getOrganizationContext } from '@/lib/organization';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { AccessDenied } from '@/components/layout/access-denied';
import { getSocialOverview } from '@/features/social/actions';
import { SocialPageClient } from './_components/SocialPageClient';

export const metadata: Metadata = { title: 'Social accounts' };

export default async function SocialPage({
  searchParams,
}: {
  searchParams: Promise<{ social_error?: string; connected?: string }>;
}) {
  const ctx = await getOrganizationContext();
  const perms = ctx.membership.role.permissions;
  if (!hasPermission(perms, PERMISSIONS.SOCIAL_VIEW)) return <AccessDenied what="social accounts" />;

  const result = await getSocialOverview();
  if (!result.success) throw new Error(result.error);

  const { social_error: socialError } = await searchParams;

  return (
    <SocialPageClient
      accounts={result.data.accounts}
      providers={result.data.providers}
      canManage={hasPermission(perms, PERMISSIONS.SOCIAL_MANAGE)}
      connectError={socialError ?? null}
    />
  );
}
