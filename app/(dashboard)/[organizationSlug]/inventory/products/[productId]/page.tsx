import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getOrganizationContext } from '@/lib/organization';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { getOrganizationEntitlements, hasFeature, requireFeature } from '@/lib/billing/entitlements';
import { FEATURES } from '@/lib/billing/plans';
import { AccessDenied } from '@/components/layout/access-denied';
import { getProduct, getProductImageSearchStatus } from '@/features/inventory/actions';
import { ProductForm } from '../_components/ProductForm';
import { loadProductFormData } from '../_components/load-form-data';

type Props = { params: Promise<{ productId: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { productId } = await params;
  const result = await getProduct(productId);
  return { title: result.success ? result.data.name : 'Product' };
}

export default async function ProductPage({ params }: Props) {
  await requireFeature(FEATURES.INVENTORY_MODULE);
  const ctx = await getOrganizationContext();
  const perms = ctx.membership.role.permissions;
  if (!hasPermission(perms, PERMISSIONS.INVENTORY_VIEW)) return <AccessDenied what="products" />;

  const { productId } = await params;
  // Search by photo is a plan feature (22.1): no "preparing photos" status without it.
  const imageSearchOn = hasFeature((await getOrganizationEntitlements()).plan, FEATURES.AI_SHOPPING);
  const [result, data, imageSearch] = await Promise.all([
    getProduct(productId),
    loadProductFormData(perms),
    imageSearchOn ? getProductImageSearchStatus(productId) : null,
  ]);
  if (!result.success) {
    if (result.error === 'Product not found') notFound();
    throw new Error(result.error);
  }

  return (
    <ProductForm
      key={result.data.id}
      product={result.data}
      {...data}
      imageSearch={imageSearch?.success ? imageSearch.data : null}
      can={{
        save: hasPermission(perms, PERMISSIONS.INVENTORY_EDIT),
        createBrand: hasPermission(perms, PERMISSIONS.INVENTORY_CREATE),
        recordStock: hasPermission(perms, PERMISSIONS.INVENTORY_MOVEMENT_CREATE),
      }}
    />
  );
}
