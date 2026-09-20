import type { Metadata } from 'next';
import Link from 'next/link';
import { AlertTriangle, ArrowUpRight, Boxes, ClipboardList, MapPin, PackageX, Truck, Wallet } from 'lucide-react';
import { requireFeature } from '@/lib/billing/entitlements';
import { FEATURES } from '@/lib/billing/plans';
import { getOrganizationContext } from '@/lib/organization';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import {
  getLowStockReport,
  getPutawayQueue,
  getStockMovements,
  getStockValuationReport,
  listCycleCounts,
  listProducts,
  listTransfers,
} from '@/features/inventory/actions';
import { AccessDenied } from '@/components/layout/access-denied';
import { PageHeader, PageBody } from '@/components/layout/page-header';
import { EmptyState } from '@/components/layout/empty-state';
import { StatCard, StatGrid } from '@/components/dashboard/stat-card';
import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button-variants';
import { formatDate, formatMoney, formatNumber } from '@/lib/format';

export const metadata: Metadata = { title: 'Inventory' };

/** One thing that needs a person's attention, with the page that fixes it. */
function AttentionRow({
  icon: Icon,
  children,
  href,
  cta,
}: {
  icon: React.ElementType;
  children: React.ReactNode;
  href: string;
  cta: string;
}) {
  return (
    <li className="flex flex-col gap-2 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
      <span className="flex items-start gap-2.5 text-foreground">
        <Icon className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <span>{children}</span>
      </span>
      <Link href={href} className="shrink-0 text-sm font-medium text-primary hover:underline">
        {cta} →
      </Link>
    </li>
  );
}

export default async function InventoryDashboardPage() {
  await requireFeature(FEATURES.INVENTORY_MODULE);
  const ctx = await getOrganizationContext();
  if (!hasPermission(ctx.membership.role.permissions, PERMISSIONS.INVENTORY_VIEW)) {
    return <AccessDenied what="inventory" />;
  }

  const [valuation, lowStock, movements, products, putaway, transfers, counts] = await Promise.all([
    getStockValuationReport(),
    getLowStockReport(),
    getStockMovements({ perPage: 8 }),
    listProducts({ perPage: 1 }),
    getPutawayQueue(),
    listTransfers(),
    listCycleCounts(),
  ]);

  const totalValue = valuation.success ? valuation.data.totalValue : 0;
  const productCount = products.success ? products.data.catalogSize : 0;
  const lowStockRows = lowStock.success ? lowStock.data : [];
  const outOfStock = lowStockRows.filter((r) => r.quantity <= 0).length;
  const unlocated = putaway.success ? putaway.data.filter((r) => !r.location).length : 0;
  const inTransit = transfers.success ? transfers.data.filter((t) => t.status === 'DISPATCHED') : [];
  const openCounts = counts.success ? counts.data.filter((c) => c.status === 'OPEN') : [];
  const recent = movements.success ? movements.data.rows : [];

  const attention =
    lowStockRows.length > 0 || unlocated > 0 || inTransit.length > 0 || openCounts.length > 0;

  return (
    <>
      <PageHeader
        title="Inventory"
        description="What you have, where it is, and what needs attention today."
        actions={
          <Link href="/inventory/products" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
            View products
          </Link>
        }
      />

      <PageBody className="space-y-6">
        <StatGrid>
          <Link href="/inventory/products" className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <StatCard title="Products" value={formatNumber(productCount)} description="in your catalog" icon={Boxes} />
          </Link>
          <Link href="/inventory/reports?view=valuation" className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <StatCard title="Stock value" value={formatMoney(totalValue)} description="at average cost" icon={Wallet} />
          </Link>
          <Link href="/inventory/reports?view=low-stock" className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <StatCard
              title="Low stock"
              value={formatNumber(lowStockRows.length)}
              description="at or below reorder point"
              icon={PackageX}
            />
          </Link>
          <Link href="/inventory/products?stock=out" className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <StatCard title="Out of stock" value={formatNumber(outOfStock)} description="nothing left to sell" icon={AlertTriangle} />
          </Link>
        </StatGrid>

        {attention && (
          <section className="rounded-lg border bg-card shadow-xs">
            <div className="border-b px-4 py-3">
              <h2 className="text-sm font-semibold text-foreground">Needs attention</h2>
            </div>
            <ul className="divide-y">
              {lowStockRows.length > 0 && (
                <AttentionRow icon={PackageX} href="/procurement/reorder" cta="Review restocking">
                  <span className="font-medium">{formatNumber(lowStockRows.length)}</span> item
                  {lowStockRows.length === 1 ? ' is' : 's are'} at or below their reorder point
                  {outOfStock > 0 && <> — {formatNumber(outOfStock)} already out of stock</>}.
                </AttentionRow>
              )}
              {inTransit.length > 0 && (
                <AttentionRow icon={Truck} href="/inventory/transfers" cta="Receive transfers">
                  <span className="font-medium">{formatNumber(inTransit.length)}</span> transfer
                  {inTransit.length === 1 ? '' : 's'} on the way between stores, waiting to be received.
                </AttentionRow>
              )}
              {openCounts.length > 0 && (
                <AttentionRow icon={ClipboardList} href="/inventory/cycle-counts" cta="Finish counting">
                  <span className="font-medium">{formatNumber(openCounts.length)}</span> stock count
                  {openCounts.length === 1 ? '' : 's'} still open.
                </AttentionRow>
              )}
              {unlocated > 0 && (
                <AttentionRow icon={MapPin} href="/inventory/putaway" cta="Set locations">
                  <span className="font-medium">{formatNumber(unlocated)}</span> item
                  {unlocated === 1 ? '' : 's'} have no shelf location, so pickers have to search for them.
                </AttentionRow>
              )}
            </ul>
          </section>
        )}

        <section className="rounded-lg border bg-card shadow-xs">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Recent stock movements</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">The last few changes to your stock.</p>
            </div>
            <Link href="/inventory/movements" className="flex items-center gap-1 text-xs font-medium text-primary hover:underline">
              View all <ArrowUpRight className="size-3" />
            </Link>
          </div>
          {recent.length === 0 ? (
            <EmptyState
              className="m-4 border-0"
              title="Nothing has moved yet"
              description="Receiving a purchase order, packing an order or counting stock will show up here."
            />
          ) : (
            <ul className="divide-y">
              {recent.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-foreground">{m.itemName}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {m.warehouseName}
                      {m.toWarehouseName ? ` → ${m.toWarehouseName}` : ''} · {formatDate(m.createdAt)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge variant={m.type === 'OUT' ? 'destructive' : m.type === 'IN' ? 'success' : 'info'}>
                      {m.type === 'IN' ? 'Stock in' : m.type === 'OUT' ? 'Stock out' : m.type === 'TRANSFER' ? 'Transfer' : 'Adjustment'}
                    </Badge>
                    <span className="w-14 text-right text-xs tabular-nums text-muted-foreground">{formatNumber(m.quantity)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </PageBody>
    </>
  );
}
