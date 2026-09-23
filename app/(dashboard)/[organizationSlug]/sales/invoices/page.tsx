import { getOrganizationContext } from '@/lib/organization';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { requireFeature } from '@/lib/billing/entitlements';
import { FEATURES } from '@/lib/billing/plans';
import { AccessDenied } from '@/components/layout/access-denied';
import { listInvoices } from '@/features/sales/actions';
import { InvoicesPageClient } from './_components/InvoicesPageClient';

export default async function InvoicesPage() {
  await requireFeature(FEATURES.SALES_MODULE);
  const ctx = await getOrganizationContext();

  if (!hasPermission(ctx.membership.role.permissions, PERMISSIONS.SALES_VIEW)) {
    return <AccessDenied what="invoices" />;
  }

  /* Just the invoices. The customers, stores and catalogue this page used to
   * load existed only to fill a dialog's dropdowns; the create form is its
   * own page now and searches as you type. */
  const invoicesResult = await listInvoices();
  if (!invoicesResult.success) {
    throw new Error(invoicesResult.error);
  }

  return (
    <InvoicesPageClient
      invoices={invoicesResult.data}
      canCreate={hasPermission(ctx.membership.role.permissions, PERMISSIONS.SALES_INVOICE_CREATE)}
    />
  );
}
