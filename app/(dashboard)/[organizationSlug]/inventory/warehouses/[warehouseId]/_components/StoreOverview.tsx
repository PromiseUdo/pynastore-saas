import Link from 'next/link';
import { AlertTriangle, ArrowUpRight, Boxes, ClipboardList, Layers, PackageX, Truck, Wallet } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/layout/empty-state';
import { StatCard, StatGrid } from '@/components/dashboard/stat-card';
import { formatDate, formatMoney, formatNumber } from '@/lib/format';
import { MOVEMENT_LABEL, MOVEMENT_VARIANT, movementSign } from '@/lib/inventory-labels';
import type { MovementType } from '@/lib/generated/prisma/enums';
import type { StoreActivityRow, StoreDetail, StoreInventoryRow, StoreTransferRow } from '@/features/inventory/actions';
import type { StoreSalesFigures } from '@/features/sales/store-sales';

/** One thing that needs a person's attention here, with the page that fixes it. */
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

function Section({
  title,
  description,
  href,
  children,
}: {
  title: string;
  description?: string;
  href?: { label: string; url: string };
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border bg-card shadow-xs">
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
        </div>
        {href && (
          <Link href={href.url} className="flex shrink-0 items-center gap-1 text-xs font-medium text-primary hover:underline">
            {href.label} <ArrowUpRight className="size-3" />
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

/**
 * What this store holds and what it is waiting on. Sales and orders for a
 * store arrive in ROADMAP Phase 8.5 — the only money here is what the stock on
 * the shelf cost, which is the same figure the valuation report shows.
 */
export function StoreOverview({
  store,
  activity,
  transfers,
  runningLow,
  restock,
  sales,
}: {
  store: StoreDetail;
  activity: StoreActivityRow[];
  transfers: StoreTransferRow[];
  /** The few products with the least available here, worst first. */
  runningLow: StoreInventoryRow[];
  /** Where "order more" goes, and what to call it on this plan. */
  restock: { href: string; label: string; upgradeHint: boolean } | null;
  /** This month's takings, or null for a member who may not see sales. */
  sales: { figures: StoreSalesFigures; monthLabel: string; comparisonHref: string | null } | null;
}) {
  const base = `/inventory/warehouses/${store.id}`;
  const incoming = transfers.filter((t) => t.direction === 'in');
  const needsAttention = store.lowStockCount > 0 || store.outOfStockCount > 0 || incoming.length > 0 || store.openCycleCounts > 0;

  return (
    <>
      <StatGrid>
        <Link href={`${base}?tab=inventory`} className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <StatCard title="Products" value={formatNumber(store.productCount)} description="stocked at this store" icon={Boxes} />
        </Link>
        <Link href={`${base}?tab=inventory&sort=stock-desc`} className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <StatCard
            title="Units in stock"
            value={formatNumber(store.unitsOnHand)}
            description={store.unitsHeld > 0 ? `${formatNumber(store.unitsHeld)} held for orders` : 'none held for orders'}
            icon={Layers}
          />
        </Link>
        <Link href={`${base}?tab=inventory&stock=low`} className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <StatCard
            title="Low stock"
            value={formatNumber(store.lowStockCount)}
            description="at or below the reorder point"
            icon={PackageX}
          />
        </Link>
        <Link href={`${base}?tab=inventory&stock=out`} className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <StatCard
            title="Out of stock"
            value={formatNumber(store.outOfStockCount)}
            description="nothing left to sell here"
            icon={AlertTriangle}
          />
        </Link>
      </StatGrid>

      <StatGrid className="lg:grid-cols-2">
        <Link href="/inventory/reports?view=valuation" className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <StatCard title="Stock value here" value={formatMoney(store.stockValue)} description="what it cost, at average cost" icon={Wallet} />
        </Link>
        <Link href="/inventory/transfers" className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <StatCard
            title="Transfers in progress"
            value={formatNumber(store.transfersIncoming + store.transfersOutgoing)}
            description={
              store.transfersIncoming + store.transfersOutgoing === 0
                ? 'nothing moving in or out'
                : `${formatNumber(store.transfersIncoming)} coming in · ${formatNumber(store.transfersOutgoing)} going out`
            }
            icon={Truck}
          />
        </Link>
      </StatGrid>

      {needsAttention && (
        <Section title="Needs attention">
          <ul className="divide-y">
            {store.lowStockCount > 0 && (
              <AttentionRow icon={PackageX} href={restock?.href ?? `${base}?tab=inventory&stock=low`} cta={restock?.label ?? "See what's low"}>
                <span className="font-medium">{formatNumber(store.lowStockCount)}</span> product
                {store.lowStockCount === 1 ? ' is' : 's are'} at or below the reorder point at this store.
              </AttentionRow>
            )}
            {store.outOfStockCount > 0 && (
              <AttentionRow icon={AlertTriangle} href={`${base}?tab=inventory&stock=out`} cta="See what's finished">
                <span className="font-medium">{formatNumber(store.outOfStockCount)}</span> product
                {store.outOfStockCount === 1 ? ' has' : 's have'} nothing available here — another store may still have some.
              </AttentionRow>
            )}
            {incoming.length > 0 && (
              <AttentionRow icon={Truck} href="/inventory/transfers" cta="Receive transfers">
                <span className="font-medium">{formatNumber(incoming.length)}</span> transfer
                {incoming.length === 1 ? ' is' : 's are'} on the way here, waiting to be received. The stock only counts once you receive it.
              </AttentionRow>
            )}
            {store.openCycleCounts > 0 && (
              <AttentionRow icon={ClipboardList} href="/inventory/cycle-counts" cta="Finish counting">
                <span className="font-medium">{formatNumber(store.openCycleCounts)}</span> stock count
                {store.openCycleCounts === 1 ? ' is' : 's are'} still open at this store.
              </AttentionRow>
            )}
          </ul>
        </Section>
      )}

      {sales && (
        <section className="rounded-lg border bg-card shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Sold from here in {sales.monthLabel}</h2>
              {/* What the number is, and what it can't tell you (AGENTS §10). */}
              <p className="mt-0.5 text-xs text-muted-foreground">
                Goods that left this store&apos;s shelf, at the price the customer paid. Delivery and discount codes belong to the whole
                order, so they are left out — and returns are not deducted.
              </p>
            </div>
            {sales.comparisonHref && (
              <Link href={sales.comparisonHref} className="flex shrink-0 items-center gap-1 text-xs font-medium text-primary hover:underline">
                Compare your stores <ArrowUpRight className="size-3" />
              </Link>
            )}
          </div>
          <dl className="grid grid-cols-1 divide-y sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            <div className="px-4 py-3">
              <dt className="text-sm font-medium text-muted-foreground">Sales</dt>
              <dd className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{formatMoney(sales.figures.goodsValue)}</dd>
              <dd className="mt-0.5 text-xs text-muted-foreground">
                {sales.figures.counterValue > 0 && sales.figures.onlineValue > 0
                  ? `${formatMoney(sales.figures.counterValue)} over the counter · ${formatMoney(sales.figures.onlineValue)} online`
                  : sales.figures.counterValue > 0
                    ? 'all over the counter'
                    : sales.figures.onlineValue > 0
                      ? 'all from the website'
                      : 'nothing yet this month'}
              </dd>
            </div>
            <div className="px-4 py-3">
              <dt className="text-sm font-medium text-muted-foreground">Orders</dt>
              <dd className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{formatNumber(sales.figures.orderCount)}</dd>
              <dd className="mt-0.5 text-xs text-muted-foreground">
                {sales.figures.orderCount === 0 ? 'none yet this month' : 'orders this store helped fill'}
              </dd>
            </div>
            <div className="px-4 py-3">
              <dt className="text-sm font-medium text-muted-foreground">Units sold</dt>
              <dd className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{formatNumber(sales.figures.unitsSold)}</dd>
              <dd className="mt-0.5 text-xs text-muted-foreground">off this store&apos;s shelf</dd>
            </div>
          </dl>
        </section>
      )}

      {runningLow.length > 0 && (
        <Section
          title={`Running low at ${store.name}`}
          description="What this store has least of, worst first. The reorder point is the one in force here."
          href={{ label: 'See all', url: `${base}?tab=inventory&stock=low` }}
        >
          <ul className="divide-y">
            {runningLow.map((row) => (
              <li key={row.itemId} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                <div className="min-w-0">
                  <Link href={`/inventory/products/${row.productId}`} className="truncate font-medium text-foreground hover:underline">
                    {row.name}
                    {row.variantName && <span className="text-muted-foreground"> · {row.variantName}</span>}
                  </Link>
                  <p className="truncate text-xs text-muted-foreground">
                    {formatNumber(row.available)} available
                    {row.reorderPoint === null ? (
                      <> · no reorder point set here</>
                    ) : (
                      <>
                        {' '}
                        · reorder at {formatNumber(row.reorderPoint)}{' '}
                        {row.reorderPointSource === 'store' ? '(set for this store)' : '(set on the product)'}
                      </>
                    )}
                    {row.reorderQty !== null && <> · bring in {formatNumber(row.reorderQty)}</>}
                  </p>
                </div>
                <Badge variant={row.stockState === 'out' ? 'destructive' : 'warning'} className="shrink-0">
                  {row.stockState === 'out' ? 'Out of stock' : 'Low'}
                </Badge>
              </li>
            ))}
          </ul>
          {restock && (
            <div className="flex flex-col gap-1 border-t px-4 py-3">
              <Link href={restock.href} className="text-sm font-medium text-primary hover:underline">
                {restock.label} →
              </Link>
              {restock.upgradeHint && (
                <p className="text-xs text-muted-foreground">
                  Automatic restocking suggestions, grouped by supplier, are on Pro.{' '}
                  <Link href="/upgrade" className="text-primary hover:underline">
                    See plans
                  </Link>
                </p>
              )}
            </div>
          )}
        </Section>
      )}

      {transfers.length > 0 && (
        <Section
          title="Stock on the move"
          description="Sent, and not yet received. Oldest first."
          href={{ label: 'All transfers', url: '/inventory/transfers' }}
        >
          <ul className="divide-y">
            {transfers.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium text-foreground">{t.itemName}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {t.direction === 'in' ? `From ${t.otherStoreName}` : `To ${t.otherStoreName}`} · sent {formatDate(t.dispatchedAt)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge variant={t.direction === 'in' ? 'info' : 'warning'}>{t.direction === 'in' ? 'Coming in' : 'Going out'}</Badge>
                  <span className="w-14 text-right text-xs tabular-nums text-muted-foreground">{formatNumber(t.quantity)}</span>
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section
        title="Recent activity here"
        description="The last changes to this store's stock."
        href={{ label: 'All movements', url: `/inventory/movements?store=${store.id}` }}
      >
        {activity.length === 0 ? (
          <EmptyState
            className="m-4 border-0"
            title="Nothing has moved here yet"
            description="Receiving a purchase order, selling at the counter or counting stock at this store will show up here."
          />
        ) : (
          <ul className="divide-y">
            {activity.map((m) => {
              const type = m.type as MovementType;
              return (
                <li key={m.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-foreground">{m.itemName}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {m.otherStoreName ? `${m.incoming ? 'From' : 'To'} ${m.otherStoreName} · ` : ''}
                      {formatDate(m.createdAt)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge variant={MOVEMENT_VARIANT[type]}>{MOVEMENT_LABEL[type]}</Badge>
                    <span className="w-14 text-right text-xs tabular-nums text-muted-foreground">
                      {m.incoming ? '+' : movementSign(type)}
                      {formatNumber(m.quantity)}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </>
  );
}
