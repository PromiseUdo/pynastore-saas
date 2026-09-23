/*
 * Sales → Orders → New sale.
 *
 * Ringing up someone at the counter, or an order taken over the phone. The
 * sale is finished the moment it is saved: the goods have gone and the money
 * has usually already changed hands (features/sales/counter-sale.ts).
 *
 * A full page rather than a dialog, because it has line items (AGENTS §4).
 */
import type { Metadata } from 'next';
import { getOrganizationContext } from '@/lib/organization';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { requireFeature } from '@/lib/billing/entitlements';
import { FEATURES } from '@/lib/billing/plans';
import { AccessDenied } from '@/components/layout/access-denied';
import { EmptyState } from '@/components/layout/empty-state';
import { PageHeader, PageBody } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Store } from 'lucide-react';
import Link from 'next/link';
import { listCounterStores } from '@/features/sales/counter-sale';
import { NewSaleClient } from './_components/NewSaleClient';

export const metadata: Metadata = { title: 'New sale' };

export default async function NewSalePage() {
  await requireFeature(FEATURES.SALES_MODULE);
  const ctx = await getOrganizationContext();

  if (!hasPermission(ctx.membership.role.permissions, PERMISSIONS.SALES_ORDER_CREATE)) {
    return <AccessDenied what="recording sales" />;
  }

  const stores = await listCounterStores();
  if (!stores.success) throw new Error(stores.error);

  /* Nothing can be sold from a store that doesn't exist yet — say what has
   * to happen first rather than showing an empty picker (AGENTS §3). */
  if (stores.data.length === 0) {
    return (
      <>
        <PageHeader title="New sale" description="Ring up a sale at the counter." />
        <PageBody>
          <EmptyState
            icon={Store}
            title="Add a store first"
            description="A sale comes out of a particular store's stock, so there needs to be at least one."
            action={
              <Button asChild>
                <Link href="/inventory/warehouses">Add a store</Link>
              </Button>
            }
          />
        </PageBody>
      </>
    );
  }

  return <NewSaleClient stores={stores.data} currency={ctx.organization.currency} />;
}
