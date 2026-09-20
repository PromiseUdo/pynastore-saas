import Link from 'next/link';
import { FileText, Receipt, AlertCircle, Users } from 'lucide-react';
import { requireFeature } from '@/lib/billing/entitlements';
import { FEATURES } from '@/lib/billing/plans';
import { getOrganizationContext } from '@/lib/organization';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { listQuotes, listInvoices, listCustomers } from '@/features/sales/actions';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';

function formatMoney(amount: number): string {
  return new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 }).format(amount);
}

export default async function SalesDashboardPage() {
  await requireFeature(FEATURES.SALES_MODULE);
  const ctx = await getOrganizationContext();

  if (!hasPermission(ctx.membership.role.permissions, PERMISSIONS.SALES_VIEW)) {
    return (
      <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
        <h2 className="text-base font-semibold text-foreground">Access denied</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          You don&apos;t have permission to view sales.
        </p>
      </div>
    );
  }

  const [quotesResult, invoicesResult, customersResult] = await Promise.all([
    listQuotes(),
    listInvoices(),
    listCustomers(),
  ]);

  const quotes = quotesResult.success ? quotesResult.data : [];
  const invoices = invoicesResult.success ? invoicesResult.data : [];
  const customerCount = customersResult.success ? customersResult.data.length : 0;

  const openQuoteCount = quotes.filter((q) => q.status === 'DRAFT' || q.status === 'SENT').length;
  const unpaidTotal = invoices
    .filter((inv) => inv.status === 'SENT' || inv.status === 'PARTIALLY_PAID')
    .reduce((sum, inv) => sum + (inv.totalAmount - inv.paidAmount), 0);
  const overdueCount = invoices.filter((inv) => inv.isOverdue).length;

  return (
    <div className="space-y-6 px-6 py-6">
      <div>
        <h1 className="text-lg font-semibold tracking-tight text-foreground">Sales</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">Customers, quotes, and invoices.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <Link href="/sales/quotes">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Open quotes</CardTitle>
                <p className="mt-1 text-2xl font-semibold text-foreground">{openQuoteCount}</p>
              </div>
              <FileText className="size-5 text-muted-foreground" />
            </CardHeader>
          </Card>
        </Link>
        <Link href="/sales/invoices">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Unpaid total</CardTitle>
                <p className="mt-1 text-2xl font-semibold text-foreground">{formatMoney(unpaidTotal)}</p>
              </div>
              <Receipt className="size-5 text-muted-foreground" />
            </CardHeader>
          </Card>
        </Link>
        <Link href="/sales/invoices">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Overdue invoices</CardTitle>
                <p className="mt-1 text-2xl font-semibold text-foreground">{overdueCount}</p>
              </div>
              <AlertCircle className="size-5 text-muted-foreground" />
            </CardHeader>
          </Card>
        </Link>
        <Link href="/sales/customers">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Customers</CardTitle>
                <p className="mt-1 text-2xl font-semibold text-foreground">{customerCount}</p>
              </div>
              <Users className="size-5 text-muted-foreground" />
            </CardHeader>
          </Card>
        </Link>
      </div>
    </div>
  );
}
