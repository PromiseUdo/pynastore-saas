import type { Metadata } from 'next';
import { getOrganizationContext } from '@/lib/organization';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { requireFeature } from '@/lib/billing/entitlements';
import { FEATURES } from '@/lib/billing/plans';
import { AccessDenied } from '@/components/layout/access-denied';
import { ProductForm } from '../_components/ProductForm';
import { loadProductFormData } from '../_components/load-form-data';

export const metadata: Metadata = { title: 'New product' };

export default async function NewProductPage() {
  await requireFeature(FEATURES.INVENTORY_MODULE);
  const ctx = await getOrganizationContext();
  const perms = ctx.membership.role.permissions;
  if (!hasPermission(perms, PERMISSIONS.INVENTORY_CREATE)) return <AccessDenied what="creating products" />;

  const data = await loadProductFormData(perms);
  return (
    <ProductForm
      product={null}
      {...data}
      can={{ save: true, createBrand: true, recordStock: hasPermission(perms, PERMISSIONS.INVENTORY_MOVEMENT_CREATE) }}
    />
  );
}
