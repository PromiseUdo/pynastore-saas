'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowLeft, ArrowLeftRight, Globe, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import { Badge } from '@/components/ui/badge';
import { PageTabs, type PageTab } from '@/components/layout/page-tabs';
import { SwitchRoot } from '@/components/ui/switch';
import { setWarehouseSellsOnline, type StoreDetail, type WarehouseRow } from '@/features/inventory/actions';
import { StoreDialog } from '../../_components/StoreDialog';

/* Orders are only offered to someone who may see sales — the tab would
   otherwise lead to an access-denied page of its own (AGENTS §7). */
function tabsFor(showOrders: boolean): PageTab[] {
  return [
    { key: 'overview', label: 'Overview' },
    { key: 'inventory', label: 'Inventory' },
    ...(showOrders ? [{ key: 'orders', label: 'Orders' }] : []),
  ];
}

/**
 * The store's own header: where it sits, what it is, and the two things a
 * merchant changes from here — its details and whether the website sells its
 * stock. The tab lives in the URL so a refresh keeps the view (AGENTS §3).
 */
export function StoreHeader({
  store,
  tab,
  canEdit,
  showOrders,
}: {
  store: StoreDetail;
  tab: string;
  canEdit: boolean;
  showOrders: boolean;
}) {
  const router = useRouter();
  const [editOpen, setEditOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const closed = store.status !== 'ACTIVE';

  // The dialog edits a store as the list shows it; itemCount is only its subtitle there.
  const asRow: WarehouseRow = {
    id: store.id,
    name: store.name,
    location: store.location,
    status: store.status,
    sellsOnline: store.sellsOnline,
    itemCount: store.productCount,
    canWorkHere: store.canWorkHere,
  };

  async function toggleOnline(sellsOnline: boolean) {
    setBusy(true);
    const result = await setWarehouseSellsOnline(store.id, sellsOnline);
    setBusy(false);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success(
      sellsOnline ? `Your online store now sells stock from ${store.name}` : `${store.name} no longer supplies your online store`,
    );
    router.refresh();
  }

  return (
    <>
      {/* pb-2.5 is what PageTabs' `-mb-2.5` pulls back, so the active tab's
        * underline sits on this header's bottom border. */}
      <div className="border-b bg-background px-4 pb-2.5 pt-4 sm:px-6">
        <Link href="/inventory/warehouses" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3" /> Stores
        </Link>
        <div className="mt-1 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h1 className="truncate text-lg font-semibold tracking-tight text-foreground">{store.name}</h1>
              <Badge variant={closed ? 'muted' : 'success'}>{closed ? 'Closed' : 'Open'}</Badge>
              {store.sellsOnline && !closed && (
                <Badge variant="info">
                  <Globe className="size-3" /> Sells online
                </Badge>
              )}
            </div>
            <p className="mt-0.5 truncate text-sm text-muted-foreground">
              {store.location ?? 'What this store holds, and what needs attention here.'}
            </p>
            {/* Hiding the buttons without saying why reads as a bug (AGENTS §7). */}
            {!store.canWorkHere && (
              <p className="mt-1 text-xs text-muted-foreground">
                You can see this store, but not change its stock. Ask an admin to add it to your stores.
              </p>
            )}
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 rounded-md border px-2.5 py-1.5">
              <span className="text-xs font-medium text-foreground">Sells online</span>
              <SwitchRoot
                checked={store.sellsOnline}
                disabled={!canEdit || busy || (closed && !store.sellsOnline)}
                onCheckedChange={(value) => void toggleOnline(value)}
                aria-label={`${store.name} sells online`}
              />
            </label>
            <Link
              href="/inventory/transfers"
              className={buttonVariants({ variant: 'outline', size: 'sm', className: 'hidden sm:inline-flex' })}
            >
              <ArrowLeftRight className="size-3.5" />
              Move stock
            </Link>
            {canEdit && (
              <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
                <Pencil className="size-3.5" />
                Edit store
              </Button>
            )}
          </div>
        </div>

        <PageTabs tabs={tabsFor(showOrders)} current={tab} param="tab" className="mt-3" />
      </div>

      <StoreDialog open={editOpen} onOpenChange={setEditOpen} editing={asRow} />
    </>
  );
}
