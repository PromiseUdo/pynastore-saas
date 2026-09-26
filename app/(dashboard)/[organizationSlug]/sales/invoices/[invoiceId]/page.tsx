import { notFound } from 'next/navigation';
import { getOrganizationContext } from '@/lib/organization';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { AccessDenied } from '@/components/layout/access-denied';
import { requireFeature } from '@/lib/billing/entitlements';
import { FEATURES } from '@/lib/billing/plans';
import { getInvoice } from '@/features/sales/actions';
import { InvoiceDetailClient } from './_components/InvoiceDetailClient';

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ invoiceId: string }>;
}) {
  await requireFeature(FEATURES.SALES_MODULE);
  const ctx = await getOrganizationContext();
  const { invoiceId } = await params;

  if (!hasPermission(ctx.membership.role.permissions, PERMISSIONS.SALES_VIEW)) {
    return <AccessDenied what="this invoice" />;
  }

  const result = await getInvoice(invoiceId);
  if (!result.success) {
    notFound();
  }

  return (
    <InvoiceDetailClient
      invoice={result.data}
      can={{
        edit: hasPermission(ctx.membership.role.permissions, PERMISSIONS.SALES_INVOICE_EDIT),
        void: hasPermission(ctx.membership.role.permissions, PERMISSIONS.SALES_INVOICE_VOID),
        return: hasPermission(ctx.membership.role.permissions, PERMISSIONS.SALES_RETURN_MANAGE),
      }}
    />
  );
}
