/*
 * Inventory → Products → Import from a spreadsheet (ROADMAP 14.2).
 * Choose a CSV, see what will happen, then import.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { getOrganizationContext } from '@/lib/organization';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { requireFeature } from '@/lib/billing/entitlements';
import { FEATURES } from '@/lib/billing/plans';
import { prisma } from '@/lib/prisma';
import { storeScopeWhere } from '@/lib/store-access';
import { AccessDenied } from '@/components/layout/access-denied';
import { PageBody } from '@/components/layout/page-header';
import { ImportClient } from './ImportClient';

export const metadata: Metadata = { title: 'Import products' };

export default async function ImportProductsPage() {
  await requireFeature(FEATURES.INVENTORY_MODULE);
  const ctx = await getOrganizationContext();
  const perms = ctx.membership.role.permissions;
  if (!hasPermission(perms, PERMISSIONS.INVENTORY_CREATE)) return <AccessDenied what="importing products" />;

  const canRecordStock = hasPermission(perms, PERMISSIONS.INVENTORY_MOVEMENT_CREATE);
  // The template has a stock column for each store this member may stock.
  const stores = canRecordStock
    ? await prisma.warehouse.findMany({
        where: { organizationId: ctx.organization.id, status: 'ACTIVE', ...storeScopeWhere(ctx.membership) },
        orderBy: [{ createdAt: 'asc' }],
        select: { name: true },
      })
    : [];

  return (
    <>
      <div className="border-b bg-background px-4 py-4 sm:px-6">
        <Link href="/inventory/products" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3" aria-hidden /> Products
        </Link>
        <h1 className="mt-1 text-lg font-semibold tracking-tight text-foreground">Import products</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Add many products at once from a spreadsheet — with their variants and the stock you have in each store.
        </p>
      </div>
      <PageBody>
        <ImportClient storeNames={stores.map((s) => s.name)} canRecordStock={canRecordStock} />
      </PageBody>
    </>
  );
}
