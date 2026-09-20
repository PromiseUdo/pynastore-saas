import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getOrganizationContext } from '@/lib/organization';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { getStorefrontUrl } from '@/lib/tenant/urls';
import { AccessDenied } from '@/components/layout/access-denied';
import { getStoreFacts, getStorePageForEdit } from '@/features/settings/store-pages';
import { StorePageEditor } from '../_components/StorePageEditor';

type Props = { params: Promise<{ pageId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { pageId } = await params;
  const result = await getStorePageForEdit(pageId);
  return { title: result.success && result.data ? result.data.title : 'Store page' };
}

export default async function StorePageEditPage({ params }: Props) {
  const ctx = await getOrganizationContext();
  const perms = ctx.membership.role.permissions;
  if (!hasPermission(perms, PERMISSIONS.SETTINGS_VIEW)) return <AccessDenied what="store pages" />;

  const { pageId } = await params;
  const result = await getStorePageForEdit(pageId);
  if (!result.success) throw new Error(result.error);
  if (!result.data) notFound();
  const page = result.data;

  const facts = page.kind === 'DELIVERY_RETURNS' ? await getStoreFacts() : null;

  return (
    <StorePageEditor
      key={page.id}
      page={page}
      kind={page.kind}
      canManage={hasPermission(perms, PERMISSIONS.SETTINGS_EDIT)}
      storeUrl={getStorefrontUrl(ctx.organization.slug, '').replace(/\/$/, '')}
      facts={facts?.success ? facts.data : null}
    />
  );
}
