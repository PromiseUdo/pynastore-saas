/*
 * Sales → Invoices → New invoice.
 *
 * A full page, not a dialog: this form has line items, and AGENTS §4 puts
 * those on a page or a sheet. The dialog it replaces also had to be handed
 * every customer and every product in the workspace to fill its dropdowns —
 * the pickers here ask the database as you type (features/sales/lookup.ts),
 * so it stays usable at a thousand products.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { Store } from 'lucide-react';
import { getOrganizationContext } from '@/lib/organization';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { requireFeature } from '@/lib/billing/entitlements';
import { FEATURES } from '@/lib/billing/plans';
import { AccessDenied } from '@/components/layout/access-denied';
import { EmptyState } from '@/components/layout/empty-state';
import { PageHeader, PageBody } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { listWarehouses } from '@/features/inventory/actions';
import { NewInvoiceForm } from './_components/NewInvoiceForm';

export const metadata: Metadata = { title: 'New invoice' };

export default async function NewInvoicePage() {
  await requireFeature(FEATURES.SALES_MODULE);
  const ctx = await getOrganizationContext();

  if (!hasPermission(ctx.membership.role.permissions, PERMISSIONS.SALES_INVOICE_CREATE)) {
    return <AccessDenied what="creating invoices" />;
  }

  /* Stores are the one list small enough to send whole — a business has a
   * handful, and the fulfillment store decides which shelf the line items
   * are checked against. */
  const warehouses = await listWarehouses();
  const stores = warehouses.success ? warehouses.data.filter((w) => w.status === 'ACTIVE') : [];

  if (stores.length === 0) {
    return (
      <>
        <PageHeader title="New invoice" description="Bill a customer directly." />
        <PageBody>
          <EmptyState
            icon={Store}
            title="Add a store first"
            description="An invoice is fulfilled from a particular store, so there needs to be at least one."
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

  return (
    <NewInvoiceForm
      stores={stores.map((s) => ({ id: s.id, name: s.name }))}
      currency={ctx.organization.currency}
    />
  );
}
