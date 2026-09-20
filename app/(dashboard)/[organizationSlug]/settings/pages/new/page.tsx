/*
 * Settings → Store pages → New page (?kind=ABOUT | DELIVERY_RETURNS | …).
 *
 * A standard page the store already has opens that page instead of a second
 * copy — the store links one of each.
 */
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getOrganizationContext } from '@/lib/organization';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { getStorefrontUrl } from '@/lib/tenant/urls';
import { AccessDenied } from '@/components/layout/access-denied';
import { isStorePageKind } from '@/lib/storefront/pages/rules';
import { getStoreFacts, listStorePages } from '@/features/settings/store-pages';
import { StorePageEditor } from '../_components/StorePageEditor';

export const metadata: Metadata = { title: 'New store page' };

type Props = { searchParams: Promise<{ kind?: string }> };

export default async function NewStorePagePage({ searchParams }: Props) {
  const ctx = await getOrganizationContext();
  const perms = ctx.membership.role.permissions;
  if (!hasPermission(perms, PERMISSIONS.SETTINGS_EDIT)) return <AccessDenied what="store pages" />;

  const { kind: rawKind } = await searchParams;
  const kind = isStorePageKind(rawKind) ? rawKind : 'CUSTOM';

  const [pages, facts] = await Promise.all([
    listStorePages(),
    kind === 'DELIVERY_RETURNS' ? getStoreFacts() : null,
  ]);
  if (!pages.success) throw new Error(pages.error);

  if (kind !== 'CUSTOM') {
    const existing = pages.data.find((page) => page.kind === kind);
    if (existing) redirect(`/settings/pages/${existing.id}`);
  }

  return (
    <StorePageEditor
      page={null}
      kind={kind}
      canManage
      storeUrl={getStorefrontUrl(ctx.organization.slug, '').replace(/\/$/, '')}
      facts={facts?.success ? facts.data : null}
    />
  );
}
